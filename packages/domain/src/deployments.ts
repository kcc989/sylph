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
  managedRelease: Schema.optional(Schema.Boolean),
  captureEvidence: Schema.optional(Schema.Boolean),
  recoveryDeploymentId: Schema.optional(Schema.NonEmptyString),
  confirmedDataLoss: Schema.optional(Schema.Boolean),
}) {}

export class DeploymentRecoveryPoint extends Schema.Class<DeploymentRecoveryPoint>(
  "@sylph/domain/DeploymentRecoveryPoint"
)({
  deploymentId: Schema.NonEmptyString,
  projectId: ProjectId,
  commit: GitCommitId,
  baseCommit: Schema.NullOr(GitCommitId),
  capturedAt: Schema.Number,
  expiresAt: Schema.Number,
  writesPaused: Schema.Literal(true),
  inventoryComplete: Schema.Literal(true),
  resources: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
      kind: Schema.Literals([
        "database",
        "object-storage",
        "kv",
        "durable-object",
        "secret",
        "other",
      ]),
      backupRef: Schema.NonEmptyString,
      restoreVerifiedAt: Schema.Number,
    })
  ),
}) {}

export class DeploymentMigrationReview extends Schema.Class<DeploymentMigrationReview>(
  "@sylph/domain/DeploymentMigrationReview"
)({
  deploymentId: Schema.NonEmptyString,
  commit: GitCommitId,
  baseCommit: Schema.NullOr(GitCommitId),
  compatible: Schema.Literal(true),
  evidence: Schema.NonEmptyString,
}) {}

export class DeploymentJourney extends Schema.Class<DeploymentJourney>(
  "@sylph/domain/DeploymentJourney"
)({
  deploymentId: Schema.NonEmptyString,
  commit: GitCommitId,
  url: Schema.NonEmptyString,
  passed: Schema.Literal(true),
  journeys: Schema.NonEmptyArray(Schema.NonEmptyString),
}) {}

export const productionDeployConfirmed = (input: {
  commit: string
  confirmedCommit: string
}) => input.commit === input.confirmedCommit

export class DeploymentDataRestore extends Schema.Class<DeploymentDataRestore>(
  "@sylph/domain/DeploymentDataRestore"
)({
  deploymentId: Schema.NonEmptyString,
  recoveryDeploymentId: Schema.NonEmptyString,
  commit: GitCommitId,
  restored: Schema.Literal(true),
  resources: Schema.Array(Schema.NonEmptyString),
}) {}

export class DeploymentSafetyFailure extends Schema.TaggedError<DeploymentSafetyFailure>()(
  "DeploymentSafetyFailure",
  { message: Schema.String }
) {}
