import {
  AgentSessionId,
  decodeInitializeWorkspaceRuntime,
  decodeOpenCodeCredentialPromise,
  decodeOpenCodeKeySetupInputPromise,
  decodeOpenCodeSubscriptionStartInputPromise,
  decodeOpenCodeSubscriptionStatusInputPromise,
  decodePrepareProjectRepositoryInputPromise,
  decodeWorkspaceCheckpointInputPromise,
  decodeWorkspaceRuntimePromptInputPromise,
  OpenCodeConnectionResult,
  PrepareProjectRepositoryResult,
  type InitializeWorkspaceRuntime,
  type OpenCodeCredential,
  type WorkspaceRuntimeMessage,
} from "@workspace/domain"
import { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd"
import { DurableObject } from "cloudflare:workers"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/durable-sqlite"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Schema } from "effect"

import { createWorkspacePlugin } from "./workspace-plugin"
import { WorkspaceFilesystem } from "./workspace-filesystem"
import { WorkspaceGit } from "./workspace-git"
import { createOpenCodeWithStorageBootstrap } from "./opencode-storage-bootstrap"
import { activateCredentialAndWaitForCatalog } from "./opencode-credential-activation"
import type { OpenAIOAuthRequestState } from "./opencode-oauth-request"
import { workspaceRuntimeStatus } from "./workspace-runtime-status"

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

const subscriptionProviderId = "openai"
const subscriptionMethodId = "chatgpt-headless"
const subscriptionCredentialLabel = "Sylph connection"

interface WorkspaceBindings extends Cloudflare.Env {
  REPOS: Artifacts
}

export class WorkspaceDO extends DurableObject<WorkspaceBindings> {
  readonly #database
  readonly #opencode
  readonly #filesystem
  readonly #workspaceGit
  readonly #openAIOAuth: OpenAIOAuthRequestState = {
    active: false,
    accountID: null,
  }

  constructor(context: DurableObjectState, bindings: WorkspaceBindings) {
    super(context, bindings)
    this.#database = drizzle(context.storage, { schema: { appWorkspaceState } })
    this.#filesystem = new WorkspaceFilesystem(context.storage)
    this.#workspaceGit = new WorkspaceGit(
      context.storage,
      bindings.REPOS,
      this.#filesystem
    )
    this.#opencode = context.blockConcurrencyWhile(async () => {
      const opencode = await createOpenCodeWithStorageBootstrap(
        context.storage,
        () =>
          OpenCodeWorkerd.create({
            storage: context.storage,
            log: {
              level: "error",
              emit: ({ message, cause }) =>
                console.error("OpenCode runtime error", message, cause),
            },
            config: {
              default_agent: "build",
            },
            plugins: [
              createWorkspacePlugin(
                this.#filesystem,
                this.#workspaceGit,
                this.#openAIOAuth
              ),
            ],
          })
      )

      this.#filesystem.initialize()
      this.#workspaceGit.initialize()

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

      if (request.method === "POST" && url.pathname === "/prepare-project") {
        const input = await decodePrepareProjectRepositoryInputPromise(
          await request.json()
        )
        const head = await this.#workspaceGit.prepareProject(input)
        return Response.json(new PrepareProjectRepositoryResult({ head }))
      }

      if (request.method === "POST" && url.pathname === "/connect/key") {
        const input = await decodeOpenCodeKeySetupInputPromise(
          await request.json()
        )

        await this.#waitForIntegration(opencode, input.providerId)

        try {
          await opencode.integration.connect.key({
            integrationID: input.providerId,
            key: input.apiKey,
            answer: input.configuration,
          })
        } catch {
          throw new Error(
            `OpenCode could not connect to ${input.providerId}. Check the provider key and try again.`
          )
        }

        return Response.json(
          await this.#connectionResult(opencode, input.providerId)
        )
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

        const catalog = await this.#connectionResult(
          opencode,
          subscriptionProviderId
        )
        return Response.json({ ...result.data, credential, ...catalog })
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

      if (request.method === "POST" && url.pathname === "/checkpoint") {
        const input = await decodeWorkspaceCheckpointInputPromise(
          await request.json()
        )
        return Response.json(
          await this.#workspaceGit.checkpoint({
            idempotencyKey: input.idempotencyKey,
            message: input.message,
          })
        )
      }

      if (request.method === "GET" && url.pathname === "/vcs") {
        return Response.json({
          vcs: await this.#workspaceGit.versionControl(
            url.searchParams.get("refresh") === "1"
          ),
          checkpoints: this.#workspaceGit.checkpoints(),
        })
      }

      if (request.method === "POST" && url.pathname === "/prompt") {
        const input = await decodeWorkspaceRuntimePromptInputPromise(
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

        try {
          await this.#installCredential(
            opencode,
            input.model.providerId,
            input.credential
          )
          await opencode.sessions.switchModel({
            sessionID: state.sessionId,
            model: {
              providerID: input.model.providerId,
              id: input.model.modelId,
            },
          })
        } catch {
          throw new Error(
            `OpenCode could not use ${input.model.providerId}/${input.model.modelId}. Choose another available model.`
          )
        }

        this.#database
          .update(appWorkspaceState)
          .set({
            providerId: input.model.providerId,
            modelId: input.model.modelId,
          })
          .run()

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

    await this.#workspaceGit.hydrate({
      repositoryName: input.repositoryName,
      repositoryRemote: input.repositoryRemote,
      projectRepositoryName: input.projectRepositoryName,
      projectRepositoryRemote: input.projectRepositoryRemote,
      defaultRef: input.defaultRef,
      baseCommit: input.baseCommit,
    })

    this.#database
      .insert(appWorkspaceState)
      .values({
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        projectName: input.projectName,
        repositoryName: input.repositoryName,
        repositoryRemote: input.repositoryRemote,
        providerId: input.providerId,
        modelId: input.modelId,
        sessionId: existing?.sessionId,
      })
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
      if (providerId === subscriptionProviderId) {
        this.#openAIOAuth.active = false
        this.#openAIOAuth.accountID = null
      }
      await opencode.integration.connect.key({
        integrationID: providerId,
        key: credential.key,
        answer: credential.configuration,
      })
      return
    }

    if (providerId === subscriptionProviderId) {
      const accountID = credential.metadata?.["accountID"]
      this.#openAIOAuth.active = true
      this.#openAIOAuth.accountID = Schema.is(Schema.String)(accountID)
        ? accountID
        : null
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
    await activateCredentialAndWaitForCatalog(opencode, credentialId)
    this.ctx.storage.sql.exec(
      "DELETE FROM credential WHERE id = ?",
      switchCredentialId
    )
  }

  async #connectionResult(
    opencode: OpenCodeWorkerd.Interface,
    providerId: string
  ) {
    const [listed, preferred] = await Promise.all([
      opencode.model.list(),
      opencode.model.default(),
    ])
    const models = listed.data
      .filter(
        (model) =>
          model.providerID === providerId &&
          model.enabled &&
          model.status !== "deprecated"
      )
      .map((model) => ({
        providerId: model.providerID,
        modelId: model.modelID,
        name: model.name,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))

    if (!models.length) {
      throw new Error(`${providerId} connected but exposed no usable models`)
    }

    return new OpenCodeConnectionResult({
      models,
      recommendedModelId:
        preferred.data?.providerID === providerId &&
        models.some((model) => model.modelId === preferred.data?.modelID)
          ? preferred.data.modelID
          : (models[0]?.modelId ?? null),
    })
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
    const files = this.#filesystem.listWorkingFiles()

    return {
      workspaceId: state.workspaceId,
      sessionId: AgentSessionId.make(state.sessionId),
      status: workspaceRuntimeStatus(
        Boolean(active[state.sessionId]),
        messages.data
      ),
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
