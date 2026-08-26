import {
  AgentSessionId,
  decodeInitializeWorkspaceRuntime,
  decodeOpenCodeCredentialPromise,
  decodeOpenCodeKeySetupInputPromise,
  decodeOpenCodeSubscriptionStartInputPromise,
  decodeOpenCodeSubscriptionStatusInputPromise,
  decodeWorkspacePromptInputPromise,
  type InitializeWorkspaceRuntime,
  type OpenCodeCredential,
  type WorkspaceRuntimeMessage,
} from "@workspace/domain"
import { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd"
import { DurableObject } from "cloudflare:workers"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/durable-sqlite"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"

import { createWorkspacePlugin } from "./workspace-plugin"

const appWorkspaceState = sqliteTable("app_workspace_state", {
  workspaceId: text("workspace_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  projectId: text("project_id").notNull(),
  projectName: text("project_name"),
  repositoryName: text("repository_name").notNull(),
  repositoryRemote: text("repository_remote").notNull(),
  providerId: text("provider_id"),
  modelId: text("model_id"),
  sessionId: text("session_id"),
})

const messageText = (message: {
  content: ReadonlyArray<{ type: string; text?: string; name?: string }>
}) =>
  message.content
    .filter(
      (part): part is { type: string; text: string } =>
        (part.type === "text" || part.type === "reasoning") &&
        part.text !== undefined
    )
    .map((part) => part.text)
    .join("\n\n")

const messageTools = (message: {
  content: ReadonlyArray<{ type: string; text?: string; name?: string }>
}) =>
  message.content.flatMap((part) =>
    part.type === "tool" && part.name ? [part.name] : []
  )

const runtimeMessages = (
  messages: ReadonlyArray<{
    id: string
    type: string
    time: { created: number }
    text?: string
    content?: ReadonlyArray<{ type: string; text?: string; name?: string }>
    error?: { message: string }
  }>
): WorkspaceRuntimeMessage[] =>
  messages.reduce<WorkspaceRuntimeMessage[]>((result, message) => {
    if (message.type === "user" && message.text !== undefined) {
      result.push({
        id: message.id,
        role: "user",
        text: message.text,
        createdAt: message.time.created,
        tools: [],
        error: null,
      })
      return result
    }

    if (message.type === "assistant" && message.content) {
      const tools = messageTools({ content: message.content })
      const text = messageText({ content: message.content })
      result.push({
        id: message.id,
        role: "assistant",
        text: text || (tools.length ? `Used ${tools.join(", ")}` : ""),
        createdAt: message.time.created,
        tools,
        error: message.error?.message ?? null,
      })
    }

    return result
  }, [])

const seedFiles = (projectName: string) => [
  {
    path: "README.md",
    content: `# ${projectName}\n\nBuilt in a durable Sylph workspace.\n`,
  },
  {
    path: "package.json",
    content: `${JSON.stringify(
      {
        name: projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        private: true,
        type: "module",
        scripts: { check: "tsc --noEmit" },
        devDependencies: { typescript: "^6" },
      },
      null,
      2
    )}\n`,
  },
  {
    path: "src/index.ts",
    content:
      'export default {\n  fetch: () => new Response("Hello from Sylph")\n}\n',
  },
]

const subscriptionProviderId = "openai"
const subscriptionMethodId = "chatgpt-headless"
const subscriptionCredentialLabel = "Sylph connection"

export class WorkspaceDO extends DurableObject<Cloudflare.Env> {
  readonly #database
  readonly #opencode

  constructor(context: DurableObjectState, bindings: Cloudflare.Env) {
    super(context, bindings)
    this.#database = drizzle(context.storage, { schema: { appWorkspaceState } })
    this.#opencode = context.blockConcurrencyWhile(async () => {
      const hasAppWorkspaceState =
        context.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_workspace_state'"
          )
          .toArray().length > 0
      const hasOpenCodeSchema =
        context.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('migration', 'session_v2')"
          )
          .toArray().length > 0

      if (hasAppWorkspaceState && !hasOpenCodeSchema) {
        context.storage.sql.exec("DROP TABLE app_workspace_state")
      }

      const opencode = await OpenCodeWorkerd.create({
        storage: context.storage,
        log: {
          level: "error",
          emit: ({ message, cause }) =>
            console.error("OpenCode runtime error", message, cause),
        },
        config: {
          default_agent: "build",
        },
        plugins: [createWorkspacePlugin(context.storage)],
      })

      this.#database.run(sql`
        CREATE TABLE IF NOT EXISTS app_workspace_state (
          workspace_id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          project_name TEXT,
          repository_name TEXT NOT NULL,
          repository_remote TEXT NOT NULL,
          provider_id TEXT,
          model_id TEXT,
          session_id TEXT
        )
      `)
      this.#database.run(sql`
        CREATE TABLE IF NOT EXISTS app_workspace_file (
          path TEXT PRIMARY KEY NOT NULL,
          content TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)

      const columns = context.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(app_workspace_state)")
        .toArray()
        .map((column) => column.name)

      if (!columns.includes("project_name")) {
        context.storage.sql.exec(
          "ALTER TABLE app_workspace_state ADD COLUMN project_name TEXT"
        )
      }
      if (!columns.includes("session_id")) {
        context.storage.sql.exec(
          "ALTER TABLE app_workspace_state ADD COLUMN session_id TEXT"
        )
      }
      if (!columns.includes("provider_id")) {
        context.storage.sql.exec(
          "ALTER TABLE app_workspace_state ADD COLUMN provider_id TEXT"
        )
      }
      if (!columns.includes("model_id")) {
        context.storage.sql.exec(
          "ALTER TABLE app_workspace_state ADD COLUMN model_id TEXT"
        )
      }

      return opencode
    })
  }

  async fetch(request: Request) {
    try {
      const opencode = await this.#opencode
      const url = new URL(request.url)

      if (request.method === "POST" && url.pathname === "/connect/key") {
        const input = await decodeOpenCodeKeySetupInputPromise(
          await request.json()
        )

        try {
          await opencode.integration.connect.key({
            integrationID: input.providerId,
            key: input.apiKey,
          })
        } catch {
          throw new Error(
            `OpenCode could not connect to ${input.providerId}. Check the provider key and try again.`
          )
        }

        const models = await opencode.model.list()
        const modelAvailable = models.data.some(
          (model) =>
            model.providerID === input.providerId &&
            model.modelID === input.modelId &&
            model.enabled
        )

        if (!modelAvailable) {
          throw new Error(
            `OpenCode model ${input.providerId}/${input.modelId} is not available. Choose a model enabled for this provider.`
          )
        }

        return new Response(null, { status: 204 })
      }

      if (request.method === "POST" && url.pathname === "/oauth/start") {
        await decodeOpenCodeSubscriptionStartInputPromise(await request.json())
        await this.#waitForIntegration(opencode, subscriptionProviderId)
        const attempt = await opencode.integration.oauth.connect({
          integrationID: subscriptionProviderId,
          methodID: subscriptionMethodId,
          label: subscriptionCredentialLabel,
        })

        return Response.json({
          attemptId: attempt.data.attemptID,
          url: attempt.data.url,
          instructions: attempt.data.instructions,
          expiresAt: Number(attempt.data.time.expires),
        })
      }

      if (request.method === "POST" && url.pathname === "/oauth/status") {
        const input = await decodeOpenCodeSubscriptionStatusInputPromise(
          await request.json()
        )
        const result = await opencode.integration.oauth
          .status({
            integrationID: subscriptionProviderId,
            attemptID: input.attemptId,
          })
          .catch(() => ({
            data: {
              status: "expired" as const,
              time: { created: Date.now(), expires: Date.now() },
            },
          }))

        if (result.data.status !== "complete") {
          return Response.json(result.data)
        }

        const row = this.ctx.storage.sql
          .exec<{ value: string }>(
            "SELECT value FROM credential WHERE integration_id = ? AND active = 1 ORDER BY time_updated DESC LIMIT 1",
            subscriptionProviderId
          )
          .toArray()[0]

        if (!row) {
          throw new Error("OpenCode completed sign-in without a credential")
        }

        const credential = await decodeOpenCodeCredentialPromise(
          JSON.parse(row.value)
        )

        if (credential.type !== "oauth") {
          throw new Error("OpenCode returned the wrong credential type")
        }

        return Response.json({ ...result.data, credential })
      }

      if (request.method === "POST" && url.pathname === "/oauth/cancel") {
        const input = await decodeOpenCodeSubscriptionStatusInputPromise(
          await request.json()
        )
        await opencode.integration.oauth
          .cancel({
            integrationID: subscriptionProviderId,
            attemptID: input.attemptId,
          })
          .catch(() => undefined)
        return new Response(null, { status: 204 })
      }

      if (request.method === "POST" && url.pathname === "/initialize") {
        const input = await decodeInitializeWorkspaceRuntime(
          await request.json()
        )
        await this.#initialize(opencode, input)
        return Response.json(await this.#snapshot(opencode))
      }

      if (request.method === "POST" && url.pathname === "/prompt") {
        const input = await decodeWorkspacePromptInputPromise(
          await request.json()
        )
        const state = this.#database.select().from(appWorkspaceState).get()

        if (!state || state.workspaceId !== input.workspaceId) {
          return new Response("Workspace runtime is not initialized", {
            status: 409,
          })
        }
        if (!state.sessionId) {
          return new Response("OpenCode session is not initialized", {
            status: 409,
          })
        }

        await opencode.sessions.prompt({
          sessionID: state.sessionId,
          text: input.text,
        })
        return Response.json(await this.#snapshot(opencode), { status: 202 })
      }

      if (request.method === "GET" && url.pathname === "/snapshot") {
        return Response.json(await this.#snapshot(opencode))
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json(await this.#snapshot(opencode))
      }

      return new Response("Not found", { status: 404 })
    } catch (error) {
      console.error("Workspace runtime request failed", error)
      return new Response(
        error instanceof Error ? error.message : "Workspace runtime failed",
        { status: 500 }
      )
    }
  }

  async #initialize(
    opencode: OpenCodeWorkerd.Interface,
    input: InitializeWorkspaceRuntime
  ) {
    const existing = this.#database.select().from(appWorkspaceState).get()

    this.#database
      .insert(appWorkspaceState)
      .values({ ...input, sessionId: existing?.sessionId })
      .onConflictDoUpdate({
        target: appWorkspaceState.workspaceId,
        set: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          projectName: input.projectName,
          repositoryName: input.repositoryName,
          repositoryRemote: input.repositoryRemote,
          providerId: input.providerId,
          modelId: input.modelId,
        },
      })
      .run()

    try {
      await this.#installCredential(
        opencode,
        input.providerId,
        input.credential
      )
    } catch {
      throw new Error(
        `The AI provider could not connect to ${input.providerId}. Reconnect it and try again.`
      )
    }

    const fileCount = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM app_workspace_file"
      )
      .toArray()[0]?.count

    if (!fileCount) {
      for (const file of seedFiles(input.projectName)) {
        this.ctx.storage.sql.exec(
          "INSERT INTO app_workspace_file (path, content, updated_at) VALUES (?, ?, ?)",
          file.path,
          file.content,
          Date.now()
        )
      }
    }

    let sessionId = existing?.sessionId

    if (sessionId) {
      try {
        await opencode.sessions.get({ sessionID: sessionId })
      } catch {
        sessionId = null
      }
    }

    if (!sessionId) {
      const session = await opencode.sessions.create({
        title: input.projectName,
        location: { directory: "/workspace" },
      })
      sessionId = session.id
      this.#database.update(appWorkspaceState).set({ sessionId }).run()
    }

    try {
      await opencode.sessions.switchModel({
        sessionID: sessionId,
        model: { providerID: input.providerId, id: input.modelId },
      })
    } catch {
      throw new Error(
        `OpenCode could not use ${input.providerId}/${input.modelId}. Update the model and try again.`
      )
    }
  }

  async #installCredential(
    opencode: OpenCodeWorkerd.Interface,
    providerId: string,
    credential: OpenCodeCredential
  ) {
    await this.#waitForIntegration(opencode, providerId)

    if (credential.type === "key") {
      await opencode.integration.connect.key({
        integrationID: providerId,
        key: credential.key,
      })
      return
    }

    const existing = this.ctx.storage.sql
      .exec<{ id: string }>(
        "SELECT id FROM credential WHERE integration_id = ? AND label = ? LIMIT 1",
        providerId,
        subscriptionCredentialLabel
      )
      .toArray()[0]
    const credentialId = existing?.id ?? `cred_sylph_${crypto.randomUUID()}`
    const switchCredentialId = `cred_sylph_switch_${providerId}`
    const now = Date.now()

    this.ctx.storage.sql.exec(
      "UPDATE credential SET active = 0, time_updated = ? WHERE integration_id = ?",
      now,
      providerId
    )

    if (existing) {
      this.ctx.storage.sql.exec(
        "UPDATE credential SET value = ?, method_id = ?, active = 0, time_updated = ? WHERE id = ?",
        JSON.stringify(credential),
        credential.methodID,
        now,
        credentialId
      )
    } else {
      this.ctx.storage.sql.exec(
        "INSERT INTO credential (id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated) VALUES (?, ?, ?, ?, NULL, ?, 0, ?, ?)",
        credentialId,
        providerId,
        subscriptionCredentialLabel,
        JSON.stringify(credential),
        credential.methodID,
        now,
        now
      )
    }

    this.ctx.storage.sql.exec(
      "INSERT INTO credential (id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated) VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, method_id = excluded.method_id, active = 1, time_updated = excluded.time_updated",
      switchCredentialId,
      providerId,
      "Sylph connection switch",
      JSON.stringify(credential),
      credential.methodID,
      now,
      now
    )
    await opencode.credential.activate({ credentialID: credentialId })
    this.ctx.storage.sql.exec(
      "DELETE FROM credential WHERE id = ?",
      switchCredentialId
    )
  }

  async #waitForIntegration(
    opencode: OpenCodeWorkerd.Interface,
    providerId: string
  ) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const integration = await opencode.integration.get({
        integrationID: providerId,
      })

      if (integration.data) return

      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    throw new Error(`OpenCode integration ${providerId} did not start`)
  }

  async #snapshot(opencode: OpenCodeWorkerd.Interface) {
    const state = this.#database.select().from(appWorkspaceState).get()
    const health = await opencode.health.get()

    if (!state?.sessionId) {
      return {
        workspaceId: state?.workspaceId ?? null,
        sessionId: null,
        status: health.healthy ? "provisioning" : "error",
        model: null,
        files: [],
        messages: [],
        opencode: health,
      }
    }

    const [active, messages] = await Promise.all([
      opencode.sessions.active(),
      opencode.message.list({
        sessionID: state.sessionId,
        limit: 100,
        order: "asc",
      }),
    ])
    const files = this.ctx.storage.sql
      .exec<{ path: string }>(
        "SELECT path FROM app_workspace_file ORDER BY path"
      )
      .toArray()
      .map((file) => file.path)

    return {
      workspaceId: state.workspaceId,
      sessionId: AgentSessionId.make(state.sessionId),
      status: active[state.sessionId] ? "running" : "ready",
      model:
        state.providerId && state.modelId
          ? `${state.providerId}/${state.modelId}`
          : null,
      files,
      messages: runtimeMessages(messages.data),
      opencode: health,
    }
  }
}
