import {
  AgentSessionId,
  InitializeWorkspaceRuntime,
  OpenCodeConnectionResult,
  OpenCodeKeySetupInput,
  OpenCodeSubscriptionAttempt,
  OpenCodeSubscriptionRuntimeStatus,
  OpenCodeSubscriptionStartInput,
  OpenCodeSubscriptionStatusInput,
  OpenCodeCredential,
  WorkspaceRuntimeEvent,
  WorkspaceAgentQuestion,
  WorkspaceCheckpointInput,
  WorkspaceCheckUpdate,
  WorkspacePermissionAskedEventData,
  WorkspacePermissionReplyInput,
  WorkspaceQuestionField,
  WorkspaceQuestionOption,
  WorkspaceQuestionReplyInput,
  WorkspaceQueuedMessage,
  WorkspaceRepairCheckInput,
  WorkspaceRetryCheckInput,
  WorkspaceRuntimeHealth,
  WorkspaceRuntimePromptInput,
  WorkspaceSyncResult,
  WorkspaceTurnCancelInput,
  WorkspaceVersionControlSnapshot,
  GitCommitId,
  ProjectId,
  WorkspaceArchiveInput,
  WorkspaceCheckEvidence,
  WorkspaceCheckRun,
  type WorkspaceCiInput,
  type WorkspaceDiffScope,
  WorkspaceId,
  resolveSkillInvocation,
  WorkspacePreviewResult,
  WorkspaceProductionDeployment,
  WorkspaceProductionStatus,
  InvalidRequest,
  isServerFailure,
  PreconditionFailed,
  serializeServerFailure,
  WorkspaceArchiveResult,
  WorkspaceCheckUpdateResult,
  WorkspaceReadOnly,
  WorkspaceRepairResult,
  WorkspaceRuntimeFailure,
  WorkspaceSkillReloadResult,
  WorkspaceTurnCancelResult,
  WorkspaceCheckRunList,
  WorkspaceCheckpointResult,
  WorkspaceRebaseResult,
  WorkspaceDisconnectUserInput,
  type WorkspaceSocketAttachment,
  WorkspaceReadFileInput,
  WorkspaceFileContent,
  WorkspaceFileNotFound,
} from "@workspace/domain"
import type { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd"
import { DurableObject } from "cloudflare:workers"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/durable-sqlite"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Effect, Schema } from "effect"

import { decodeWorkspaceSocketAttachment } from "./workspace-socket-server"
import { WorkspaceSockets } from "./workspace-sockets"
import {
  WorkspaceCredentials,
  subscriptionCredentialLabel,
} from "./workspace-credentials"
import {
  providerConnectionErrorSummary,
  providerFailureDetail,
} from "./workspace-error-summary"
import {
  createWorkspacePermissionBridge,
  createWorkspacePlugin,
  workspaceMutationPermissions,
} from "./workspace-plugin"
import {
  WorkspaceFilesystem,
  workspaceFilesystemErrorCode,
} from "./workspace-filesystem"
import {
  workspaceFileDisplayLimit,
  workspaceFileEncoding,
} from "./workspace-file-content"
import { WorkspaceGit } from "./workspace-git"
import { createOpenCodeWithStorageBootstrap } from "./opencode-storage-bootstrap"
import {
  connectOpenCodeKeyCredential,
  OpenCodeCredentialReloadRequired,
} from "./opencode-key-credential"
import type { OpenAIOAuthRequestState } from "./opencode-oauth-request"
import { workspaceRuntimeStatus } from "./workspace-runtime-status"
import { listWorkspaceMessages } from "./workspace-message-pages"
import {
  workspaceRuntimeMessages,
  type WorkspaceRuntimeMessageSource,
} from "./workspace-runtime-messages"
import {
  automaticRepairIdempotencyKey,
  maxWorkspaceAutomaticRepairs,
  maxWorkspaceCheckAttempts,
  maxWorkspaceRepairAttempts,
  newCheckRun,
  WorkspaceChecks,
  WorkspaceRepairLimitReached,
  type WorkspaceRepairSource,
} from "./workspace-checks"
import { loadInstalledSkills } from "./installed-skills"
import { createWorkspaceSkillRegistry } from "./workspace-skills"
import {
  checkFailedNotification,
  checkPassedNotification,
  checkRepairPrompt,
  isTerminalCheckStatus,
  repairDisabledReason,
} from "./workspace-check-notification"
import {
  browserEvidenceIds,
  browserResult,
  browserTargetUrl,
  bytesFromBase64,
  evidenceUrl,
  previewForBrowser,
} from "./workspace-browser"
import { workspaceDiff } from "./workspace-diff"
import {
  reviewDecisionFromRow,
  workspaceMergeRequest,
} from "./workspace-merge-request"

const decodeInitializeWorkspaceRuntime = Schema.decodeUnknownPromise(
  InitializeWorkspaceRuntime
)
const decodeOpenCodeCredentialPromise =
  Schema.decodeUnknownPromise(OpenCodeCredential)
const decodeOpenCodeKeySetupInputPromise = Schema.decodeUnknownPromise(
  OpenCodeKeySetupInput
)
const decodeOpenCodeSubscriptionStartInputPromise = Schema.decodeUnknownPromise(
  OpenCodeSubscriptionStartInput
)
const decodeOpenCodeSubscriptionStatusInputPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionStatusInput)
const decodeWorkspaceArchiveInputPromise = Schema.decodeUnknownPromise(
  WorkspaceArchiveInput
)
const decodeWorkspaceCheckUpdatePromise =
  Schema.decodeUnknownPromise(WorkspaceCheckUpdate)
const decodeWorkspaceCheckpointInputPromise = Schema.decodeUnknownPromise(
  WorkspaceCheckpointInput
)
const decodeWorkspacePermissionReplyInputPromise = Schema.decodeUnknownPromise(
  WorkspacePermissionReplyInput
)
const decodeWorkspaceQuestionReplyInputPromise = Schema.decodeUnknownPromise(
  WorkspaceQuestionReplyInput
)
const decodeWorkspaceRepairCheckInputPromise = Schema.decodeUnknownPromise(
  WorkspaceRepairCheckInput
)
const decodeWorkspaceReadFileInputPromise = Schema.decodeUnknownPromise(
  WorkspaceReadFileInput
)
const decodeWorkspaceRetryCheckInputPromise = Schema.decodeUnknownPromise(
  WorkspaceRetryCheckInput
)
const decodeWorkspaceDisconnectUserInputPromise = Schema.decodeUnknownPromise(
  WorkspaceDisconnectUserInput
)
const decodeWorkspaceRuntimePromptInputPromise = Schema.decodeUnknownPromise(
  WorkspaceRuntimePromptInput
)
const decodeWorkspaceTurnCancelInputPromise = Schema.decodeUnknownPromise(
  WorkspaceTurnCancelInput
)
const encodeOpenCodeConnectionResultSync = Schema.encodeSync(
  OpenCodeConnectionResult
)
const encodeOpenCodeSubscriptionAttemptSync = Schema.encodeSync(
  OpenCodeSubscriptionAttempt
)
const encodeOpenCodeSubscriptionRuntimeStatusSync = Schema.encodeSync(
  OpenCodeSubscriptionRuntimeStatus
)
const encodeWorkspaceCheckRunListSync = Schema.encodeSync(WorkspaceCheckRunList)
const encodeWorkspaceCheckRunSync = Schema.encodeSync(WorkspaceCheckRun)
const encodeWorkspaceCheckpointResultSync = Schema.encodeSync(
  WorkspaceCheckpointResult
)
const encodeWorkspaceRebaseResultSync = Schema.encodeSync(WorkspaceRebaseResult)
const encodeWorkspaceRuntimeHealthSync = Schema.encodeSync(
  WorkspaceRuntimeHealth
)
const encodeWorkspaceSyncResultSync = Schema.encodeSync(WorkspaceSyncResult)
const encodeWorkspaceVersionControlSnapshotSync = Schema.encodeSync(
  WorkspaceVersionControlSnapshot
)
const encodeWorkspaceFileContentSync = Schema.encodeSync(WorkspaceFileContent)
const maxQueuedMessages = 5
const maxTurnDurationMs = 15 * 60 * 1000

const decodePermissionRequests = Schema.decodeUnknownSync(
  Schema.Array(WorkspacePermissionAskedEventData)
)
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
  eventCursor: integer("event_cursor"),
  archivedAt: integer("archived_at"),
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

interface WorkspaceBindings extends Cloudflare.Env {
  BROWSER: BrowserRun
  CHECK_EVIDENCE: R2Bucket
  CI_WORKFLOW: Workflow<WorkspaceCiInput>
  DB: D1Database
  REPOSITORY_NAMESPACE: string
  REPOS: Artifacts
}

const readOnlyMessage = "Archived Workspaces are read-only"
const readOnly = () =>
  new WorkspaceReadOnly({ message: readOnlyMessage, status: "archived" })
const notInitialized = (message: string) =>
  new WorkspaceRuntimeFailure({ message, reason: "not_initialized" })
const encodeArchiveResult = Schema.encodeSync(WorkspaceArchiveResult)
const encodeCheckUpdateResult = Schema.encodeSync(WorkspaceCheckUpdateResult)
const encodeRepairResult = Schema.encodeSync(WorkspaceRepairResult)
const encodeTurnCancelResult = Schema.encodeSync(WorkspaceTurnCancelResult)
const encodeSkillReloadResult = Schema.encodeSync(WorkspaceSkillReloadResult)

type ReviewStateRow = {
  decision: string | null
  unresolved: number
}
type WorkspaceStatusRow = { status: string }
type AcceptedCommitRow = { commit: string }
type DeploymentRow = {
  id: string
  commit: string
  status: string
  productionUrl: string | null
  createdAt: number
}

export class WorkspaceDO extends DurableObject<WorkspaceBindings> {
  readonly #database
  readonly #opencode: Promise<OpenCodeWorkerd.Interface>
  readonly #filesystem
  readonly #workspaceGit
  readonly #checks
  readonly #permissionBridge = createWorkspacePermissionBridge()
  readonly #skills = createWorkspaceSkillRegistry()
  readonly #openAIOAuth: OpenAIOAuthRequestState = {
    active: false,
    accountID: null,
  }
  readonly #credentials
  readonly #sockets

  constructor(context: DurableObjectState, bindings: WorkspaceBindings) {
    super(context, bindings)
    context.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    )
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
            models: {
              url: "https://models.opencode.ai",
              snapshot: false,
            },
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
                  assertWritable: () => this.#assertWritable(),
                  runChecks: async (input) => {
                    try {
                      const state = this.#requiredState()
                      const result = await this.#agentCheckpoint(input.message)
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
                  checkpoint: async (input) =>
                    this.#agentCheckpoint(input.message),
                  diff: async (scope) => this.#diff(scope),
                  requestMerge: async () => this.#requestMerge(),
                  preview: async () => this.#preview(),
                  production: async () => this.#production(),
                  browser: async (input) => this.#browser(input),
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
          session_id TEXT,
          event_cursor INTEGER,
          archived_at INTEGER
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
      if (!columns.includes("event_cursor")) {
        context.storage.sql.exec(
          "ALTER TABLE app_workspace_state ADD COLUMN event_cursor INTEGER"
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
      if (!columns.includes("archived_at")) {
        context.storage.sql.exec(
          "ALTER TABLE app_workspace_state ADD COLUMN archived_at INTEGER"
        )
      }

      return opencode
    })
    const credentialLayer = WorkspaceCredentials.layer(
      this.#opencode,
      context.storage,
      this.#openAIOAuth
    )
    this.#credentials = Effect.runSync(
      Effect.gen(function* () {
        return yield* WorkspaceCredentials
      }).pipe(Effect.provide(credentialLayer))
    )
    const socketLayer = WorkspaceSockets.layer(
      context,
      this.#opencode,
      () => this.#database.select().from(appWorkspaceState).get(),
      (cursor) => {
        this.#database
          .update(appWorkspaceState)
          .set({ eventCursor: cursor })
          .run()
      }
    )
    this.#sockets = Effect.runSync(
      Effect.gen(function* () {
        return yield* WorkspaceSockets
      }).pipe(Effect.provide(socketLayer))
    )
  }

  async alarm() {
    const opencode = await this.#opencode
    const state = this.#database.select().from(appWorkspaceState).get()
    if (!state?.sessionId) return
    const active = await opencode.sessions.active()
    if (!active[state.sessionId]) return
    const messages = await this.#messages(opencode, state.sessionId)
    const startedAt = activeTurnStartedAt(messages) ?? Date.now()
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
    const url = new URL(request.url)
    if (request.method !== "GET" || url.pathname !== "/socket") {
      return new Response("Not found", { status: 404 })
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 })
    }
    const userId = request.headers.get("x-sylph-user-id")
    const name = request.headers.get("x-sylph-user-name")
    const writable = request.headers.get("x-sylph-workspace-writable") === "1"
    if (!userId || !name) {
      return new Response("Workspace actor context is missing", { status: 403 })
    }

    const existing = this.ctx
      .getWebSockets(`user:${userId}`)
      .sort(
        (left, right) =>
          decodeWorkspaceSocketAttachment(left.deserializeAttachment())
            .connectedAt -
          decodeWorkspaceSocketAttachment(right.deserializeAttachment())
            .connectedAt
      )
    while (existing.length >= 5) {
      existing.shift()?.close(4008, "Workspace connection limit reached")
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server, [`user:${userId}`])
    server.serializeAttachment({
      userId,
      name,
      writable,
      connectedAt: Date.now(),
      sessionId: null,
      cursor: null,
      synced: false,
    } satisfies WorkspaceSocketAttachment)
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    return this.#sockets.webSocketMessage(socket, message)
  }

  webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ) {
    this.#sockets.webSocketClose(socket, code, reason, wasClean)
  }

  webSocketError(socket: WebSocket, cause: unknown) {
    this.#sockets.webSocketError(socket, cause)
  }

  connectKey(input: typeof OpenCodeKeySetupInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeOpenCodeKeySetupInputPromise(input)
      const opencode = await this.#opencode
      await this.#credentials.waitForIntegration(data.providerId)
      try {
        await connectOpenCodeKeyCredential(opencode, {
          providerId: data.providerId,
          key: data.apiKey,
          configuration: data.configuration,
        })
      } catch (error) {
        if (error instanceof OpenCodeCredentialReloadRequired) throw error
        throw new Error(
          `OpenCode could not connect to ${data.providerId}. Check the provider key and try again.`
        )
      }
      return encodeOpenCodeConnectionResultSync(
        await this.#connectionResult(opencode, data.providerId)
      )
    })
  }

  disconnectUser(input: typeof WorkspaceDisconnectUserInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspaceDisconnectUserInputPromise(input)
      this.#sockets.disconnectUser(data.userId)
    })
  }

  startSubscriptionSignIn(
    input: typeof OpenCodeSubscriptionStartInput.Encoded
  ) {
    return this.#run(async () => {
      await decodeOpenCodeSubscriptionStartInputPromise(input)
      const opencode = await this.#opencode
      await this.#credentials.waitForIntegration(subscriptionProviderId)
      const attempt = await opencode.integration.oauth.connect({
        integrationID: subscriptionProviderId,
        methodID: subscriptionMethodId,
        label: subscriptionCredentialLabel,
      })
      return encodeOpenCodeSubscriptionAttemptSync(
        new OpenCodeSubscriptionAttempt({
          attemptId: attempt.data.attemptID,
          url: attempt.data.url,
          instructions: attempt.data.instructions,
          expiresAt: Number(attempt.data.time.expires),
        })
      )
    })
  }

  subscriptionSignInStatus(
    input: typeof OpenCodeSubscriptionStatusInput.Encoded
  ) {
    return this.#run(async () => {
      const data = await decodeOpenCodeSubscriptionStatusInputPromise(input)
      const opencode = await this.#opencode
      const result = await opencode.integration.oauth
        .status({
          integrationID: subscriptionProviderId,
          attemptID: data.attemptId,
        })
        .catch(() => ({
          data: {
            status: "expired" as const,
            time: { created: Date.now(), expires: Date.now() },
          },
        }))

      if (result.data.status !== "complete") {
        return encodeOpenCodeSubscriptionRuntimeStatusSync(
          new OpenCodeSubscriptionRuntimeStatus({ status: result.data.status })
        )
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
      return encodeOpenCodeSubscriptionRuntimeStatusSync(
        new OpenCodeSubscriptionRuntimeStatus({
          status: "complete",
          credential,
          models: catalog.models,
          recommendedModelId: catalog.recommendedModelId,
        })
      )
    })
  }

  cancelSubscriptionSignIn(
    input: typeof OpenCodeSubscriptionStatusInput.Encoded
  ) {
    return this.#run(async () => {
      const data = await decodeOpenCodeSubscriptionStatusInputPromise(input)
      const opencode = await this.#opencode
      await opencode.integration.oauth
        .cancel({
          integrationID: subscriptionProviderId,
          attemptID: data.attemptId,
        })
        .catch(() => undefined)
    })
  }

  initialize(input: typeof InitializeWorkspaceRuntime.Encoded) {
    return this.#run(async () => {
      const data = await decodeInitializeWorkspaceRuntime(input)
      const opencode = await this.#opencode
      await this.#initialize(opencode, data)
      return encodeWorkspaceRuntimeHealthSync(await this.#snapshot(opencode))
    })
  }

  checkpoint(input: typeof WorkspaceCheckpointInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspaceCheckpointInputPromise(input)
      await this.#opencode
      this.#assertWritable()
      const result = await this.#workspaceGit.checkpoint({
        idempotencyKey: data.idempotencyKey,
        message: data.message,
      })
      await this.#recordVersionControl(true)
      const state = this.#requiredState()
      await this.#startCheckpointCheck(
        state.workspaceId,
        result.checkpoint.id,
        result.checkpoint.commit,
        data.repairOnFailure ?? false
      )
      return encodeWorkspaceCheckpointResultSync(result)
    })
  }

  listChecks() {
    return this.#run(async () => {
      await this.#opencode
      return encodeWorkspaceCheckRunListSync(this.#checks.list())
    })
  }

  readFile(input: typeof WorkspaceReadFileInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspaceReadFileInputPromise(input)
      const state = this.#requiredState()
      if (state.workspaceId !== data.workspaceId) {
        throw new InvalidRequest({
          message: "File belongs to another Workspace",
        })
      }
      try {
        const file = await this.#filesystem.stat(data.path)
        const content =
          file.size > workspaceFileDisplayLimit
            ? null
            : await this.#filesystem.readFile(data.path)
        const encoding = workspaceFileEncoding(file.size, content)
        return encodeWorkspaceFileContentSync(
          new WorkspaceFileContent({
            path: data.path,
            size: file.size,
            updatedAt: file.mtimeMs,
            encoding,
            content:
              encoding === "utf8" && content
                ? new TextDecoder().decode(content)
                : null,
          })
        )
      } catch (cause) {
        if (workspaceFilesystemErrorCode(cause) === "ENOENT") {
          throw new WorkspaceFileNotFound({
            message: "Workspace File no longer exists",
            path: data.path,
          })
        }
        throw cause
      }
    })
  }

  applyCheckUpdate(update: typeof WorkspaceCheckUpdate.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspaceCheckUpdatePromise(update)
      const opencode = await this.#opencode
      const previous = this.#checks.get(data.run.id)
      const applied = this.#checks.apply(data)
      if (applied) {
        const event = new WorkspaceRuntimeEvent({
          id: `check-${data.run.id}-${data.run.attempt}-${Date.now()}`,
          created: Date.now(),
          type: "workspace.check.updated",
          data: data.run,
        })
        this.#sockets.broadcast(event)
      }
      if (applied && previous?.status !== data.run.status) {
        await this.#afterCheckUpdate(opencode, data.run).catch((cause) =>
          console.error(
            "Workspace check notification failed",
            cause instanceof Error ? cause.stack : cause
          )
        )
      }
      return encodeCheckUpdateResult(
        new WorkspaceCheckUpdateResult({ applied })
      )
    })
  }

  archive(input: typeof WorkspaceArchiveInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspaceArchiveInputPromise(input)
      const opencode = await this.#opencode
      const state = this.#database.select().from(appWorkspaceState).get()
      if (!state) {
        return encodeArchiveResult(
          new WorkspaceArchiveResult({ archivedAt: null })
        )
      }
      if (state.workspaceId !== data.workspaceId) {
        throw new InvalidRequest({
          message: "Archive belongs to another Workspace",
        })
      }
      const archivedAt = state.archivedAt ?? Date.now()
      if (state.sessionId && state.archivedAt === null) {
        const sessionId = state.sessionId
        await opencode.sessions
          .interrupt({ sessionID: sessionId, continue: false })
          .catch(() => undefined)
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
      this.#database.update(appWorkspaceState).set({ archivedAt }).run()
      await this.env.DB.prepare(
        "UPDATE agent_sessions SET status = 'archived', archived_at = unixepoch(), updated_at = unixepoch() WHERE workspace_id = ?"
      )
        .bind(state.workspaceId)
        .run()
      this.#sockets.archive()
      return encodeArchiveResult(new WorkspaceArchiveResult({ archivedAt }))
    })
  }

  retryCheck(input: typeof WorkspaceRetryCheckInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspaceRetryCheckInputPromise(input)
      await this.#opencode
      const state = this.#requiredState()
      if (data.workspaceId !== state.workspaceId) {
        throw new InvalidRequest({
          message: "Check retry belongs to another Workspace",
        })
      }
      this.#assertWritable()
      const run = this.#checks.retry(data.runId, data.idempotencyKey)
      await this.#startWorkflow(run)
      return encodeWorkspaceCheckRunSync(run)
    })
  }

  repairCheck(input: typeof WorkspaceRepairCheckInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspaceRepairCheckInputPromise(input)
      const opencode = await this.#opencode
      const state = this.#requiredState()
      if (data.workspaceId !== state.workspaceId) {
        throw new InvalidRequest({
          message: "Check repair belongs to another Workspace",
        })
      }
      this.#assertWritable()
      const repair = await this.#startRepairTurn(
        opencode,
        data.runId,
        data.idempotencyKey,
        "manual"
      )
      return encodeRepairResult(
        new WorkspaceRepairResult({ started: repair.started })
      )
    })
  }

  updateProject() {
    return this.#run(async () => {
      await this.#opencode
      return encodeWorkspaceSyncResultSync(
        new WorkspaceSyncResult(await this.#syncProjectAndCheck())
      )
    })
  }

  rebase() {
    return this.#run(async () => {
      await this.#opencode
      this.#assertWritable()
      const result = await this.#workspaceGit.rebase()
      await this.#recordVersionControl(false)
      return encodeWorkspaceRebaseResultSync(result)
    })
  }

  versionControl(refreshProjectHead: boolean) {
    return this.#run(async () => {
      await this.#opencode
      if (!this.#workspaceGit.hydrated()) return null
      return encodeWorkspaceVersionControlSnapshotSync(
        new WorkspaceVersionControlSnapshot({
          vcs: await this.#workspaceGit.versionControl(refreshProjectHead),
          checkpoints: this.#workspaceGit.checkpoints(),
        })
      )
    })
  }

  prompt(input: typeof WorkspaceRuntimePromptInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspaceRuntimePromptInputPromise(input)
      const opencode = await this.#opencode
      const state = this.#database.select().from(appWorkspaceState).get()

      if (!state || state.workspaceId !== data.workspaceId) {
        throw notInitialized("Workspace runtime is not initialized")
      }
      if (!state.sessionId) {
        throw notInitialized("OpenCode session is not initialized")
      }
      if (state.archivedAt !== null) throw readOnly()
      const sessionId = state.sessionId
      const nextCredentialFingerprint = await credentialFingerprint(
        data.credential
      )
      const activeSessions = await opencode.sessions.active()
      const turnActive = Boolean(activeSessions[sessionId])
      if (turnActive && !data.delivery) {
        throw new PreconditionFailed({
          message: "Choose queue or steer while an agent Turn is active",
        })
      }
      if (!turnActive && data.delivery === "steer") {
        throw new PreconditionFailed({
          message: "There is no active Turn to steer",
        })
      }
      if (
        turnActive &&
        (state.providerId !== data.model.providerId ||
          state.modelId !== data.model.modelId)
      ) {
        throw new PreconditionFailed({
          message: "Wait for the active Turn to finish before changing models",
        })
      }
      if (data.delivery === "queue") {
        const inbox = await opencode.sessions.inbox.list({
          sessionID: sessionId,
        })
        const queued = inbox.filter(
          (item) => item.type === "user" && item.delivery === "queue"
        )
        if (queued.length >= maxQueuedMessages) {
          throw new PreconditionFailed({
            message: `This Conversation already has ${maxQueuedMessages} queued messages`,
          })
        }
      }

      try {
        if (!turnActive) {
          if (state.credentialFingerprint !== nextCredentialFingerprint) {
            await this.#credentials.install(
              data.model.providerId,
              data.credential
            )
          }
          await opencode.sessions.switchModel({
            sessionID: sessionId,
            model: {
              providerID: data.model.providerId,
              id: data.model.modelId,
            },
          })
        }
        this.#database
          .update(appWorkspaceState)
          .set({
            providerId: data.model.providerId,
            modelId: data.model.modelId,
            credentialFingerprint: nextCredentialFingerprint,
          })
          .run()
      } catch (error) {
        const detail = providerFailureDetail(error)
        throw new Error(
          detail
            ? `OpenCode could not use ${data.model.providerId}/${data.model.modelId}: ${detail}`
            : `OpenCode could not use ${data.model.providerId}/${data.model.modelId}. Choose another available model.`
        )
      }

      const invocation = resolveSkillInvocation(data.text, this.#skills.list())
      this.#checks.resetAutomaticRepairs(`prompt:${Date.now()}`)
      await opencode.sessions.prompt({
        sessionID: sessionId,
        text: invocation
          ? invocation.text || "Follow the attached Skill instructions."
          : data.text,
        skills: invocation ? [{ id: invocation.skillId }] : undefined,
        delivery: data.delivery,
      })
      if (data.delivery !== "queue") await this.#scheduleTurnLimit()
      return encodeWorkspaceRuntimeHealthSync(await this.#snapshot(opencode))
    })
  }

  cancelTurn(input: typeof WorkspaceTurnCancelInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspaceTurnCancelInputPromise(input)
      const opencode = await this.#opencode
      const state = this.#database.select().from(appWorkspaceState).get()
      if (!state?.sessionId) {
        return encodeTurnCancelResult(
          new WorkspaceTurnCancelResult({ interrupted: false })
        )
      }
      if (state.workspaceId !== data.workspaceId) {
        throw new InvalidRequest({
          message: "Turn belongs to another Workspace",
        })
      }
      const sessionId = state.sessionId
      const result = await opencode.sessions.interrupt({
        sessionID: sessionId,
        continue: data.continueQueued ?? false,
      })
      if (!data.continueQueued) {
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
      return encodeTurnCancelResult(
        new WorkspaceTurnCancelResult({ interrupted: result.interrupted })
      )
    })
  }

  reloadSkills() {
    return this.#run(async () => {
      await this.#opencode
      const state = this.#requiredState()
      await this.#skills.replace(
        await loadInstalledSkills(
          this.env.DB,
          state.organizationId,
          state.projectId
        )
      )
      return encodeSkillReloadResult(
        new WorkspaceSkillReloadResult({ skills: this.#skills.list().length })
      )
    })
  }

  replyPermission(input: typeof WorkspacePermissionReplyInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspacePermissionReplyInputPromise(input)
      const opencode = await this.#opencode
      const state = this.#database.select().from(appWorkspaceState).get()

      if (!state || state.workspaceId !== data.workspaceId) {
        throw notInitialized("Workspace runtime is not initialized")
      }
      if (!state.sessionId) {
        throw notInitialized("OpenCode session is not initialized")
      }
      if (state.archivedAt !== null) throw readOnly()

      await opencode.permission.reply({
        sessionID: state.sessionId,
        requestID: data.requestId,
        reply: data.reply,
        message: data.message,
      })
      this.#permissionBridge.reply(data.requestId, data.reply)
    })
  }

  answerQuestion(input: typeof WorkspaceQuestionReplyInput.Encoded) {
    return this.#run(async () => {
      const data = await decodeWorkspaceQuestionReplyInputPromise(input)
      const opencode = await this.#opencode
      const state = this.#requiredState()
      if (state.workspaceId !== data.workspaceId || !state.sessionId) {
        throw new InvalidRequest({
          message: "Agent question belongs to another Workspace",
        })
      }
      if (state.archivedAt !== null) throw readOnly()
      await opencode.form.reply({
        sessionID: state.sessionId,
        formID: data.questionId,
        answer: data.answer,
      })
    })
  }

  discard() {
    return this.#run(async () => {
      const opencode = await this.#opencode
      const state = this.#requiredState()
      if (state.sessionId) {
        await opencode.sessions
          .interrupt({ sessionID: state.sessionId, continue: false })
          .catch(() => undefined)
      }
      this.#sockets.stop()
      await opencode.close()
      await this.ctx.storage.deleteAll()
    })
  }

  evict() {
    this.#sockets.stop()
    this.ctx.abort("Sylph requested Workspace runtime eviction", {
      retryAlarm: false,
    })
  }

  snapshot() {
    return this.#run(async () =>
      encodeWorkspaceRuntimeHealthSync(
        await this.#snapshot(await this.#opencode)
      )
    )
  }

  async #run<Value>(operation: () => Promise<Value>) {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof OpenCodeCredentialReloadRequired) {
        throw new Error(
          serializeServerFailure(
            new WorkspaceRuntimeFailure({
              message: "Workspace runtime credential store refreshed",
            })
          )
        )
      }
      if (isServerFailure(error)) {
        throw new Error(serializeServerFailure(error))
      }
      console.error(
        "Workspace runtime request failed",
        error instanceof Error ? error.stack : error
      )
      throw error
    }
  }

  #requiredState() {
    const state = this.#database.select().from(appWorkspaceState).get()
    if (!state) throw notInitialized("Workspace runtime is not initialized")
    return state
  }

  #isArchived() {
    const state = this.#database.select().from(appWorkspaceState).get()
    return state?.archivedAt !== null && state?.archivedAt !== undefined
  }

  #assertWritable() {
    if (this.#isArchived()) throw readOnly()
  }

  async #agentCheckpoint(message: string) {
    this.#assertWritable()
    const result = await this.#workspaceGit.checkpoint({
      idempotencyKey: crypto.randomUUID(),
      message,
    })
    await this.#recordVersionControl(true)
    return result
  }

  async #recordVersionControl(checkpointed: boolean) {
    const state = this.#requiredState()
    const versionControl = await this.#workspaceGit.versionControl()
    await this.env.DB.prepare(
      checkpointed
        ? "UPDATE workspace SET base_commit = ?, fork_head = ?, sync_status = ?, merge_status = ?, latest_checkpoint_at = unixepoch(), error_summary = NULL, updated_at = unixepoch() WHERE id = ?"
        : "UPDATE workspace SET base_commit = ?, fork_head = ?, sync_status = ?, merge_status = ?, updated_at = unixepoch() WHERE id = ?"
    )
      .bind(
        versionControl.baseCommit,
        versionControl.forkHead,
        versionControl.syncStatus,
        versionControl.mergeStatus,
        state.workspaceId
      )
      .run()
    return versionControl
  }

  async #promptSession(opencode: OpenCodeWorkerd.Interface, text: string) {
    const state = this.#requiredState()
    if (!state.sessionId) {
      throw notInitialized("OpenCode session is not initialized")
    }
    if (state.archivedAt !== null) return false
    const sessionId = state.sessionId
    const active = await opencode.sessions.active()
    const turnActive = Boolean(active[sessionId])
    await opencode.sessions.prompt({
      sessionID: sessionId,
      text,
      delivery: turnActive ? "queue" : null,
    })
    if (!turnActive) await this.#scheduleTurnLimit()
    return true
  }

  async #afterCheckUpdate(
    opencode: OpenCodeWorkerd.Interface,
    run: WorkspaceCheckRun
  ) {
    if (run.kind !== "checkpoint" || !isTerminalCheckStatus(run.status)) return
    if (this.#isArchived()) return
    if (run.status === "passed") {
      await this.#promptSession(opencode, checkPassedNotification(run))
      return
    }
    if (run.repairOnFailure) {
      const repair = await this.#startRepairTurn(
        opencode,
        run.id,
        automaticRepairIdempotencyKey(run.id),
        "automatic"
      )
      if (repair.started) return
      await this.#promptSession(
        opencode,
        checkFailedNotification(run, { reason: repair.reason })
      )
      return
    }
    await this.#promptSession(
      opencode,
      checkFailedNotification(run, { reason: repairDisabledReason })
    )
  }

  async #startRepairTurn(
    opencode: OpenCodeWorkerd.Interface,
    runId: string,
    idempotencyKey: string,
    source: WorkspaceRepairSource
  ) {
    try {
      this.#checks.requestRepair(runId, idempotencyKey, source)
    } catch (cause) {
      if (cause instanceof WorkspaceRepairLimitReached) {
        this.#checks.recordRepairNotice(runId, cause.message)
        return { started: false, reason: cause.message }
      }
      throw cause
    }
    const run = this.#checks.takeRepair(runId)
    if (!run) {
      return {
        started: false,
        reason: "A repair turn already started for this Check.",
      }
    }
    const prompted = await this.#promptSession(opencode, checkRepairPrompt(run))
    return prompted
      ? { started: true, reason: "" }
      : { started: false, reason: readOnlyMessage }
  }

  async #diff(scope: WorkspaceDiffScope) {
    return workspaceDiff(await this.#workspaceGit.versionControl(), scope)
  }

  async #requestMerge() {
    const opencode = await this.#opencode
    const state = this.#requiredState()
    const versionControl = await this.#workspaceGit.versionControl(true)
    const [statusRow, reviewRow, active] = await Promise.all([
      this.env.DB.prepare("SELECT status FROM workspace WHERE id = ?")
        .bind(state.workspaceId)
        .first<WorkspaceStatusRow>(),
      this.env.DB.prepare(
        'SELECT review.decision AS decision, (SELECT COUNT(*) FROM workspace_review_comment comment WHERE comment.review_id = review.id AND comment.resolved_at IS NULL) AS unresolved FROM workspace_review review WHERE review.workspace_id = ? AND review."commit" = ?'
      )
        .bind(state.workspaceId, versionControl.forkHead)
        .first<ReviewStateRow>(),
      opencode.sessions.active(),
    ])
    return workspaceMergeRequest({
      versionControl,
      checks: this.#checks.list(),
      workspaceStatus: statusRow?.status ?? "ready",
      reviewDecision: reviewDecisionFromRow(reviewRow?.decision),
      unresolvedComments: reviewRow?.unresolved ?? 0,
      turnActive: Boolean(state.sessionId && active[state.sessionId]),
    })
  }

  async #preview() {
    const state = this.#requiredState()
    const versionControl = await this.#workspaceGit.versionControl()
    const current =
      this.#checks
        .list()
        .find(
          (run) =>
            run.kind === "checkpoint" && run.commit === versionControl.forkHead
        ) ?? null
    if (current?.previewUrl) {
      return new WorkspacePreviewResult({
        status: "ready",
        commit: versionControl.forkHead,
        checkId: current.id,
        previewUrl: current.previewUrl,
        evidence: current.evidence,
        detail: "The Preview for the current Checkpoint is reachable.",
      })
    }
    if (current && current.status === "failed") {
      return new WorkspacePreviewResult({
        status: "failed",
        commit: versionControl.forkHead,
        checkId: current.id,
        previewUrl: null,
        evidence: current.evidence,
        detail:
          "The current Checkpoint failed its Check. Read workspace_check_status, repair the failure, and run Workspace checks again.",
      })
    }
    if (current) {
      return new WorkspacePreviewResult({
        status: "pending",
        commit: versionControl.forkHead,
        checkId: current.id,
        previewUrl: null,
        evidence: [],
        detail:
          "The Check for the current Checkpoint is still running. Sylph will deliver its result to this Conversation.",
      })
    }
    if (versionControl.working.length) {
      this.#assertWritable()
      const checkpoint = await this.#agentCheckpoint("Preview Checkpoint")
      const run = await this.#startCheckpointCheck(
        state.workspaceId,
        checkpoint.checkpoint.id,
        checkpoint.checkpoint.commit,
        false
      )
      return new WorkspacePreviewResult({
        status: "pending",
        commit: run.commit,
        checkId: run.id,
        previewUrl: null,
        evidence: [],
        detail:
          "Created a Checkpoint and started its Check. Sylph will deliver the Preview URL to this Conversation when it is ready.",
      })
    }
    const checkpoint = this.#workspaceGit
      .checkpoints()
      .find((candidate) => candidate.commit === versionControl.forkHead)
    if (!checkpoint) {
      throw new Error(
        "Nothing to preview yet. Change files, then run workspace_run_checks to build the first Preview."
      )
    }
    this.#assertWritable()
    const run = await this.#startCheckpointCheck(
      state.workspaceId,
      checkpoint.id,
      checkpoint.commit,
      false
    )
    return new WorkspacePreviewResult({
      status: "pending",
      commit: run.commit,
      checkId: run.id,
      previewUrl: null,
      evidence: [],
      detail:
        "Started the Check for the current Checkpoint. Sylph will deliver the Preview URL to this Conversation when it is ready.",
    })
  }

  async #production() {
    const state = this.#requiredState()
    const [accepted, deployments] = await Promise.all([
      this.env.DB.prepare(
        'SELECT accepted_commit AS "commit" FROM workspace WHERE project_id = ? AND accepted_commit IS NOT NULL ORDER BY archived_at DESC'
      )
        .bind(state.projectId)
        .all<AcceptedCommitRow>(),
      this.env.DB.prepare(
        'SELECT id, "commit", status, production_url AS productionUrl, created_at AS createdAt FROM deployment WHERE project_id = ? ORDER BY created_at DESC LIMIT 10'
      )
        .bind(state.projectId)
        .all<DeploymentRow>(),
    ])
    return new WorkspaceProductionStatus({
      acceptedCommits: [
        ...new Set(accepted.results.map((row) => row.commit)),
      ].map((commit) => GitCommitId.make(commit)),
      deployments: deployments.results.map(
        (row) =>
          new WorkspaceProductionDeployment({
            id: row.id,
            commit: GitCommitId.make(row.commit),
            status: row.status,
            productionUrl: row.productionUrl,
            createdAt: row.createdAt * 1000,
          })
      ),
      instructions:
        "Production deploys and rollbacks require an Admin to confirm the exact Accepted commit in the Deployments tab or Project settings. Ask the user to deploy; the agent cannot.",
    })
  }

  async #browser(input: { path?: string; url?: string; fullPage: boolean }) {
    const state = this.#requiredState()
    const versionControl = await this.#workspaceGit.versionControl()
    const preview = previewForBrowser(
      this.#checks.list(),
      versionControl.forkHead
    )
    const target = browserTargetUrl({
      previewUrl: preview.previewUrl,
      path: input.path,
      url: input.url,
    })
    const response = await this.env.BROWSER.quickAction("snapshot", {
      url: target,
      formats: ["markdown", "screenshot", "accessibilityTree"],
      viewport: { width: 1440, height: 900 },
      gotoOptions: { waitUntil: "networkidle2", timeout: 60_000 },
      screenshotOptions: { type: "png", fullPage: input.fullPage },
      cacheTTL: 0,
    })
    if (!response.ok) throw new Error(await response.text())
    const snapshot = await response.json<BrowserRunSnapshotSuccessResponse>()
    const screenshot = snapshot.result.screenshot
    if (!screenshot) throw new Error("Browser Run returned no screenshot")
    const accessibility = JSON.stringify(
      snapshot.result.accessibilityTree ?? null
    )
    const createdAt = Date.now()
    const ids = browserEvidenceIds({
      runId: preview.run.id,
      sequence: createdAt,
    })
    await Promise.all([
      this.env.CHECK_EVIDENCE.put(
        `${state.workspaceId}/${ids.screenshot}`,
        bytesFromBase64(screenshot),
        { httpMetadata: { contentType: "image/png" } }
      ),
      this.env.CHECK_EVIDENCE.put(
        `${state.workspaceId}/${ids.accessibility}`,
        accessibility,
        { httpMetadata: { contentType: "application/json" } }
      ),
    ])
    const path = new URL(target).pathname
    const evidence = [
      new WorkspaceCheckEvidence({
        id: ids.screenshot,
        kind: "screenshot",
        label: `Agent browser ${path}`,
        url: evidenceUrl(state.workspaceId, ids.screenshot),
        createdAt,
      }),
      new WorkspaceCheckEvidence({
        id: ids.accessibility,
        kind: "accessibility",
        label: `Agent accessibility ${path}`,
        url: evidenceUrl(state.workspaceId, ids.accessibility),
        createdAt,
      }),
    ]
    this.#checks.addEvidence(preview.run.id, evidence)
    return browserResult({
      url: target,
      run: preview.run,
      markdown: snapshot.result.markdown ?? "",
      accessibility,
      evidence,
    })
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
    const run = newCheckRun({
      id,
      workspaceId,
      checkpointId,
      commit,
      kind: "checkpoint",
      attempt: 1,
      repairOnFailure,
      createdAt: Date.now(),
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
      projectId: ProjectId.make(state.projectId),
      workspaceId: run.workspaceId,
      agentSessionId: state.sessionId,
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
    this.#assertWritable()
    const result = await this.#workspaceGit.syncProject()
    const state = this.#requiredState()
    const versionControl = await this.#recordVersionControl(false)
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
      sourceRef: input.sourceRef,
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
        archivedAt: input.archivedAt ?? existing?.archivedAt ?? null,
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
          archivedAt: input.archivedAt ?? existing?.archivedAt ?? null,
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
      await this.#credentials.install(input.providerId, input.credential)
      this.#database
        .update(appWorkspaceState)
        .set({
          credentialFingerprint: await credentialFingerprint(input.credential),
        })
        .run()
    } catch (error) {
      if (error instanceof OpenCodeCredentialReloadRequired) throw error
      const detail = providerFailureDetail(error)
      const failure =
        error instanceof Error
          ? error
          : detail
            ? { _tag: "InvalidRequestError" as const, message: detail }
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
    await this.env.DB.prepare(
      "INSERT INTO agent_sessions (id, workspace_id, opencode_session_id, title, status, model_override, created_at, updated_at) VALUES (?, ?, ?, ?, 'ready', ?, unixepoch(), unixepoch()) ON CONFLICT(id) DO UPDATE SET title = excluded.title, model_override = excluded.model_override, updated_at = unixepoch()"
    )
      .bind(
        sessionId,
        input.workspaceId,
        sessionId,
        input.projectName,
        `${input.providerId}/${input.modelId}`
      )
      .run()

    try {
      await opencode.sessions.switchModel({
        sessionID: sessionId,
        model: { providerID: input.providerId, id: input.modelId },
      })
    } catch (error) {
      const detail = providerFailureDetail(error)
      throw new Error(
        detail
          ? `OpenCode could not use ${input.providerId}/${input.modelId}: ${detail}`
          : `OpenCode could not use ${input.providerId}/${input.modelId}. Update the model and try again.`
      )
    }
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

  async #scheduleTurnLimit() {
    const scheduled = await this.ctx.storage.getAlarm()
    const deadline = Date.now() + maxTurnDurationMs
    if (scheduled === null || scheduled > deadline) {
      await this.ctx.storage.setAlarm(deadline)
    }
  }

  async #messages(opencode: OpenCodeWorkerd.Interface, sessionId: string) {
    return listWorkspaceMessages<WorkspaceRuntimeMessageSource>(
      sessionId,
      (input) => opencode.message.list(input)
    )
  }

  async #snapshot(opencode: OpenCodeWorkerd.Interface) {
    const state = this.#database.select().from(appWorkspaceState).get()
    const health = await opencode.health.get()
    const limits = {
      maxQueuedMessages,
      maxTurnDurationMs,
      maxCheckAttempts: maxWorkspaceCheckAttempts,
      maxRepairAttempts: maxWorkspaceRepairAttempts,
      maxAutomaticRepairs: maxWorkspaceAutomaticRepairs,
    }

    if (!state?.sessionId) {
      return new WorkspaceRuntimeHealth({
        workspaceId: state ? WorkspaceId.make(state.workspaceId) : null,
        sessionId: null,
        eventCursor: state?.eventCursor ?? null,
        status: health.healthy ? "provisioning" : "error",
        model: null,
        files: [],
        messages: [],
        queuedMessages: [],
        questions: [],
        permissions: [],
        lastTurnOutcome: null,
        activeTurnStartedAt: null,
        limits,
        automaticRepairsUsed: this.#checks.automaticRepairsUsed(),
        archivedAt: state?.archivedAt ?? null,
        opencode: { healthy: health.healthy },
      })
    }
    const sessionId = state.sessionId

    const [active, session, messages, inbox, forms, permissions] =
      await Promise.all([
        opencode.sessions.active(),
        opencode.sessions.get({ sessionID: sessionId }),
        this.#messages(opencode, sessionId),
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

    return new WorkspaceRuntimeHealth({
      workspaceId: WorkspaceId.make(state.workspaceId),
      sessionId: AgentSessionId.make(sessionId),
      eventCursor: state.eventCursor,
      status: workspaceRuntimeStatus(turnActive, messages, session.outcome),
      model:
        state.providerId && state.modelId
          ? `${state.providerId}/${state.modelId}`
          : null,
      files,
      messages: workspaceRuntimeMessages(messages),
      queuedMessages: inbox.flatMap((item) =>
        item.type === "user"
          ? [
              new WorkspaceQueuedMessage({
                id: item.id,
                text: item.payload.text,
                createdAt: item.timeCreated,
                delivery: item.delivery,
              }),
            ]
          : []
      ),
      questions,
      permissions: decodePermissionRequests(
        permissions.data.filter((request) => request.sessionID === sessionId)
      ),
      lastTurnOutcome: session.outcome ?? null,
      activeTurnStartedAt: turnActive ? activeTurnStartedAt(messages) : null,
      limits,
      automaticRepairsUsed: this.#checks.automaticRepairsUsed(),
      archivedAt: state.archivedAt,
      opencode: { healthy: health.healthy },
    })
  }
}
