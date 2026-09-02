import { schema } from "@workspace/db"
import {
  GitCommitId,
  PreconditionFailed,
  WorkspaceReadOnly,
  WorkspaceReview,
  WorkspaceReviewActor,
  WorkspaceReviewComment,
} from "@workspace/domain"
import { and, eq } from "drizzle-orm"
import { alias } from "drizzle-orm/sqlite-core"

import type { Database } from "@/server/organization-access"

const reviewResolver = alias(schema.user, "review_resolver")

export const reviewId = (workspaceId: string, commit: string) =>
  `review:${workspaceId}:${commit}`

const reviewActor = (input: {
  id: string
  name: string
  image: string | null
}) =>
  new WorkspaceReviewActor({
    id: input.id,
    name: input.name,
    image: input.image,
  })

export const loadWorkspaceReview = async (
  database: Database,
  workspaceId: string,
  commit: GitCommitId
) => {
  const review = await database
    .select({
      id: schema.workspaceReview.id,
      decision: schema.workspaceReview.decision,
      submittedAt: schema.workspaceReview.submittedAt,
      reviewerId: schema.user.id,
      reviewerName: schema.user.name,
      reviewerImage: schema.user.image,
    })
    .from(schema.workspaceReview)
    .leftJoin(
      schema.user,
      eq(schema.user.id, schema.workspaceReview.reviewerUserId)
    )
    .where(
      and(
        eq(schema.workspaceReview.workspaceId, workspaceId),
        eq(schema.workspaceReview.commit, commit)
      )
    )
    .get()
  const rows = review
    ? await database
        .select({
          id: schema.workspaceReviewComment.id,
          file: schema.workspaceReviewComment.file,
          side: schema.workspaceReviewComment.side,
          startLine: schema.workspaceReviewComment.startLine,
          endLine: schema.workspaceReviewComment.endLine,
          body: schema.workspaceReviewComment.body,
          createdAt: schema.workspaceReviewComment.createdAt,
          resolvedAt: schema.workspaceReviewComment.resolvedAt,
          authorId: schema.user.id,
          authorName: schema.user.name,
          authorImage: schema.user.image,
          resolverId: reviewResolver.id,
          resolverName: reviewResolver.name,
          resolverImage: reviewResolver.image,
        })
        .from(schema.workspaceReviewComment)
        .innerJoin(
          schema.user,
          eq(schema.user.id, schema.workspaceReviewComment.authorUserId)
        )
        .leftJoin(
          reviewResolver,
          eq(reviewResolver.id, schema.workspaceReviewComment.resolvedByUserId)
        )
        .where(eq(schema.workspaceReviewComment.reviewId, review.id))
        .orderBy(schema.workspaceReviewComment.createdAt)
    : []
  const decision =
    review?.decision === "approved" || review?.decision === "changes_requested"
      ? review.decision
      : "pending"

  return new WorkspaceReview({
    commit,
    decision,
    reviewer:
      review?.reviewerId && review.reviewerName
        ? reviewActor({
            id: review.reviewerId,
            name: review.reviewerName,
            image: review.reviewerImage,
          })
        : null,
    submittedAt: review?.submittedAt?.getTime() ?? null,
    comments: rows.map(
      (comment) =>
        new WorkspaceReviewComment({
          id: comment.id,
          file: comment.file,
          side: comment.side === "deletions" ? "deletions" : "additions",
          startLine: comment.startLine,
          endLine: comment.endLine,
          body: comment.body,
          author: reviewActor({
            id: comment.authorId,
            name: comment.authorName,
            image: comment.authorImage,
          }),
          createdAt: comment.createdAt.getTime(),
          resolvedAt: comment.resolvedAt?.getTime() ?? null,
          resolvedBy:
            comment.resolverId && comment.resolverName
              ? reviewActor({
                  id: comment.resolverId,
                  name: comment.resolverName,
                  image: comment.resolverImage,
                })
              : null,
        })
    ),
  })
}

export const reviewableWorkspace = <
  Workspace extends {
    readonly id: string
    readonly status: string
    readonly forkHead: string | null
  },
>(
  workspace: Workspace
) => {
  if (workspace.status === "merging" || workspace.status === "archived") {
    throw new WorkspaceReadOnly({
      message: "This Workspace can no longer be reviewed",
      status: workspace.status,
    })
  }
  if (!workspace.forkHead) {
    throw new PreconditionFailed({
      message: "Create a Checkpoint before reviewing this Workspace",
    })
  }
  return { ...workspace, forkHead: GitCommitId.make(workspace.forkHead) }
}
