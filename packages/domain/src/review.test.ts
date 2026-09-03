import { describe, expect, test } from "bun:test"

import { Schema } from "effect"

import {
  WorkspaceReviewCommentInput,
  WorkspaceReviewDecisionInput,
} from "./review"

const decodeWorkspaceReviewCommentInputPromise = Schema.decodeUnknownPromise(
  WorkspaceReviewCommentInput
)
const decodeWorkspaceReviewDecisionInputPromise = Schema.decodeUnknownPromise(
  WorkspaceReviewDecisionInput
)

const commit = "a".repeat(40)

describe("Workspace review", () => {
  test("decodes a line comment for a Workspace revision", async () => {
    const input = await decodeWorkspaceReviewCommentInputPromise({
      workspaceId: "4b44fa1e-04a4-4ba8-b91a-5084d28a8428",
      commit,
      file: "apps/web/src/routes/index.tsx",
      side: "additions",
      startLine: 12,
      endLine: 14,
      body: "Keep the loading state visible until the request finishes.",
    })

    expect(input.startLine).toBe(12)
    expect(input.endLine).toBe(14)
  })

  test("rejects an empty or oversized line comment", async () => {
    await expect(
      decodeWorkspaceReviewCommentInputPromise({
        workspaceId: "4b44fa1e-04a4-4ba8-b91a-5084d28a8428",
        commit,
        file: "apps/web/src/routes/index.tsx",
        side: "additions",
        startLine: 12,
        endLine: 12,
        body: "",
      })
    ).rejects.toBeDefined()
    await expect(
      decodeWorkspaceReviewCommentInputPromise({
        workspaceId: "4b44fa1e-04a4-4ba8-b91a-5084d28a8428",
        commit,
        file: "apps/web/src/routes/index.tsx",
        side: "additions",
        startLine: 12,
        endLine: 12,
        body: "x".repeat(5_001),
      })
    ).rejects.toBeDefined()
  })

  test("accepts only a final review decision", async () => {
    const input = await decodeWorkspaceReviewDecisionInputPromise({
      workspaceId: "4b44fa1e-04a4-4ba8-b91a-5084d28a8428",
      commit,
      decision: "changes_requested",
    })

    expect(input.decision).toBe("changes_requested")
    await expect(
      decodeWorkspaceReviewDecisionInputPromise({
        workspaceId: "4b44fa1e-04a4-4ba8-b91a-5084d28a8428",
        commit,
        decision: "pending",
      })
    ).rejects.toBeDefined()
  })
})
