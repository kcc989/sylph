import { Schema } from "effect"

import { toolJsonSchema } from "./json-schema"

import { WorkspaceId } from "./ids"

export const GitCommitId = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  Schema.brand("GitCommitId")
)
export type GitCommitId = typeof GitCommitId.Type

export const WorkspaceSyncStatus = Schema.Literals([
  "pending",
  "hydrating",
  "ready",
  "checkpointing",
  "diverged",
  "error",
])
export type WorkspaceSyncStatus = typeof WorkspaceSyncStatus.Type

export const WorkspaceMergeStatus = Schema.Literals([
  "unreviewed",
  "ready",
  "merging",
  "merge_conflict",
  "merged",
  "error",
])
export type WorkspaceMergeStatus = typeof WorkspaceMergeStatus.Type

export const WorkspaceFileChangeStatus = Schema.Literals([
  "added",
  "modified",
  "deleted",
])

export class WorkspaceFileChange extends Schema.Class<WorkspaceFileChange>(
  "@sylph/domain/WorkspaceFileChange"
)({
  file: Schema.NonEmptyString,
  status: WorkspaceFileChangeStatus,
  additions: Schema.Int,
  deletions: Schema.Int,
  patch: Schema.String,
}) {}

export class WorkspaceVersionControl extends Schema.Class<WorkspaceVersionControl>(
  "@sylph/domain/WorkspaceVersionControl"
)({
  defaultRef: Schema.NonEmptyString,
  currentRef: Schema.NonEmptyString,
  baseCommit: GitCommitId,
  forkHead: GitCommitId,
  projectHead: GitCommitId,
  projectChanged: Schema.Boolean,
  syncStatus: WorkspaceSyncStatus,
  mergeStatus: WorkspaceMergeStatus,
  working: Schema.Array(WorkspaceFileChange),
  branch: Schema.Array(WorkspaceFileChange),
}) {}

export class WorkspaceCheckpointInput extends Schema.Class<WorkspaceCheckpointInput>(
  "@sylph/domain/WorkspaceCheckpointInput"
)({
  workspaceId: WorkspaceId,
  idempotencyKey: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
  repairOnFailure: Schema.optional(Schema.Boolean),
}) {}

export class WorkspaceCheckpoint extends Schema.Class<WorkspaceCheckpoint>(
  "@sylph/domain/WorkspaceCheckpoint"
)({
  id: Schema.NonEmptyString,
  commit: GitCommitId,
  message: Schema.NonEmptyString,
  createdAt: Schema.Number,
}) {}

export class WorkspaceCheckpointResult extends Schema.Class<WorkspaceCheckpointResult>(
  "@sylph/domain/WorkspaceCheckpointResult"
)({
  checkpoint: WorkspaceCheckpoint,
  replayed: Schema.Boolean,
}) {}

export const WorkspaceCheckpointList = Schema.Array(WorkspaceCheckpoint)

export class WorkspaceAcceptInput extends Schema.Class<WorkspaceAcceptInput>(
  "@sylph/domain/WorkspaceAcceptInput"
)({
  workspaceId: WorkspaceId,
  idempotencyKey: Schema.NonEmptyString,
}) {}

export class WorkspaceRebaseResult extends Schema.Class<WorkspaceRebaseResult>(
  "@sylph/domain/WorkspaceRebaseResult"
)({
  baseCommit: GitCommitId,
  forkHead: GitCommitId,
  projectHead: GitCommitId,
}) {}

export class PrepareProjectRepositoryInput extends Schema.Class<PrepareProjectRepositoryInput>(
  "@sylph/domain/PrepareProjectRepositoryInput"
)({
  repositoryName: Schema.NonEmptyString,
  repositoryRemote: Schema.NonEmptyString,
  defaultRef: Schema.NonEmptyString,
  projectName: Schema.NonEmptyString,
  source: Schema.optional(
    Schema.Struct({
      remote: Schema.NonEmptyString,
      ref: Schema.NonEmptyString,
      accessToken: Schema.optional(Schema.NonEmptyString),
    })
  ),
}) {}

export const ProjectRepositorySyncStatus = Schema.Literals([
  "up_to_date",
  "fast_forwarded",
  "ahead",
  "diverged",
])
export type ProjectRepositorySyncStatus =
  typeof ProjectRepositorySyncStatus.Type

export class SyncProjectRepositoryInput extends Schema.Class<SyncProjectRepositoryInput>(
  "@sylph/domain/SyncProjectRepositoryInput"
)({
  repositoryName: Schema.NonEmptyString,
  repositoryRemote: Schema.NonEmptyString,
  defaultRef: Schema.NonEmptyString,
  sourceRemote: Schema.NonEmptyString,
  sourceRef: Schema.NonEmptyString,
  sourceAccessToken: Schema.optional(Schema.NonEmptyString),
}) {}

export class SyncProjectRepositoryResult extends Schema.Class<SyncProjectRepositoryResult>(
  "@sylph/domain/SyncProjectRepositoryResult"
)({
  status: ProjectRepositorySyncStatus,
  projectHead: GitCommitId,
  upstreamHead: GitCommitId,
}) {}

export class WorkspaceDeleteFileInput extends Schema.Class<WorkspaceDeleteFileInput>(
  "@sylph/domain/WorkspaceDeleteFileInput"
)({
  path: Schema.NonEmptyString,
}) {}

export const WorkspaceDeleteFileJsonSchema = toolJsonSchema(
  WorkspaceDeleteFileInput
)

export class WorkspaceVersionControlSnapshot extends Schema.Class<WorkspaceVersionControlSnapshot>(
  "@sylph/domain/WorkspaceVersionControlSnapshot"
)({
  vcs: WorkspaceVersionControl,
  checkpoints: WorkspaceCheckpointList,
}) {}
