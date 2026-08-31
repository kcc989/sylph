import { Schema } from "effect"

import { ProjectId } from "./ids"
import { GitCommitId } from "./version-control"

export const DeploymentStatus = Schema.Literals([
  "queued",
  "running",
  "succeeded",
  "failed",
])
export type DeploymentStatus = typeof DeploymentStatus.Type

export class ProjectDeployInput extends Schema.Class<ProjectDeployInput>(
  "@sylph/domain/ProjectDeployInput"
)({
  projectId: ProjectId,
  commit: GitCommitId,
  idempotencyKey: Schema.NonEmptyString,
}) {}

export const decodeProjectDeployInputPromise =
  Schema.decodeUnknownPromise(ProjectDeployInput)
