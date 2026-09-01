import type { WorkspaceReviewDecision } from "@workspace/domain"

export const reviewAllowsAcceptance = (input: {
  decision: WorkspaceReviewDecision
  reviewCommit: string
  forkHead: string
  unresolvedComments: number
}) =>
  input.decision === "approved" &&
  input.reviewCommit === input.forkHead &&
  input.unresolvedComments === 0

export const reviewDecisionAfterComment = () => "pending" as const
