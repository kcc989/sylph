import {
  AgentSessionId,
  decodeWorkspaceCheckUpdatePromise,
  decodeWorkspaceProductionCheckInputPromise,
  decodeWorkspaceRepairCheckInputPromise,
  decodeWorkspaceRetryCheckInputPromise,
  decodeInitializeWorkspaceRuntime,
  decodeOpenCodeCredentialPromise,
  decodeOpenCodeKeySetupInputPromise,
  decodeOpenCodeSubscriptionStartInputPromise,
  decodeOpenCodeSubscriptionStatusInputPromise,
  decodePrepareProjectRepositoryInputPromise,
  decodeSyncProjectRepositoryInputPromise,
  decodeWorkspacePermissionReplyInputPromise,
  decodeWorkspaceQuestionReplyInputPromise,
  decodeWorkspaceCheckpointInputPromise,
  decodeWorkspaceRuntimeEventPromise,
  decodeWorkspaceRuntimePromptInputPromise,
  decodeWorkspaceTurnCancelInputPromise,
  OpenCodeConnectionResult,
  PrepareProjectRepositoryResult,
  type InitializeWorkspaceRuntime,
  type OpenCodeCredential,
  WorkspaceRuntimeEvent,
  WorkspaceAgentQuestion,
  WorkspaceQuestionField,
  WorkspaceQuestionOption,
  type WorkspaceRuntimeMessage,
  GitCommitId,
  WorkspaceCheckRun,
  type WorkspaceCiInput,
  type WorkspaceCheckStageName,
  WorkspaceId,
  resolveSkillInvocation,
} from "@workspace/domain"
import type { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { DurableObject } from "cloudflare:workers"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/durable-sqlite"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Schema } from "effect"

import { workspaceEventResponse } from "./workspace-event-stream"
import { providerConnectionErrorSummary } from "./workspace-error-summary"
import {
  createWorkspacePermissionBridge,
  createWorkspacePlugin,
  workspaceMutationPermissions,
} from "./workspace-plugin"
import { WorkspaceFilesystem } from "./workspace-filesystem"
import { WorkspaceGit } from "./workspace-git"
import { createOpenCodeWithStorageBootstrap } from "./opencode-storage-bootstrap"
import { activateCredentialAndWaitForCatalog } from "./opencode-credential-activation"
import {
  connectOpenCodeKeyCredential,
  OpenCodeCredentialReloadRequired,
} from "./opencode-key-credential"
import type { OpenAIOAuthRequestState } from "./opencode-oauth-request"
import { activateWorkspacePrompt } from "./workspace-prompt-activation"
import { workspaceRuntimeStatus } from "./workspace-runtime-status"
import {
  checkStage,
  maxWorkspaceCheckAttempts,
  maxWorkspaceRepairAttempts,
  WorkspaceChecks,
} from "./workspace-checks"
import { loadInstalledSkills } from "./installed-skills"
import { createWorkspaceSkillRegistry } from "./workspace-skills"
const checkpointCheckStages: WorkspaceCheckStageName[] = [
  "install",
  "typecheck",
  "lint",
  "test",
  "build",
  "preview",
  "browser",
]
const productionCheckStages: WorkspaceCheckStageName[] = [
  "install",
  "build",
  "production",
]
const maxQueuedMessages = 5
const maxTurnDurationMs = 15 * 60 * 1000

const providerFailureMessage = Schema.Struct({ message: Schema.String })
const wrappedProviderFailureMessage = Schema.Struct({
  error: providerFailureMessage,
})

const appWorkspaceState = sqliteTable("app_workspace_state", {
  workspaceId: text("workspace_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  projectId: text("project_id").notNull(),
  projectName: text("project_name"),
  repositoryName: text("repository_name").notNull(),
  repositoryRemote: text("repository_remote").notNull(),
  providerId: text("provider_id"),
  modelId: text("model_id"),
  credentialFingerprint: text("credential_fingerprint"),
  sessionId: text("session_id"),
})

const credentialFingerprint = async (credential: OpenCodeCredential) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(credential))
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

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

const activeTurnStartedAt = (
  messages: ReadonlyArray<{
    type: string
    time: { created: number; completed?: number }
  }>
) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type === "assistant" && message.time.completed === undefined) {
      return message.time.created
    }
  }
  return messages.at(-1)?.time.created ?? null
}

const workspaceQuestionField = (field: {
  key: string
  title?: string
  description?: string
  required?: boolean
  type: "string" | "number" | "integer" | "boolean" | "multiselect" | "external"
  options?: ReadonlyArray<{
    value: string
    label: string
    description?: string
  }>
  placeholder?: string
  url?: string
  default?: string | number | boolean | ReadonlyArray<string>
}) =>
  new WorkspaceQuestionField({
    key: field.key,
    title: field.title,
    description: field.description,
    required: field.required,
    type: field.type,
    options: (field.options ?? []).map(
      (option) => new WorkspaceQuestionOption(option)
    ),
    placeholder: field.placeholder,
    url: field.url,
    defaultValue: field.default,
  })

const subscriptionProviderId = "openai"
const subscriptionMethodId = "chatgpt-headless"
const subscriptionCredentialLabel = "Sylph connection"

interface WorkspaceBindings extends Cloudflare.Env {
  CI_WORKFLOW: Workflow<WorkspaceCiInput>
  DB: D1Database
  REPOSITORY_NAMESPACE: string
  REPOS: Artifacts
}

export class WorkspaceDO extends DurableObject<WorkspaceBindings> {
  readonly #database
  readonly #opencode
  readonly #filesystem
  readonly #workspaceGit
  readonly #checks
  readonly #permissionBridge = createWorkspacePermissionBridge()
  readonly #skills = createWorkspaceSkillRegistry()
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
    this.#checks = new WorkspaceChecks(context.storage)
    this.#opencode = context.blockConcurrencyWhile(async () => {
      const { OpenCodeWorkerd } = await import("@opencode-ai/sdk/workerd")
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
              permissions: workspaceMutationPermissions,
            },
            plugins: [
              createWorkspacePlugin(
                this.#filesystem,
                this.#workspaceGit,
                this.#openAIOAuth,
                this.#permissionBridge,
                this.#skills,
                {
                  runChecks: async (input) => {
                    try {
                      const state = this.#requiredState()
                      const result = await this.#workspaceGit.checkpoint({
                        idempotencyKey: crypto.randomUUID(),
                        message: input.message,
                      })
                      return await this.#startCheckpointCheck(
                        state.workspaceId,
                        result.checkpoint.id,
                        result.checkpoint.commit,
                        input.repairOnFailure
                      )
                    } catch (error) {
                      console.error(
                        "Workspace runChecks failed",
                        error instanceof Error ? error.stack : error
                      )
                      throw error
                    }
                  },
                  checkStatus: async () => this.#checks.list(),
                  syncProject: async () => this.#syncProjectAndCheck(),
                }
              ),
            ],
          })
      )

      this.#permissionBridge.connect(async (request) =>
        opencode.permission.create({
          sessionID: request.sessionID,
          action: request.action,
          resources: [request.path],
          save: [request.path],
          source: {
            type: "tool",
            messageID: request.messageID,
            id: request.toolCallID,
          },
          agent: request.agent,
        })
      )

      this.#filesystem.initialize()
      this.#workspaceGit.initialize()
      this.#checks.initialize()

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
          credential_fingerprint TEXT,
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
      if (!columns.includes("credential_fingerprint")) {
        context.storage.sql.exec(
          "ALTER TABLE app_workspace_state ADD COLUMN credential_fingerprint TEXT"
        )
      }

      return opencode
    })
  }

  async alarm() {
    const opencode = await this.#opencode
    const state = this.#database.select().from(appWorkspaceState).get()
    if (!state?.sessionId) return
    const active = await opencode.sessions.active()
    if (!active[state.sessionId]) return
    const messages = await opencode.message.list({
      sessionID: state.sessionId,
      limit: 100,
      order: "asc",
    })
    const startedAt = activeTurnStartedAt(messages.data) ?? Date.now()
    const deadline = startedAt + maxTurnDurationMs
    if (deadline <= Date.now()) {
      await opencode.sessions.interrupt({
        sessionID: state.sessionId,
        continue: false,
      })
      return
    }
    await this.ctx.storage.setAlarm(deadline)
  }

  async fetch(request: Request) {
    try {
      const url = new URL(request.url)

      if (request.method === "POST" && url.pathname === "/prepare-project") {
        const input = await decodePrepareProjectRepositoryInputPromise(
          await request.json()
        )
        const head = await this.#workspaceGit.prepareProject(input)
        return Response.json(new PrepareProjectRepositoryResult({ head }))
      }

      if (request.method === "POST" && url.pathname === "/sync-project") {
        const input = await decodeSyncProjectRepositoryInputPromise(
          await request.json()
        )
        return Response.json(await this.#workspaceGit.synchronizeProject(input))
      }

      const opencode = await this.#opencode

      if (request.method === "POST" && url.pathname === "/connect/key") {
        const input = await decodeOpenCodeKeySetupInputPromise(
          await request.json()
        )

        await this.#waitForIntegration(opencode, input.providerId)

        try {
          await connectOpenCodeKeyCredential(opencode, {
            providerId: input.providerId,
            key: input.apiKey,
            configuration: input.configuration,
          })
        } catch (error) {
          if (error instanceof OpenCodeCredentialReloadRequired) throw error
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
        const result = await this.#workspaceGit.checkpoint({
          idempotencyKey: input.idempotencyKey,
          message: input.message,
        })
        const state = this.#requiredState()
        const check = await this.#startCheckpointCheck(
          state.workspaceId,
          result.checkpoint.id,
          result.checkpoint.commit,
          input.repairOnFailure ?? false
        )
        return Response.json({ ...result, check })
      }

      if (request.method === "GET" && url.pathname === "/checks") {
        return Response.json(this.#checks.list())
      }

      if (request.method === "POST" && url.pathname === "/checks/update") {
        const update = await decodeWorkspaceCheckUpdatePromise(
          await request.json()
        )
        return Response.json({ applied: this.#checks.apply(update) })
      }

      if (request.method === "POST" && url.pathname === "/checks/production") {
        const input = await decodeWorkspaceProductionCheckInputPromise(
          await request.json()
        )
        const state = this.#requiredState()
        const existing = this.#checks.get(input.id)
        if (existing) return Response.json(existing)
        const run = new WorkspaceCheckRun({
          id: input.id,
          workspaceId: WorkspaceId.make(state.workspaceId),
          checkpointId: null,
          commit: GitCommitId.make(input.commit),
          kind: "production",
          status: "queued",
          attempt: 1,
          maxAttempts: maxWorkspaceCheckAttempts,
          repairOnFailure: false,
          repairStatus: "disabled",
          repairAttempt: 0,
          maxRepairAttempts: maxWorkspaceRepairAttempts,
          previewUrl: null,
          stages: productionCheckStages.map((name) =>
            checkStage(name, "queued", "Waiting")
          ),
          diagnostics: [],
          evidence: [],
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })
        this.#checks.create(run)
        return Response.json(run)
      }

      if (request.method === "POST" && url.pathname === "/checks/retry") {
        const input = await decodeWorkspaceRetryCheckInputPromise(
          await request.json()
        )
        const state = this.#requiredState()
        if (input.workspaceId !== state.workspaceId)
          throw new Error("Check retry belongs to another Workspace")
        const run = this.#checks.retry(input.runId, input.idempotencyKey)
        await this.#startWorkflow(run)
        return Response.json(run)
      }

      if (request.method === "POST" && url.pathname === "/checks/repair") {
        const input = await decodeWorkspaceRepairCheckInputPromise(
          await request.json()
        )
        const state = this.#requiredState()
        if (input.workspaceId !== state.workspaceId)
          throw new Error("Check repair belongs to another Workspace")
        this.#checks.requestRepair(input.runId, input.idempotencyKey)
        const run = this.#checks.takeRepair(input.runId)
        if (!run) return Response.json({ started: false })
        if (!state.sessionId)
          throw new Error("OpenCode session is not initialized")
        const diagnostics = run.diagnostics
          .map(
            (diagnostic) =>
              `${diagnostic.stage}: ${diagnostic.summary}\n${diagnostic.output}`
          )
          .join("\n\n")
          .slice(-12_000)
        await opencode.sessions.prompt({
          sessionID: state.sessionId,
          text: `Repair the failures from Check ${run.id} without weakening validation. Inspect the current Working copy, make the smallest correct changes, then run Workspace checks again.\n\n${diagnostics}`,
        })
        await this.#scheduleTurnLimit()
        return Response.json({ started: true })
      }

      if (request.method === "POST" && url.pathname === "/update-project") {
        return Response.json(await this.#syncProjectAndCheck())
      }

      if (request.method === "POST" && url.pathname === "/rebase") {
        return Response.json(await this.#workspaceGit.rebase())
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
        const sessionId = state.sessionId
        const nextCredentialFingerprint = await credentialFingerprint(
          input.credential
        )
        const activeSessions = await opencode.sessions.active()
        const turnActive = Boolean(activeSessions[sessionId])
        if (turnActive && !input.delivery) {
          return new Response(
            "Choose queue or steer while an agent Turn is active",
            { status: 409 }
          )
        }
        if (!turnActive && input.delivery === "steer") {
          return new Response("There is no active Turn to steer", {
            status: 409,
          })
        }
        if (
          turnActive &&
          (state.providerId !== input.model.providerId ||
            state.modelId !== input.model.modelId)
        ) {
          return new Response(
            "Wait for the active Turn to finish before changing models",
            { status: 409 }
          )
        }
        if (input.delivery === "queue") {
          const inbox = await opencode.sessions.inbox.list({
            sessionID: sessionId,
          })
          const queued = inbox.filter(
            (item) => item.type === "user" && item.delivery === "queue"
          )
          if (queued.length >= maxQueuedMessages) {
            return new Response(
              `This Conversation already has ${maxQueuedMessages} queued messages`,
              { status: 409 }
            )
          }
        }

        try {
          if (!turnActive) {
            await activateWorkspacePrompt({
              refreshCredential:
                state.credentialFingerprint === nextCredentialFingerprint
                  ? undefined
                  : () =>
                      this.#installCredential(
                        opencode,
                        input.model.providerId,
                        input.credential
                      ),
              switchModel: () =>
                opencode.sessions.switchModel({
                  sessionID: sessionId,
                  model: {
                    providerID: input.model.providerId,
                    id: input.model.modelId,
                  },
                }),
            })
          }
          this.#database
            .update(appWorkspaceState)
            .set({
              providerId: input.model.providerId,
              modelId: input.model.modelId,
              credentialFingerprint: nextCredentialFingerprint,
            })
            .run()
        } catch (error) {
          const detail =
            error instanceof Error
              ? error.message
              : Schema.is(providerFailureMessage)(error)
                ? error.message
                : Schema.is(wrappedProviderFailureMessage)(error)
                  ? error.error.message
                  : null
          throw new Error(
            detail
              ? `OpenCode could not use ${input.model.providerId}/${input.model.modelId}: ${detail}`
              : `OpenCode could not use ${input.model.providerId}/${input.model.modelId}. Choose another available model.`
          )
        }

        const invocation = resolveSkillInvocation(
          input.text,
          this.#skills.list()
        )
        await opencode.sessions.prompt({
          sessionID: sessionId,
          text: invocation
            ? invocation.text || "Follow the attached Skill instructions."
            : input.text,
          skills: invocation ? [{ id: invocation.skillId }] : undefined,
          delivery: input.delivery,
        })
        if (input.delivery !== "queue") await this.#scheduleTurnLimit()
        return Response.json(await this.#snapshot(opencode), { status: 202 })
      }

      if (request.method === "POST" && url.pathname === "/turn/cancel") {
        const input = await decodeWorkspaceTurnCancelInputPromise(
          await request.json()
        )
        const state = this.#requiredState()
        if (state.workspaceId !== input.workspaceId) {
          return new Response("Turn belongs to another Workspace", {
            status: 409,
          })
        }
        if (!state.sessionId) {
          return new Response("OpenCode session is not initialized", {
            status: 409,
          })
        }
        const sessionId = state.sessionId
        const result = await opencode.sessions.interrupt({
          sessionID: sessionId,
          continue: input.continueQueued ?? false,
        })
        if (!input.continueQueued) {
          const inbox = await opencode.sessions.inbox.list({
            sessionID: sessionId,
          })
          await Promise.all(
            inbox.map((item) =>
              opencode.sessions.inbox.cancel({
                sessionID: sessionId,
                inboxID: item.id,
              })
            )
          )
          await this.ctx.storage.deleteAlarm()
        }
        return Response.json(result)
      }

      if (request.method === "GET" && url.pathname === "/events") {
        const state = this.#database.select().from(appWorkspaceState).get()

        if (!state?.sessionId) {
          return new Response("OpenCode session is not initialized", {
            status: 409,
          })
        }

        return workspaceEventResponse(
          this.#events(opencode, AgentSessionId.make(state.sessionId))
        )
      }

      if (request.method === "POST" && url.pathname === "/skills/reload") {
        const state = this.#requiredState()
        await this.#skills.replace(
          await loadInstalledSkills(
            this.env.DB,
            state.organizationId,
            state.projectId
          )
        )
        return Response.json({ skills: this.#skills.list().length })
      }

      if (request.method === "POST" && url.pathname === "/permission/reply") {
        const input = await decodeWorkspacePermissionReplyInputPromise(
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

        await opencode.permission.reply({
          sessionID: state.sessionId,
          requestID: input.requestId,
          reply: input.reply,
          message: input.message,
        })
        this.#permissionBridge.reply(input.requestId, input.reply)
        return new Response(null, { status: 204 })
      }

      if (request.method === "POST" && url.pathname === "/question/reply") {
        const input = await decodeWorkspaceQuestionReplyInputPromise(
          await request.json()
        )
        const state = this.#requiredState()
        if (state.workspaceId !== input.workspaceId || !state.sessionId) {
          return new Response("Agent question belongs to another Workspace", {
            status: 409,
          })
        }
        await opencode.form.reply({
          sessionID: state.sessionId,
          formID: input.questionId,
          answer: input.answer,
        })
        return new Response(null, { status: 204 })
      }

      if (request.method === "POST" && url.pathname === "/discard") {
        const state = this.#requiredState()
        if (state.sessionId) {
          await opencode.sessions
            .interrupt({ sessionID: state.sessionId, continue: false })
            .catch(() => undefined)
        }
        await opencode.close()
        await this.ctx.storage.deleteAll()
        return new Response(null, { status: 204 })
      }

      if (request.method === "POST" && url.pathname === "/evict") {
        this.ctx.abort("Sylph requested Workspace runtime eviction", {
          retryAlarm: false,
        })
      }

      if (request.method === "GET" && url.pathname === "/snapshot") {
        return Response.json(await this.#snapshot(opencode))
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json(await this.#snapshot(opencode))
      }

      return new Response("Not found", { status: 404 })
    } catch (error) {
      if (error instanceof OpenCodeCredentialReloadRequired) {
        return new Response("Workspace runtime credential store refreshed", {
          status: 409,
        })
      }
      console.error(
        "Workspace runtime request failed",
        error instanceof Error ? error.stack : error
      )
      return new Response(
        error instanceof Error ? error.message : "Workspace runtime failed",
        { status: 500 }
      )
    }
  }

  #requiredState() {
    const state = this.#database.select().from(appWorkspaceState).get()
    if (!state) throw new Error("Workspace runtime is not initialized")
    return state
  }

  async #startCheckpointCheck(
    workspaceId: string,
    checkpointId: string,
    commit: string,
    repairOnFailure: boolean
  ) {
    const id = `check-${checkpointId}`
    const existing = this.#checks.get(id)
    if (existing) return existing
    const createdAt = Date.now()
    const run = new WorkspaceCheckRun({
      id,
      workspaceId: WorkspaceId.make(workspaceId),
      checkpointId,
      commit: GitCommitId.make(commit),
      kind: "checkpoint",
      status: "queued",
      attempt: 1,
      maxAttempts: maxWorkspaceCheckAttempts,
      repairOnFailure,
      repairStatus: repairOnFailure ? "available" : "disabled",
      repairAttempt: 0,
      maxRepairAttempts: maxWorkspaceRepairAttempts,
      previewUrl: null,
      stages: checkpointCheckStages.map((name) =>
        checkStage(name, "queued", "Waiting")
      ),
      diagnostics: [],
      evidence: [],
      createdAt,
      updatedAt: createdAt,
    })
    this.#checks.create(run)
    await this.#startWorkflow(run)
    return run
  }

  async #startWorkflow(run: WorkspaceCheckRun) {
    const state = this.#requiredState()
    const versionControl = await this.#workspaceGit.versionControl()
    const params: WorkspaceCiInput = {
      provider: "cloudflare-artifacts",
      providerData: { namespace: this.env.REPOSITORY_NAMESPACE },
      event: { type: "push" },
      owner: this.env.REPOSITORY_NAMESPACE,
      repo: state.repositoryName,
      sha: run.commit,
      remote: "cloudflare",
      trigger: "push",
      ref: `refs/heads/${versionControl.defaultRef}`,
      branch: versionControl.defaultRef,
      checkRunId: run.id,
      workspaceId: run.workspaceId,
      checkpointId: run.checkpointId,
      kind: run.kind,
      attempt: run.attempt,
      repairOnFailure: run.repairOnFailure,
      deploymentId: null,
      createdAt: run.createdAt,
    }
    const instanceId = `${run.id}-attempt-${run.attempt}`
    const existingStatus = await this.env.CI_WORKFLOW.get(instanceId)
      .then((instance) => instance.status())
      .catch(() => null)
    if (existingStatus && existingStatus.status !== "unknown") return
    try {
      await this.env.CI_WORKFLOW.create({ id: instanceId, params })
    } catch (cause) {
      const createdStatus = await this.env.CI_WORKFLOW.get(instanceId)
        .then((instance) => instance.status())
        .catch(() => null)
      if (!createdStatus || createdStatus.status === "unknown") throw cause
    }
  }

  async #syncProjectAndCheck() {
    const result = await this.#workspaceGit.syncProject()
    const state = this.#requiredState()
    const versionControl = await this.#workspaceGit.versionControl()
    await this.env.DB.prepare(
      "UPDATE workspace SET base_commit = ?, fork_head = ?, sync_status = ?, merge_status = ?, updated_at = unixepoch() WHERE id = ?"
    )
      .bind(
        versionControl.baseCommit,
        versionControl.forkHead,
        versionControl.syncStatus,
        versionControl.mergeStatus,
        state.workspaceId
      )
      .run()
    if (result.status !== "updated") return result
    const checkpoint = this.#workspaceGit
      .checkpoints()
      .find((candidate) => candidate.commit === versionControl.forkHead)
    if (checkpoint) {
      await this.#startCheckpointCheck(
        state.workspaceId,
        checkpoint.id,
        checkpoint.commit,
        false
      )
    }
    return result
  }

  async *#events(
    opencode: OpenCodeWorkerd.Interface,
    sessionId: AgentSessionId
  ): AsyncIterable<WorkspaceRuntimeEvent> {
    const pending = await opencode.permission.request.list({
      location: { directory: "/workspace" },
    })

    for (const request of pending.data) {
      if (request.sessionID !== sessionId) continue
      yield new WorkspaceRuntimeEvent({
        id: `pending-${request.id}`,
        created: Date.now(),
        type: "permission.asked",
        data: request,
      })
    }

    for await (const event of opencode.events.subscribe()) {
      yield await decodeWorkspaceRuntimeEventPromise(event)
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

    await this.#skills.replace(
      await loadInstalledSkills(
        this.env.DB,
        input.organizationId,
        input.projectId
      )
    )

    try {
      await this.#installCredential(
        opencode,
        input.providerId,
        input.credential
      )
      this.#database
        .update(appWorkspaceState)
        .set({
          credentialFingerprint: await credentialFingerprint(input.credential),
        })
        .run()
    } catch (error) {
      if (error instanceof OpenCodeCredentialReloadRequired) throw error
      const failure =
        error instanceof Error
          ? error
          : Schema.is(InvalidRequestError)(error) ||
              Schema.is(providerFailureMessage)(error)
            ? { _tag: "InvalidRequestError" as const, message: error.message }
            : Schema.is(wrappedProviderFailureMessage)(error)
              ? {
                  _tag: "InvalidRequestError" as const,
                  message: error.error.message,
                }
              : Schema.is(Schema.String)(error)
                ? { _tag: "InvalidRequestError" as const, message: error }
                : null
      throw new Error(providerConnectionErrorSummary(input.providerId, failure))
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
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : Schema.is(providerFailureMessage)(error)
            ? error.message
            : Schema.is(wrappedProviderFailureMessage)(error)
              ? error.error.message
              : null
      throw new Error(
        detail
          ? `OpenCode could not use ${input.providerId}/${input.modelId}: ${detail}`
          : `OpenCode could not use ${input.providerId}/${input.modelId}. Update the model and try again.`
      )
    }
  }

  async #installCredential(
    opencode: OpenCodeWorkerd.Interface,
    providerId: string,
    credential: OpenCodeCredential
  ) {
    try {
      await this.#waitForIntegration(opencode, providerId)
    } catch {
      throw new Error(`OpenCode could not load the ${providerId} integration`)
    }

    if (credential.type === "key") {
      if (providerId === subscriptionProviderId) {
        this.#openAIOAuth.active = false
        this.#openAIOAuth.accountID = null
      }
      try {
        await connectOpenCodeKeyCredential(opencode, {
          providerId,
          key: credential.key,
          configuration: credential.configuration,
        })
      } catch (error) {
        if (error instanceof OpenCodeCredentialReloadRequired) {
          throw error
        }
        const detail =
          Schema.is(InvalidRequestError)(error) ||
          Schema.is(providerFailureMessage)(error)
            ? error.message
            : Schema.is(wrappedProviderFailureMessage)(error)
              ? error.error.message
              : Schema.is(Schema.String)(error)
                ? error
                : null
        throw new Error(
          detail
            ? `OpenCode rejected the ${providerId} credential: ${detail}`
            : `OpenCode rejected the ${providerId} credential without a diagnostic`
        )
      }
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

  async #scheduleTurnLimit() {
    const scheduled = await this.ctx.storage.getAlarm()
    const deadline = Date.now() + maxTurnDurationMs
    if (scheduled === null || scheduled > deadline) {
      await this.ctx.storage.setAlarm(deadline)
    }
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
        queuedMessages: [],
        questions: [],
        permissions: [],
        lastTurnOutcome: null,
        activeTurnStartedAt: null,
        limits: {
          maxQueuedMessages,
          maxTurnDurationMs,
          maxCheckAttempts: maxWorkspaceCheckAttempts,
          maxRepairAttempts: maxWorkspaceRepairAttempts,
        },
        opencode: health,
      }
    }
    const sessionId = state.sessionId

    const [active, session, messages, inbox, forms, permissions] =
      await Promise.all([
        opencode.sessions.active(),
        opencode.sessions.get({ sessionID: sessionId }),
        opencode.message.list({
          sessionID: sessionId,
          limit: 100,
          order: "asc",
        }),
        opencode.sessions.inbox.list({ sessionID: sessionId }),
        opencode.form.list({ sessionID: sessionId }),
        opencode.permission.request.list({
          location: { directory: "/workspace" },
        }),
      ])
    const formStates = await Promise.all(
      forms.map(async (form) => ({
        form,
        state: await opencode.form.state({
          sessionID: sessionId,
          formID: form.id,
        }),
      }))
    )
    const files = this.#filesystem.listWorkingFiles()
    const turnActive = Boolean(active[sessionId])
    const questions = formStates.map(
      ({ form, state: formState }) =>
        new WorkspaceAgentQuestion({
          id: form.id,
          title: form.title,
          status: formState.status,
          fields: form.fields.map(workspaceQuestionField),
          answer: formState.status === "answered" ? formState.answer : null,
        })
    )

    return {
      workspaceId: state.workspaceId,
      sessionId: AgentSessionId.make(sessionId),
      status: workspaceRuntimeStatus(
        turnActive,
        messages.data,
        session.outcome
      ),
      model:
        state.providerId && state.modelId
          ? `${state.providerId}/${state.modelId}`
          : null,
      files,
      messages: runtimeMessages(messages.data),
      queuedMessages: inbox.flatMap((item) =>
        item.type === "user"
          ? [
              {
                id: item.id,
                text: item.payload.text,
                createdAt: item.timeCreated,
                delivery: item.delivery,
              },
            ]
          : []
      ),
      questions,
      permissions: permissions.data.filter(
        (request) => request.sessionID === sessionId
      ),
      lastTurnOutcome: session.outcome ?? null,
      activeTurnStartedAt: turnActive
        ? activeTurnStartedAt(messages.data)
        : null,
      limits: {
        maxQueuedMessages,
        maxTurnDurationMs,
        maxCheckAttempts: maxWorkspaceCheckAttempts,
        maxRepairAttempts: maxWorkspaceRepairAttempts,
      },
      opencode: health,
    }
  }
}
