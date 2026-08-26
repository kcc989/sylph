import { Schema } from "effect"

import { ProjectId, WorkspaceId } from "./ids"

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

export class InvalidWorkspaceInput extends Schema.TaggedError<InvalidWorkspaceInput>()(
  "InvalidWorkspaceInput",
  {
    message: Schema.String,
  }
) {}

export const decodeWorkspaceSummary =
  Schema.decodeUnknownEffect(WorkspaceSummary)
