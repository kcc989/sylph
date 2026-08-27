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

export class PrepareProjectRepositoryInput extends Schema.Class<PrepareProjectRepositoryInput>(
  "@sylph/domain/PrepareProjectRepositoryInput"
)({
  repositoryName: Schema.NonEmptyString,
  repositoryRemote: Schema.NonEmptyString,
  defaultRef: Schema.NonEmptyString,
  projectName: Schema.NonEmptyString,
}) {}

export class PrepareProjectRepositoryResult extends Schema.Class<PrepareProjectRepositoryResult>(
  "@sylph/domain/PrepareProjectRepositoryResult"
)({
  head: GitCommitId,
}) {}

export class WorkspaceDeleteFileInput extends Schema.Class<WorkspaceDeleteFileInput>(
  "@sylph/domain/WorkspaceDeleteFileInput"
)({
  path: Schema.NonEmptyString,
}) {}

const toolJsonSchema = (schema: Schema.Constraint) => {
  const document = Schema.toJsonSchemaDocument(schema)
  return { ...document.schema, $defs: document.definitions }
}

export const WorkspaceDeleteFileJsonSchema = toolJsonSchema(
  WorkspaceDeleteFileInput
)

export const decodeWorkspaceCheckpointInputPromise =
  Schema.decodeUnknownPromise(WorkspaceCheckpointInput)
export const decodeWorkspaceAcceptInputPromise =
  Schema.decodeUnknownPromise(WorkspaceAcceptInput)
export const decodeWorkspaceDeleteFile = Schema.decodeUnknownPromise(
  WorkspaceDeleteFileInput
)
export const decodeWorkspaceVersionControl = Schema.decodeUnknownPromise(
  WorkspaceVersionControl
)
export const encodeWorkspaceVersionControl = Schema.encodePromise(
  WorkspaceVersionControl
)
export const decodeWorkspaceCheckpointResult = Schema.decodeUnknownPromise(
  WorkspaceCheckpointResult
)
export const decodeWorkspaceCheckpointList = Schema.decodeUnknownPromise(
  WorkspaceCheckpointList
)
export const decodePrepareProjectRepositoryInputPromise =
  Schema.decodeUnknownPromise(PrepareProjectRepositoryInput)
export const decodePrepareProjectRepositoryResultPromise =
  Schema.decodeUnknownPromise(PrepareProjectRepositoryResult)
