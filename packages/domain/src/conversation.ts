import { Schema } from "effect"

import { AgentSessionId, OrganizationId, ProjectId, WorkspaceId } from "./ids"
import { OpenCodeCredential, ModelSelection } from "./provider-connection"

export class InitializeWorkspaceRuntime extends Schema.Class<InitializeWorkspaceRuntime>(
  "@sylph/domain/InitializeWorkspaceRuntime"
)({
  organizationId: OrganizationId,
  projectId: ProjectId,
  workspaceId: WorkspaceId,
  projectName: Schema.NonEmptyString,
  repositoryName: Schema.NonEmptyString,
  repositoryRemote: Schema.NonEmptyString,
  projectRepositoryName: Schema.NonEmptyString,
  projectRepositoryRemote: Schema.NonEmptyString,
  defaultRef: Schema.NonEmptyString,
  baseCommit: Schema.NonEmptyString,
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
  credential: OpenCodeCredential,
  archivedAt: Schema.optional(Schema.NullOr(Schema.Number)),
}) {}

export class WorkspacePromptInput extends Schema.Class<WorkspacePromptInput>(
  "@sylph/domain/WorkspacePromptInput"
)({
  workspaceId: WorkspaceId,
  text: Schema.NonEmptyString,
  model: Schema.optional(ModelSelection),
  delivery: Schema.optional(Schema.Literals(["queue", "steer"])),
}) {}

export class WorkspaceRuntimePromptInput extends Schema.Class<WorkspaceRuntimePromptInput>(
  "@sylph/domain/WorkspaceRuntimePromptInput"
)({
  workspaceId: WorkspaceId,
  text: Schema.NonEmptyString,
  model: ModelSelection,
  credential: OpenCodeCredential,
  delivery: Schema.optional(Schema.Literals(["queue", "steer"])),
}) {}

export const WorkspaceQuestionValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Array(Schema.String),
])
export type WorkspaceQuestionValue = typeof WorkspaceQuestionValue.Type

export class WorkspaceQuestionOption extends Schema.Class<WorkspaceQuestionOption>(
  "@sylph/domain/WorkspaceQuestionOption"
)({
  value: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
}) {}

export class WorkspaceQuestionField extends Schema.Class<WorkspaceQuestionField>(
  "@sylph/domain/WorkspaceQuestionField"
)({
  key: Schema.NonEmptyString,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
  type: Schema.Literals([
    "string",
    "number",
    "integer",
    "boolean",
    "multiselect",
    "external",
  ]),
  options: Schema.Array(WorkspaceQuestionOption),
  placeholder: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  defaultValue: Schema.optional(WorkspaceQuestionValue),
}) {}

export class WorkspaceAgentQuestion extends Schema.Class<WorkspaceAgentQuestion>(
  "@sylph/domain/WorkspaceAgentQuestion"
)({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  status: Schema.Literals(["pending", "answered", "cancelled"]),
  fields: Schema.Array(WorkspaceQuestionField),
  answer: Schema.NullOr(Schema.Record(Schema.String, WorkspaceQuestionValue)),
}) {}

export class WorkspaceQuestionReplyInput extends Schema.Class<WorkspaceQuestionReplyInput>(
  "@sylph/domain/WorkspaceQuestionReplyInput"
)({
  workspaceId: WorkspaceId,
  questionId: Schema.NonEmptyString,
  answer: Schema.Record(Schema.String, WorkspaceQuestionValue),
}) {}

export const WorkspacePermissionReply = Schema.Literals([
  "once",
  "always",
  "reject",
])
export type WorkspacePermissionReply = typeof WorkspacePermissionReply.Type

export class WorkspacePermissionReplyInput extends Schema.Class<WorkspacePermissionReplyInput>(
  "@sylph/domain/WorkspacePermissionReplyInput"
)({
  workspaceId: WorkspaceId,
  requestId: Schema.NonEmptyString,
  reply: WorkspacePermissionReply,
  message: Schema.optional(Schema.String),
}) {}

export class WorkspaceRuntimeEvent extends Schema.Class<WorkspaceRuntimeEvent>(
  "@sylph/domain/WorkspaceRuntimeEvent"
)({
  id: Schema.NonEmptyString,
  created: Schema.Number,
  type: Schema.NonEmptyString,
  data: Schema.Unknown,
  metadata: Schema.optional(Schema.Unknown),
  durable: Schema.optional(
    Schema.Struct({
      aggregateID: Schema.optional(Schema.String),
      seq: Schema.Int,
      version: Schema.optional(Schema.Int),
    })
  ),
  location: Schema.optional(Schema.Unknown),
}) {}

export class WorkspaceSocketHello extends Schema.Class<WorkspaceSocketHello>(
  "@sylph/domain/WorkspaceSocketHello"
)({
  type: Schema.Literals(["hello"]),
  sessionId: AgentSessionId,
  cursor: Schema.NullOr(Schema.Int),
}) {}

export class WorkspaceTerminalOpen extends Schema.Class<WorkspaceTerminalOpen>(
  "@sylph/domain/WorkspaceTerminalOpen"
)({
  type: Schema.Literals(["terminal.open"]),
  terminalId: Schema.NonEmptyString,
  cols: Schema.Int,
  rows: Schema.Int,
}) {}

export class WorkspaceTerminalInput extends Schema.Class<WorkspaceTerminalInput>(
  "@sylph/domain/WorkspaceTerminalInput"
)({
  type: Schema.Literals(["terminal.input"]),
  terminalId: Schema.NonEmptyString,
  data: Schema.String,
}) {}

export class WorkspaceTerminalResize extends Schema.Class<WorkspaceTerminalResize>(
  "@sylph/domain/WorkspaceTerminalResize"
)({
  type: Schema.Literals(["terminal.resize"]),
  terminalId: Schema.NonEmptyString,
  cols: Schema.Int,
  rows: Schema.Int,
}) {}

export class WorkspaceTerminalClose extends Schema.Class<WorkspaceTerminalClose>(
  "@sylph/domain/WorkspaceTerminalClose"
)({
  type: Schema.Literals(["terminal.close"]),
  terminalId: Schema.NonEmptyString,
}) {}

export const WorkspaceSocketClientFrame = Schema.Union([
  WorkspaceSocketHello,
  WorkspaceTerminalOpen,
  WorkspaceTerminalInput,
  WorkspaceTerminalResize,
  WorkspaceTerminalClose,
])
export type WorkspaceSocketClientFrame = typeof WorkspaceSocketClientFrame.Type

export class WorkspaceSocketEvent extends Schema.Class<WorkspaceSocketEvent>(
  "@sylph/domain/WorkspaceSocketEvent"
)({
  type: Schema.Literals(["event"]),
  event: WorkspaceRuntimeEvent,
}) {}

export class WorkspaceSocketSynced extends Schema.Class<WorkspaceSocketSynced>(
  "@sylph/domain/WorkspaceSocketSynced"
)({
  type: Schema.Literals(["synced"]),
  cursor: Schema.NullOr(Schema.Int),
}) {}

export class WorkspacePresenceUser extends Schema.Class<WorkspacePresenceUser>(
  "@sylph/domain/WorkspacePresenceUser"
)({
  userId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  connections: Schema.Int,
}) {}

export class WorkspaceSocketPresence extends Schema.Class<WorkspaceSocketPresence>(
  "@sylph/domain/WorkspaceSocketPresence"
)({
  type: Schema.Literals(["presence"]),
  users: Schema.Array(WorkspacePresenceUser),
}) {}

export class WorkspaceTerminalOutput extends Schema.Class<WorkspaceTerminalOutput>(
  "@sylph/domain/WorkspaceTerminalOutput"
)({
  type: Schema.Literals(["terminal.output"]),
  terminalId: Schema.NonEmptyString,
  data: Schema.String,
}) {}

export class WorkspaceTerminalExited extends Schema.Class<WorkspaceTerminalExited>(
  "@sylph/domain/WorkspaceTerminalExited"
)({
  type: Schema.Literals(["terminal.exited"]),
  terminalId: Schema.NonEmptyString,
  exitCode: Schema.NullOr(Schema.Int),
}) {}

export class WorkspaceSocketError extends Schema.Class<WorkspaceSocketError>(
  "@sylph/domain/WorkspaceSocketError"
)({
  type: Schema.Literals(["error"]),
  code: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
  fatal: Schema.Boolean,
}) {}

export const WorkspaceSocketServerFrame = Schema.Union([
  WorkspaceSocketEvent,
  WorkspaceSocketSynced,
  WorkspaceSocketPresence,
  WorkspaceTerminalOutput,
  WorkspaceTerminalExited,
  WorkspaceSocketError,
])
export type WorkspaceSocketServerFrame = typeof WorkspaceSocketServerFrame.Type

export class WorkspaceDisconnectUserInput extends Schema.Class<WorkspaceDisconnectUserInput>(
  "@sylph/domain/WorkspaceDisconnectUserInput"
)({
  userId: Schema.NonEmptyString,
}) {}

export class WorkspacePermissionAskedEventData extends Schema.Class<WorkspacePermissionAskedEventData>(
  "@sylph/domain/WorkspacePermissionAskedEventData"
)({
  id: Schema.NonEmptyString,
  sessionID: Schema.NonEmptyString,
  action: Schema.NonEmptyString,
  resources: Schema.Array(Schema.String),
  save: Schema.optional(Schema.Array(Schema.String)),
  message: Schema.optional(Schema.String),
}) {}

export class WorkspacePermissionRepliedEventData extends Schema.Class<WorkspacePermissionRepliedEventData>(
  "@sylph/domain/WorkspacePermissionRepliedEventData"
)({
  sessionID: Schema.NonEmptyString,
  requestID: Schema.NonEmptyString,
  reply: WorkspacePermissionReply,
}) {}

export class WorkspaceTextDeltaEventData extends Schema.Class<WorkspaceTextDeltaEventData>(
  "@sylph/domain/WorkspaceTextDeltaEventData"
)({
  sessionID: Schema.NonEmptyString,
  assistantMessageID: Schema.NonEmptyString,
  delta: Schema.String,
}) {}

export class WorkspaceTextEndedEventData extends Schema.Class<WorkspaceTextEndedEventData>(
  "@sylph/domain/WorkspaceTextEndedEventData"
)({
  sessionID: Schema.NonEmptyString,
  assistantMessageID: Schema.NonEmptyString,
  text: Schema.String,
}) {}

export class WorkspaceTurnCancelInput extends Schema.Class<WorkspaceTurnCancelInput>(
  "@sylph/domain/WorkspaceTurnCancelInput"
)({
  workspaceId: WorkspaceId,
  continueQueued: Schema.optional(Schema.Boolean),
}) {}

export const WorkspaceRuntimeStatus = Schema.Literals([
  "provisioning",
  "ready",
  "running",
  "interrupted",
  "error",
])
export type WorkspaceRuntimeStatus = typeof WorkspaceRuntimeStatus.Type

export const WorkspaceMessageRole = Schema.Literals(["user", "assistant"])
export type WorkspaceMessageRole = typeof WorkspaceMessageRole.Type

export const WorkspaceToolStatus = Schema.Literals([
  "running",
  "completed",
  "error",
])

export class WorkspaceToolFile extends Schema.Class<WorkspaceToolFile>(
  "@sylph/domain/WorkspaceToolFile"
)({
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.optional(Schema.String),
}) {}

export class WorkspaceMessageTextPart extends Schema.Class<WorkspaceMessageTextPart>(
  "@sylph/domain/WorkspaceMessageTextPart"
)({
  type: Schema.Literal("text"),
  text: Schema.String,
}) {}

export class WorkspaceMessageToolPart extends Schema.Class<WorkspaceMessageToolPart>(
  "@sylph/domain/WorkspaceMessageToolPart"
)({
  type: Schema.Literal("tool"),
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  status: WorkspaceToolStatus,
  input: Schema.JsonObject,
  output: Schema.String,
  outputTruncated: Schema.Boolean,
  files: Schema.Array(WorkspaceToolFile),
  error: Schema.NullOr(Schema.String),
}) {}

export const WorkspaceMessagePart = Schema.Union([
  WorkspaceMessageTextPart,
  WorkspaceMessageToolPart,
])
export type WorkspaceMessagePart = typeof WorkspaceMessagePart.Type

export class WorkspaceRuntimeMessage extends Schema.Class<WorkspaceRuntimeMessage>(
  "@sylph/domain/WorkspaceRuntimeMessage"
)({
  id: Schema.NonEmptyString,
  role: WorkspaceMessageRole,
  createdAt: Schema.Number,
  parts: Schema.Array(WorkspaceMessagePart),
  error: Schema.NullOr(Schema.String),
}) {}

export class WorkspaceQueuedMessage extends Schema.Class<WorkspaceQueuedMessage>(
  "@sylph/domain/WorkspaceQueuedMessage"
)({
  id: Schema.NonEmptyString,
  text: Schema.String,
  createdAt: Schema.Number,
  delivery: Schema.Literals(["queue", "steer"]),
}) {}

export class WorkspaceRuntimeLimits extends Schema.Class<WorkspaceRuntimeLimits>(
  "@sylph/domain/WorkspaceRuntimeLimits"
)({
  maxQueuedMessages: Schema.Int,
  maxTurnDurationMs: Schema.Int,
  maxCheckAttempts: Schema.Int,
  maxRepairAttempts: Schema.Int,
  maxAutomaticRepairs: Schema.Int,
}) {}

export class WorkspaceRuntimeHealth extends Schema.Class<WorkspaceRuntimeHealth>(
  "@sylph/domain/WorkspaceRuntimeHealth"
)({
  workspaceId: Schema.NullOr(WorkspaceId),
  sessionId: Schema.NullOr(AgentSessionId),
  eventCursor: Schema.NullOr(Schema.Int),
  status: WorkspaceRuntimeStatus,
  model: Schema.NullOr(Schema.NonEmptyString),
  files: Schema.Array(Schema.NonEmptyString),
  messages: Schema.Array(WorkspaceRuntimeMessage),
  queuedMessages: Schema.Array(WorkspaceQueuedMessage),
  questions: Schema.Array(WorkspaceAgentQuestion),
  permissions: Schema.Array(WorkspacePermissionAskedEventData),
  lastTurnOutcome: Schema.NullOr(
    Schema.Literals(["succeeded", "failed", "interrupted"])
  ),
  activeTurnStartedAt: Schema.NullOr(Schema.Number),
  limits: WorkspaceRuntimeLimits,
  automaticRepairsUsed: Schema.Int,
  archivedAt: Schema.NullOr(Schema.Number),
  opencode: Schema.Struct({ healthy: Schema.Boolean }),
}) {}

export class WorkspaceTurnCancelResult extends Schema.Class<WorkspaceTurnCancelResult>(
  "@sylph/domain/WorkspaceTurnCancelResult"
)({
  interrupted: Schema.Boolean,
}) {}

export const WorkspaceSocketAttachment = Schema.Struct({
  userId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  writable: Schema.Boolean,
  connectedAt: Schema.Number,
  sessionId: Schema.NullOr(Schema.NonEmptyString),
  cursor: Schema.NullOr(Schema.Int),
  synced: Schema.Boolean,
})
export type WorkspaceSocketAttachment = typeof WorkspaceSocketAttachment.Type
