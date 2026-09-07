import { Schema } from "effect"

export class WorkspaceCommandFile extends Schema.Class<WorkspaceCommandFile>(
  "@sylph/domain/WorkspaceCommandFile"
)({ path: Schema.String, content: Schema.String }) {}

export class WorkspaceCommandSnapshot extends Schema.Class<WorkspaceCommandSnapshot>(
  "@sylph/domain/WorkspaceCommandSnapshot"
)({ files: Schema.Array(WorkspaceCommandFile) }) {}

export class WorkspaceCommandResult extends Schema.Class<WorkspaceCommandResult>(
  "@sylph/domain/WorkspaceCommandResult"
)({
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  files: Schema.Array(WorkspaceCommandFile),
}) {}

export class WorkspaceCommandConflict extends Schema.TaggedError<WorkspaceCommandConflict>()(
  "WorkspaceCommandConflict",
  { message: Schema.String }
) {}

export class WorkspaceCommandPending extends Schema.Class<WorkspaceCommandPending>(
  "@sylph/domain/WorkspaceCommandPending"
)({
  request: Schema.String,
  result: Schema.String,
  processId: Schema.String,
}) {}
