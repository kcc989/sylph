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
}) {}

export class CreateWorkspaceInput extends Schema.Class<CreateWorkspaceInput>(
  "@sylph/domain/CreateWorkspaceInput"
)({
  projectId: ProjectId,
  title: Schema.NonEmptyString,
}) {}

export class ProjectRequestInput extends Schema.Class<ProjectRequestInput>(
  "@sylph/domain/ProjectRequestInput"
)({
  projectId: ProjectId,
}) {}

export class OrganizationRequestInput extends Schema.Class<OrganizationRequestInput>(
  "@sylph/domain/OrganizationRequestInput"
)({
  organizationId: OrganizationId,
}) {}

export const OpenCodeAuthMethod = Schema.Literals([
  "api-key",
  "chatgpt-subscription",
])
export type OpenCodeAuthMethod = typeof OpenCodeAuthMethod.Type

export const OpenCodeCredential = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("key"),
    key: Schema.NonEmptyString,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    configuration: Schema.optional(
      Schema.Record(
        Schema.String,
        Schema.Union([
          Schema.String,
          Schema.Number,
          Schema.Boolean,
          Schema.Array(Schema.String),
        ])
      )
    ),
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

export class OpenCodeKeySetupInput extends Schema.Class<OpenCodeKeySetupInput>(
  "@sylph/domain/OpenCodeKeySetupInput"
)({
  organizationId: OrganizationId,
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
  apiKey: Schema.NonEmptyString,
}) {}

export class OpenCodeSubscriptionStartInput extends Schema.Class<OpenCodeSubscriptionStartInput>(
  "@sylph/domain/OpenCodeSubscriptionStartInput"
)({
  organizationId: OrganizationId,
}) {}

export class OpenCodeSubscriptionStatusInput extends Schema.Class<OpenCodeSubscriptionStatusInput>(
  "@sylph/domain/OpenCodeSubscriptionStatusInput"
)({
  organizationId: OrganizationId,
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
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
  credential: OpenCodeCredential,
}) {}

export class WorkspacePromptInput extends Schema.Class<WorkspacePromptInput>(
  "@sylph/domain/WorkspacePromptInput"
)({
  workspaceId: WorkspaceId,
  text: Schema.NonEmptyString,
}) {}

export class WorkspaceRequestInput extends Schema.Class<WorkspaceRequestInput>(
  "@sylph/domain/WorkspaceRequestInput"
)({
  workspaceId: WorkspaceId,
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

export const decodeOrganizationRequestInputPromise =
  Schema.decodeUnknownPromise(OrganizationRequestInput)

export const decodeOpenCodeKeySetupInputPromise = Schema.decodeUnknownPromise(
  OpenCodeKeySetupInput
)

export const decodeOpenCodeSubscriptionStartInputPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionStartInput)

export const decodeOpenCodeSubscriptionStatusInputPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionStatusInput)

export const decodeOpenCodeCredentialPromise =
  Schema.decodeUnknownPromise(OpenCodeCredential)

export const decodeOpenCodeSubscriptionAttemptPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionAttempt)

export const decodeOpenCodeSubscriptionRuntimeStatusPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionRuntimeStatus)

export const decodeInitializeWorkspaceRuntime = Schema.decodeUnknownPromise(
  InitializeWorkspaceRuntime
)

export const decodeWorkspacePromptInputPromise =
  Schema.decodeUnknownPromise(WorkspacePromptInput)

export const decodeWorkspaceRequestInputPromise = Schema.decodeUnknownPromise(
  WorkspaceRequestInput
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
