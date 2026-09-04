import { Schema } from "effect"

import { WorkspaceId } from "./ids"
import { toolJsonSchema } from "./json-schema"

export class WorkspaceFilePathInput extends Schema.Class<WorkspaceFilePathInput>(
  "@sylph/domain/WorkspaceFilePathInput"
)({
  path: Schema.NonEmptyString,
}) {}

export class WorkspaceListFilesInput extends Schema.Class<WorkspaceListFilesInput>(
  "@sylph/domain/WorkspaceListFilesInput"
)({
  directory: Schema.optional(Schema.String),
}) {}

export class WorkspaceWriteFileInput extends Schema.Class<WorkspaceWriteFileInput>(
  "@sylph/domain/WorkspaceWriteFileInput"
)({
  path: Schema.NonEmptyString,
  content: Schema.String,
}) {}

export class WorkspaceEditFileInput extends Schema.Class<WorkspaceEditFileInput>(
  "@sylph/domain/WorkspaceEditFileInput"
)({
  path: Schema.NonEmptyString,
  oldText: Schema.NonEmptyString,
  newText: Schema.String,
}) {}

export class WorkspaceEditConflict extends Schema.TaggedError<WorkspaceEditConflict>()(
  "WorkspaceEditConflict",
  {
    path: Schema.String,
    message: Schema.String,
  }
) {}

export class WorkspaceReadFileInput extends Schema.Class<WorkspaceReadFileInput>(
  "@sylph/domain/WorkspaceReadFileInput"
)({
  workspaceId: WorkspaceId,
  path: Schema.NonEmptyString,
}) {}

export class WorkspaceFileContent extends Schema.Class<WorkspaceFileContent>(
  "@sylph/domain/WorkspaceFileContent"
)({
  path: Schema.NonEmptyString,
  size: Schema.Int,
  updatedAt: Schema.Number,
  encoding: Schema.Literals(["utf8", "binary", "too-large"]),
  content: Schema.NullOr(Schema.String),
}) {}

export const WorkspaceListFilesJsonSchema = toolJsonSchema(
  WorkspaceListFilesInput
)
export const WorkspaceFilePathJsonSchema = toolJsonSchema(
  WorkspaceFilePathInput
)
export const WorkspaceWriteFileJsonSchema = toolJsonSchema(
  WorkspaceWriteFileInput
)
export const WorkspaceEditFileJsonSchema = toolJsonSchema(
  WorkspaceEditFileInput
)
