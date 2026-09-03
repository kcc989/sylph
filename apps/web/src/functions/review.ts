import { createServerFn } from "@tanstack/react-start"
import { schema } from "@workspace/db"
import {
  InvalidRequest,
  PreconditionFailed,
  WorkspaceReview,
  WorkspaceReviewCommentInput,
  WorkspaceReviewDecisionInput,
  WorkspaceReviewResolutionInput,
} from "@workspace/domain"
import { and, count, eq, isNull } from "drizzle-orm"

import { workspaceMember } from "@/functions/middleware"
import { Schema } from "effect"

import {
  loadWorkspaceReview,
  reviewableWorkspace,
  reviewId,
} from "@/server/workspace-review-store"

const decodeWorkspaceReviewCommentInputPromise = Schema.decodeUnknownPromise(
  WorkspaceReviewCommentInput
)
const decodeWorkspaceReviewDecisionInputPromise = Schema.decodeUnknownPromise(
  WorkspaceReviewDecisionInput
)
const decodeWorkspaceReviewResolutionInputPromise = Schema.decodeUnknownPromise(
  WorkspaceReviewResolutionInput
)
const encodeWorkspaceReview = Schema.encodePromise(WorkspaceReview)

export const addWorkspaceReviewComment = createServerFn({ method: "POST" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspaceReviewCommentInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, user } = context
    if (data.endLine < data.startLine) {
      throw new InvalidRequest({
        message: "The review comment line range is invalid",
      })
    }
    const body = data.body.trim()
    if (!body) {
      throw new InvalidRequest({ message: "Write a comment before adding it" })
    }

    const workspace = reviewableWorkspace(context.workspace)
    if (workspace.forkHead !== data.commit) {
      throw new PreconditionFailed({
        message: "The Workspace changed. Review the latest Checkpoint",
      })
    }
    const id = reviewId(data.workspaceId, data.commit)
    const now = new Date()
    await database
      .insert(schema.workspaceReview)
      .values({
        id,
        workspaceId: data.workspaceId,
        commit: data.commit,
        decision: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
    await database.insert(schema.workspaceReviewComment).values({
      id: crypto.randomUUID(),
      reviewId: id,
      file: data.file,
      side: data.side,
      startLine: data.startLine,
      endLine: data.endLine,
      body,
      authorUserId: user.id,
      createdAt: now,
      updatedAt: now,
    })
    await database
      .update(schema.workspaceReview)
      .set({
        decision: "pending",
        reviewerUserId: null,
        submittedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.workspaceReview.id, id))

    return encodeWorkspaceReview(
      await loadWorkspaceReview(database, data.workspaceId, data.commit)
    )
  })

export const resolveWorkspaceReviewComment = createServerFn({ method: "POST" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspaceReviewResolutionInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, user } = context
    const workspace = reviewableWorkspace(context.workspace)
    const comment = await database
      .select({
        id: schema.workspaceReviewComment.id,
        reviewId: schema.workspaceReview.id,
        commit: schema.workspaceReview.commit,
      })
      .from(schema.workspaceReviewComment)
      .innerJoin(
        schema.workspaceReview,
        eq(schema.workspaceReview.id, schema.workspaceReviewComment.reviewId)
      )
      .where(
        and(
          eq(schema.workspaceReviewComment.id, data.commentId),
          eq(schema.workspaceReview.workspaceId, data.workspaceId)
        )
      )
      .get()
    if (!comment || comment.commit !== workspace.forkHead) {
      throw new PreconditionFailed({
        message: "This comment is not part of the current review",
      })
    }
    const now = new Date()
    await database
      .update(schema.workspaceReviewComment)
      .set({
        resolvedAt: data.resolved ? now : null,
        resolvedByUserId: data.resolved ? user.id : null,
        updatedAt: now,
      })
      .where(eq(schema.workspaceReviewComment.id, data.commentId))
    if (!data.resolved) {
      await database
        .update(schema.workspaceReview)
        .set({
          decision: "pending",
          reviewerUserId: null,
          submittedAt: null,
          updatedAt: now,
        })
        .where(eq(schema.workspaceReview.id, comment.reviewId))
    }

    return encodeWorkspaceReview(
      await loadWorkspaceReview(database, data.workspaceId, workspace.forkHead)
    )
  })

export const submitWorkspaceReview = createServerFn({ method: "POST" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspaceReviewDecisionInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, user } = context
    const workspace = reviewableWorkspace(context.workspace)
    if (workspace.forkHead !== data.commit) {
      throw new PreconditionFailed({
        message: "The Workspace changed. Review the latest Checkpoint",
      })
    }
    const id = reviewId(data.workspaceId, data.commit)
    if (data.decision === "approved") {
      const unresolved = await database
        .select({ value: count() })
        .from(schema.workspaceReviewComment)
        .where(
          and(
            eq(schema.workspaceReviewComment.reviewId, id),
            isNull(schema.workspaceReviewComment.resolvedAt)
          )
        )
        .get()
      if ((unresolved?.value ?? 0) > 0) {
        throw new PreconditionFailed({
          message: "Resolve all review comments before approving",
        })
      }
    }
    const now = new Date()
    await database
      .insert(schema.workspaceReview)
      .values({
        id,
        workspaceId: data.workspaceId,
        commit: data.commit,
        decision: data.decision,
        reviewerUserId: user.id,
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.workspaceReview.workspaceId,
          schema.workspaceReview.commit,
        ],
        set: {
          decision: data.decision,
          reviewerUserId: user.id,
          submittedAt: now,
          updatedAt: now,
        },
      })

    return encodeWorkspaceReview(
      await loadWorkspaceReview(database, data.workspaceId, data.commit)
    )
  })
