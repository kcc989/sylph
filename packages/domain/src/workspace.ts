import { Schema } from "effect"

import { OrganizationId, ProjectId, WorkspaceId } from "./ids"

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

export class CreateRepositoryInput extends Schema.Class<CreateRepositoryInput>(
  "@sylph/domain/CreateRepositoryInput"
)({
  organizationId: OrganizationId,
  name: Schema.NonEmptyString,
}) {}

export class InitializeWorkspaceRuntime extends Schema.Class<InitializeWorkspaceRuntime>(
  "@sylph/domain/InitializeWorkspaceRuntime"
)({
  organizationId: OrganizationId,
  projectId: ProjectId,
  workspaceId: WorkspaceId,
  repositoryName: Schema.NonEmptyString,
  repositoryRemote: Schema.NonEmptyString,
}) {}

export class WorkspaceRuntimeHealth extends Schema.Class<WorkspaceRuntimeHealth>(
  "@sylph/domain/WorkspaceRuntimeHealth"
)({
  workspaceId: Schema.NullOr(WorkspaceId),
  opencode: Schema.Struct({ healthy: Schema.Boolean }),
}) {}

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

export const decodeCreateRepositoryInput = Schema.decodeUnknownEffect(
  CreateRepositoryInput
)

export const decodeCreateRepositoryInputPromise = Schema.decodeUnknownPromise(
  CreateRepositoryInput
)

export const decodeInitializeWorkspaceRuntime = Schema.decodeUnknownPromise(
  InitializeWorkspaceRuntime
)

export const decodeMagicLinkRequest =
  Schema.decodeUnknownPromise(MagicLinkRequest)
