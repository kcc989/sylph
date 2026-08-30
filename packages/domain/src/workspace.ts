import { Schema } from "effect"

import { AgentSessionId, OrganizationId, ProjectId, WorkspaceId } from "./ids"

export const WorkspaceStatus = Schema.Literals([
  "provisioning",
  "ready",
  "running",
  "waiting",
  "idle",
  "merging",
  "archived",
  "error",
])
export type WorkspaceStatus = typeof WorkspaceStatus.Type

export class WorkspaceSummary extends Schema.Class<WorkspaceSummary>(
  "@sylph/domain/WorkspaceSummary"
)({
  id: WorkspaceId,
  projectId: ProjectId,
  title: Schema.NonEmptyString,
  status: WorkspaceStatus,
}) {}

export class CreateProjectInput extends Schema.Class<CreateProjectInput>(
  "@sylph/domain/CreateProjectInput"
)({
  organizationId: OrganizationId,
  name: Schema.NonEmptyString,
  sourceRepositoryUrl: Schema.optional(Schema.NonEmptyString),
  sourceBranch: Schema.optional(Schema.NonEmptyString),
}) {}

export class CreateWorkspaceInput extends Schema.Class<CreateWorkspaceInput>(
  "@sylph/domain/CreateWorkspaceInput"
)({
  projectId: ProjectId,
}) {}

export class ProjectRequestInput extends Schema.Class<ProjectRequestInput>(
  "@sylph/domain/ProjectRequestInput"
)({
  projectId: ProjectId,
}) {}

export class ProjectDeliveryModeInput extends Schema.Class<ProjectDeliveryModeInput>(
  "@sylph/domain/ProjectDeliveryModeInput"
)({
  projectId: ProjectId,
  mode: Schema.Literals(["push", "pull_request"]),
}) {}

export class OrganizationRequestInput extends Schema.Class<OrganizationRequestInput>(
  "@sylph/domain/OrganizationRequestInput"
)({
  organizationId: OrganizationId,
}) {}

export class InstallationClaimInput extends Schema.Class<InstallationClaimInput>(
  "@sylph/domain/InstallationClaimInput"
)({
  claimSecret: Schema.NonEmptyString,
  confirmedEmail: Schema.NonEmptyString,
  organizationName: Schema.NonEmptyString,
}) {}

export const OpenCodeAuthMethod = Schema.Literals([
  "api-key",
  "chatgpt-subscription",
])
export type OpenCodeAuthMethod = typeof OpenCodeAuthMethod.Type

export const OpenCodeKeyProviderId = Schema.Literals([
  "openai",
  "openrouter",
  "cloudflare-workers-ai",
  "anthropic",
  "opencode",
])
export type OpenCodeKeyProviderId = typeof OpenCodeKeyProviderId.Type

export const OpenCodeKeyConfiguration = Schema.Record(
  Schema.String,
  Schema.Union([
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Array(Schema.String),
  ])
)
export type OpenCodeKeyConfiguration = typeof OpenCodeKeyConfiguration.Type

export const OpenCodeCredential = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("key"),
    key: Schema.NonEmptyString,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    configuration: Schema.optional(OpenCodeKeyConfiguration),
  }),
  Schema.Struct({
    type: Schema.Literal("oauth"),
    methodID: Schema.NonEmptyString,
    refresh: Schema.NonEmptyString,
    access: Schema.NonEmptyString,
    expires: Schema.Int,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
])
export type OpenCodeCredential = typeof OpenCodeCredential.Type

export const ConnectionScope = Schema.Literals(["organization", "user"])
export type ConnectionScope = typeof ConnectionScope.Type

export class ModelSelection extends Schema.Class<ModelSelection>(
  "@sylph/domain/ModelSelection"
)({
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
}) {}

export class ProviderModel extends Schema.Class<ProviderModel>(
  "@sylph/domain/ProviderModel"
)({
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
}) {}

export class OpenCodeConnectionResult extends Schema.Class<OpenCodeConnectionResult>(
  "@sylph/domain/OpenCodeConnectionResult"
)({
  models: Schema.Array(ProviderModel),
  recommendedModelId: Schema.NullOr(Schema.NonEmptyString),
}) {}

export class OpenCodeKeySetupInput extends Schema.Class<OpenCodeKeySetupInput>(
  "@sylph/domain/OpenCodeKeySetupInput"
)({
  organizationId: OrganizationId,
  scope: ConnectionScope,
  providerId: OpenCodeKeyProviderId,
  apiKey: Schema.NonEmptyString,
  configuration: Schema.optional(OpenCodeKeyConfiguration),
}) {}

export class SetDefaultModelInput extends Schema.Class<SetDefaultModelInput>(
  "@sylph/domain/SetDefaultModelInput"
)({
  organizationId: OrganizationId,
  scope: ConnectionScope,
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
}) {}

export class DisconnectOpenCodeConnectionInput extends Schema.Class<DisconnectOpenCodeConnectionInput>(
  "@sylph/domain/DisconnectOpenCodeConnectionInput"
)({
  organizationId: OrganizationId,
  scope: ConnectionScope,
  providerId: Schema.NonEmptyString,
}) {}

export class OpenCodeSubscriptionStartInput extends Schema.Class<OpenCodeSubscriptionStartInput>(
  "@sylph/domain/OpenCodeSubscriptionStartInput"
)({
  organizationId: OrganizationId,
  scope: ConnectionScope,
}) {}

export class OpenCodeSubscriptionStatusInput extends Schema.Class<OpenCodeSubscriptionStatusInput>(
  "@sylph/domain/OpenCodeSubscriptionStatusInput"
)({
  organizationId: OrganizationId,
  scope: ConnectionScope,
  attemptId: Schema.NonEmptyString,
}) {}

export class OpenCodeSubscriptionAttempt extends Schema.Class<OpenCodeSubscriptionAttempt>(
  "@sylph/domain/OpenCodeSubscriptionAttempt"
)({
  attemptId: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  instructions: Schema.NonEmptyString,
  expiresAt: Schema.Number,
}) {}

export class OpenCodeSubscriptionStatus extends Schema.Class<OpenCodeSubscriptionStatus>(
  "@sylph/domain/OpenCodeSubscriptionStatus"
)({
  status: Schema.Literals(["pending", "complete", "failed", "expired"]),
  message: Schema.optional(Schema.String),
}) {}

export class OpenCodeSubscriptionRuntimeStatus extends Schema.Class<OpenCodeSubscriptionRuntimeStatus>(
  "@sylph/domain/OpenCodeSubscriptionRuntimeStatus"
)({
  status: Schema.Literals(["pending", "complete", "failed", "expired"]),
  message: Schema.optional(Schema.String),
  credential: Schema.optional(OpenCodeCredential),
  models: Schema.optional(Schema.Array(ProviderModel)),
  recommendedModelId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
}) {}

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
}) {}

export class WorkspacePromptInput extends Schema.Class<WorkspacePromptInput>(
  "@sylph/domain/WorkspacePromptInput"
)({
  workspaceId: WorkspaceId,
  text: Schema.NonEmptyString,
  model: Schema.optional(ModelSelection),
}) {}

export class WorkspaceRuntimePromptInput extends Schema.Class<WorkspaceRuntimePromptInput>(
  "@sylph/domain/WorkspaceRuntimePromptInput"
)({
  workspaceId: WorkspaceId,
  text: Schema.NonEmptyString,
  model: ModelSelection,
  credential: OpenCodeCredential,
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
  durable: Schema.optional(Schema.Unknown),
  location: Schema.optional(Schema.Unknown),
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

export class WorkspaceRequestInput extends Schema.Class<WorkspaceRequestInput>(
  "@sylph/domain/WorkspaceRequestInput"
)({
  workspaceId: WorkspaceId,
}) {}

export class RestartWorkspaceInput extends Schema.Class<RestartWorkspaceInput>(
  "@sylph/domain/RestartWorkspaceInput"
)({
  workspaceId: WorkspaceId,
  model: Schema.optional(ModelSelection),
}) {}

export const WorkspaceRuntimeStatus = Schema.Literals([
  "provisioning",
  "ready",
  "running",
  "error",
])
export type WorkspaceRuntimeStatus = typeof WorkspaceRuntimeStatus.Type

export const WorkspaceMessageRole = Schema.Literals(["user", "assistant"])
export type WorkspaceMessageRole = typeof WorkspaceMessageRole.Type

export class WorkspaceRuntimeMessage extends Schema.Class<WorkspaceRuntimeMessage>(
  "@sylph/domain/WorkspaceRuntimeMessage"
)({
  id: Schema.NonEmptyString,
  role: WorkspaceMessageRole,
  text: Schema.String,
  createdAt: Schema.Number,
  tools: Schema.Array(Schema.NonEmptyString),
  error: Schema.NullOr(Schema.String),
}) {}

export class WorkspaceRuntimeHealth extends Schema.Class<WorkspaceRuntimeHealth>(
  "@sylph/domain/WorkspaceRuntimeHealth"
)({
  workspaceId: Schema.NullOr(WorkspaceId),
  sessionId: Schema.NullOr(AgentSessionId),
  status: WorkspaceRuntimeStatus,
  model: Schema.NullOr(Schema.NonEmptyString),
  files: Schema.Array(Schema.NonEmptyString),
  messages: Schema.Array(WorkspaceRuntimeMessage),
  permissions: Schema.Array(WorkspacePermissionAskedEventData),
  opencode: Schema.Struct({ healthy: Schema.Boolean }),
}) {}

export class WorkspaceFilePathInput extends Schema.Class<WorkspaceFilePathInput>(
  "@sylph/domain/WorkspaceFilePathInput"
)({
  path: Schema.NonEmptyString,
}) {}

export class WorkspaceListFilesInput extends Schema.Class<WorkspaceListFilesInput>(
  "@sylph/domain/WorkspaceListFilesInput"
)({
  directory: Schema.optional(Schema.String),
}) {}

export class WorkspaceWriteFileInput extends Schema.Class<WorkspaceWriteFileInput>(
  "@sylph/domain/WorkspaceWriteFileInput"
)({
  path: Schema.NonEmptyString,
  content: Schema.String,
}) {}

const toolJsonSchema = (schema: Schema.Constraint) => {
  const document = Schema.toJsonSchemaDocument(schema)
  return { ...document.schema, $defs: document.definitions }
}

export const WorkspaceListFilesJsonSchema = toolJsonSchema(
  WorkspaceListFilesInput
)
export const WorkspaceFilePathJsonSchema = toolJsonSchema(
  WorkspaceFilePathInput
)
export const WorkspaceWriteFileJsonSchema = toolJsonSchema(
  WorkspaceWriteFileInput
)

export class MagicLinkRequest extends Schema.Class<MagicLinkRequest>(
  "@sylph/domain/MagicLinkRequest"
)({
  email: Schema.NonEmptyString,
}) {}

export class InvalidWorkspaceInput extends Schema.TaggedError<InvalidWorkspaceInput>()(
  "InvalidWorkspaceInput",
  {
    message: Schema.String,
  }
) {}

export const decodeWorkspaceSummary =
  Schema.decodeUnknownEffect(WorkspaceSummary)

export const decodeCreateProjectInput =
  Schema.decodeUnknownEffect(CreateProjectInput)

export const decodeCreateProjectInputPromise =
  Schema.decodeUnknownPromise(CreateProjectInput)

export const decodeCreateWorkspaceInputPromise =
  Schema.decodeUnknownPromise(CreateWorkspaceInput)

export const decodeProjectRequestInputPromise =
  Schema.decodeUnknownPromise(ProjectRequestInput)
export const decodeProjectDeliveryModeInputPromise =
  Schema.decodeUnknownPromise(ProjectDeliveryModeInput)

export const decodeOrganizationRequestInputPromise =
  Schema.decodeUnknownPromise(OrganizationRequestInput)

export const decodeInstallationClaimInputPromise = Schema.decodeUnknownPromise(
  InstallationClaimInput
)

export const decodeOpenCodeKeySetupInputPromise = Schema.decodeUnknownPromise(
  OpenCodeKeySetupInput
)

export const decodeSetDefaultModelInputPromise =
  Schema.decodeUnknownPromise(SetDefaultModelInput)

export const decodeDisconnectOpenCodeConnectionInputPromise =
  Schema.decodeUnknownPromise(DisconnectOpenCodeConnectionInput)

export const decodeOpenCodeSubscriptionStartInputPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionStartInput)

export const decodeOpenCodeSubscriptionStatusInputPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionStatusInput)

export const decodeOpenCodeCredentialPromise =
  Schema.decodeUnknownPromise(OpenCodeCredential)

export const decodeOpenCodeConnectionResultPromise =
  Schema.decodeUnknownPromise(OpenCodeConnectionResult)

export const decodeOpenCodeSubscriptionAttemptPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionAttempt)

export const decodeOpenCodeSubscriptionRuntimeStatusPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionRuntimeStatus)

export const decodeInitializeWorkspaceRuntime = Schema.decodeUnknownPromise(
  InitializeWorkspaceRuntime
)

export const decodeWorkspacePromptInputPromise =
  Schema.decodeUnknownPromise(WorkspacePromptInput)

export const decodeWorkspaceRuntimePromptInputPromise =
  Schema.decodeUnknownPromise(WorkspaceRuntimePromptInput)

export const decodeWorkspacePermissionReplyInputPromise =
  Schema.decodeUnknownPromise(WorkspacePermissionReplyInput)

export const decodeWorkspaceRuntimeEventPromise = Schema.decodeUnknownPromise(
  WorkspaceRuntimeEvent
)

export const decodeWorkspacePermissionAskedEventDataPromise =
  Schema.decodeUnknownPromise(WorkspacePermissionAskedEventData)

export const decodeWorkspacePermissionRepliedEventDataPromise =
  Schema.decodeUnknownPromise(WorkspacePermissionRepliedEventData)

export const decodeWorkspaceTextDeltaEventDataPromise =
  Schema.decodeUnknownPromise(WorkspaceTextDeltaEventData)

export const decodeWorkspaceTextEndedEventDataPromise =
  Schema.decodeUnknownPromise(WorkspaceTextEndedEventData)

export const decodeWorkspaceRequestInputPromise = Schema.decodeUnknownPromise(
  WorkspaceRequestInput
)

export const decodeRestartWorkspaceInputPromise = Schema.decodeUnknownPromise(
  RestartWorkspaceInput
)

export const decodeWorkspaceRuntimeHealth = Schema.decodeUnknownPromise(
  WorkspaceRuntimeHealth
)

export const encodeWorkspaceRuntimeHealth = Schema.encodePromise(
  WorkspaceRuntimeHealth
)

export const decodeWorkspaceFilePath = Schema.decodeUnknownPromise(
  WorkspaceFilePathInput
)

export const decodeWorkspaceListFiles = Schema.decodeUnknownPromise(
  WorkspaceListFilesInput
)

export const decodeWorkspaceWriteFile = Schema.decodeUnknownPromise(
  WorkspaceWriteFileInput
)

export const decodeMagicLinkRequest =
  Schema.decodeUnknownPromise(MagicLinkRequest)
