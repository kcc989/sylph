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
  confirmedCommit: GitCommitId,
  idempotencyKey: Schema.NonEmptyString,
}) {}

export const productionDeployConfirmed = (input: {
  commit: string
  confirmedCommit: string
}) => input.commit === input.confirmedCommit

export const decodeProjectDeployInputPromise =
  Schema.decodeUnknownPromise(ProjectDeployInput)
