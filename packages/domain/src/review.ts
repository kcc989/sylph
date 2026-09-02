import { Schema } from "effect"

import { WorkspaceId } from "./ids"
import { GitCommitId } from "./version-control"

export const WorkspaceReviewDecision = Schema.Literals([
  "pending",
  "approved",
  "changes_requested",
])
export type WorkspaceReviewDecision = typeof WorkspaceReviewDecision.Type

export const WorkspaceReviewSide = Schema.Literals(["additions", "deletions"])
export type WorkspaceReviewSide = typeof WorkspaceReviewSide.Type

const ReviewLineNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const ReviewBody = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(5_000)
)

export class WorkspaceReviewActor extends Schema.Class<WorkspaceReviewActor>(
  "@sylph/domain/WorkspaceReviewActor"
)({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  image: Schema.NullOr(Schema.String),
}) {}

export class WorkspaceReviewComment extends Schema.Class<WorkspaceReviewComment>(
  "@sylph/domain/WorkspaceReviewComment"
)({
  id: Schema.NonEmptyString,
  file: Schema.NonEmptyString,
  side: WorkspaceReviewSide,
  startLine: ReviewLineNumber,
  endLine: ReviewLineNumber,
  body: ReviewBody,
  author: WorkspaceReviewActor,
  createdAt: Schema.Number,
  resolvedAt: Schema.NullOr(Schema.Number),
  resolvedBy: Schema.NullOr(WorkspaceReviewActor),
}) {}

export class WorkspaceReview extends Schema.Class<WorkspaceReview>(
  "@sylph/domain/WorkspaceReview"
)({
  commit: GitCommitId,
  decision: WorkspaceReviewDecision,
  reviewer: Schema.NullOr(WorkspaceReviewActor),
  submittedAt: Schema.NullOr(Schema.Number),
  comments: Schema.Array(WorkspaceReviewComment),
}) {}

export class WorkspaceReviewCommentInput extends Schema.Class<WorkspaceReviewCommentInput>(
  "@sylph/domain/WorkspaceReviewCommentInput"
)({
  workspaceId: WorkspaceId,
  commit: GitCommitId,
  file: Schema.NonEmptyString,
  side: WorkspaceReviewSide,
  startLine: ReviewLineNumber,
  endLine: ReviewLineNumber,
  body: ReviewBody,
}) {}

export class WorkspaceReviewResolutionInput extends Schema.Class<WorkspaceReviewResolutionInput>(
  "@sylph/domain/WorkspaceReviewResolutionInput"
)({
  workspaceId: WorkspaceId,
  commentId: Schema.NonEmptyString,
  resolved: Schema.Boolean,
}) {}

export class WorkspaceReviewDecisionInput extends Schema.Class<WorkspaceReviewDecisionInput>(
  "@sylph/domain/WorkspaceReviewDecisionInput"
)({
  workspaceId: WorkspaceId,
  commit: GitCommitId,
  decision: Schema.Literals(["approved", "changes_requested"]),
}) {}
