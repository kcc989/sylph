import { Schema } from "effect"

import { GitCommitId } from "./version-control"
import { WorkspaceId } from "./ids"

const selector = Schema.NonEmptyString.check(Schema.isMaxLength(2_000))
const text = Schema.String.check(Schema.isMaxLength(12_000))
const count = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 10_000 })
)

export const WorkspaceBrowserAssertion = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), selector, value: text }),
  Schema.Struct({ type: Schema.Literal("value"), selector, value: text }),
  Schema.Struct({ type: Schema.Literal("count"), selector, value: count }),
  Schema.Struct({
    type: Schema.Literal("checked"),
    selector,
    value: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("visible"),
    selector,
    value: Schema.Boolean,
  }),
])
export type WorkspaceBrowserAssertion = typeof WorkspaceBrowserAssertion.Type

export const WorkspaceBrowserAction = Schema.Union([
  Schema.Struct({ type: Schema.Literal("start") }),
  Schema.Struct({ type: Schema.Literal("observe") }),
  Schema.Struct({ type: Schema.Literal("navigate") }),
  Schema.Struct({ type: Schema.Literal("reload") }),
  Schema.Struct({ type: Schema.Literal("close") }),
  Schema.Struct({ type: Schema.Literal("click"), selector }),
  Schema.Struct({ type: Schema.Literal("fill"), selector, value: text }),
  Schema.Struct({
    type: Schema.Literal("select"),
    selector,
    values: Schema.Array(text).check(Schema.isMaxLength(30)),
  }),
  Schema.Struct({
    type: Schema.Literal("press"),
    selector: Schema.optional(selector),
    key: Schema.Literals([
      "Enter",
      "Tab",
      "Escape",
      "Backspace",
      "Delete",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ]),
  }),
  Schema.Struct({
    type: Schema.Literal("scroll"),
    x: Schema.Int.check(
      Schema.isBetween({ minimum: -10_000, maximum: 10_000 })
    ),
    y: Schema.Int.check(
      Schema.isBetween({ minimum: -10_000, maximum: 10_000 })
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("wait"),
    selector,
    state: Schema.Literals(["visible", "hidden"]),
  }),
  Schema.Struct({
    type: Schema.Literal("assert"),
    assertion: WorkspaceBrowserAssertion,
  }),
])
export type WorkspaceBrowserAction = typeof WorkspaceBrowserAction.Type

export class WorkspaceBrowserSession extends Schema.Class<WorkspaceBrowserSession>(
  "@sylph/domain/WorkspaceBrowserSession"
)({
  id: Schema.NonEmptyString,
  workspaceId: WorkspaceId,
  conversationId: Schema.NonEmptyString,
  checkId: Schema.NonEmptyString,
  commit: GitCommitId,
  attempt: Schema.Int,
  previewUrl: Schema.NonEmptyString,
  sequence: Schema.Int,
  expiresAt: Schema.Number,
}) {}

export class WorkspaceBrowserFailure extends Schema.TaggedError<WorkspaceBrowserFailure>()(
  "WorkspaceBrowserFailure",
  {
    reason: Schema.Literals([
      "unavailable",
      "expired",
      "stale",
      "action_failed",
    ]),
    message: Schema.String,
  }
) {}
