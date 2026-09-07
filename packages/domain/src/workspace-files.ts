import { Schema } from "effect"

import { WorkspaceId } from "./ids"

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
