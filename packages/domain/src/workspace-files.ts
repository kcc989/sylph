import { Schema } from "effect"

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

export const WorkspaceListFilesJsonSchema = toolJsonSchema(
  WorkspaceListFilesInput
)
export const WorkspaceFilePathJsonSchema = toolJsonSchema(
  WorkspaceFilePathInput
)
export const WorkspaceWriteFileJsonSchema = toolJsonSchema(
  WorkspaceWriteFileInput
)
