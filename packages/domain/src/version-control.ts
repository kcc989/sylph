import { Schema } from "effect"

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

export const ProjectRepositorySyncStatus = Schema.Literals([
  "up_to_date",
  "fast_forwarded",
  "ahead",
  "diverged",
])
export type ProjectRepositorySyncStatus =
  typeof ProjectRepositorySyncStatus.Type

export class SyncProjectRepositoryResult extends Schema.Class<SyncProjectRepositoryResult>(
  "@sylph/domain/SyncProjectRepositoryResult"
)({
  status: ProjectRepositorySyncStatus,
  projectHead: GitCommitId,
  upstreamHead: GitCommitId,
}) {}

export class WorkspaceVersionControlSnapshot extends Schema.Class<WorkspaceVersionControlSnapshot>(
  "@sylph/domain/WorkspaceVersionControlSnapshot"
)({
  vcs: WorkspaceVersionControl,
  workingRevision: Schema.optional(Schema.Int),
  checkpoints: WorkspaceCheckpointList,
}) {}
