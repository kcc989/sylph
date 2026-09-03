import { Schema } from "effect"

import { ProjectId, WorkspaceId } from "./ids"
import { ModelSelection } from "./provider-connection"

export const WorkspaceStatus = Schema.Literals([
  "provisioning",
  "ready",
  "running",
  "waiting",
  "idle",
  "interrupted",
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

export class CreateWorkspaceInput extends Schema.Class<CreateWorkspaceInput>(
  "@sylph/domain/CreateWorkspaceInput"
)({
  projectId: ProjectId,
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

export class InvalidWorkspaceInput extends Schema.TaggedError<InvalidWorkspaceInput>()(
  "InvalidWorkspaceInput",
  {
    message: Schema.String,
  }
) {}
