import { describe, expect, test } from "bun:test"
import { PreconditionFailed, WorkspaceReadOnly } from "@workspace/domain"

import { reviewableWorkspace } from "./workspace-review-store"

const forkHead = "a".repeat(40)

describe("Reviewable Workspace", () => {
  test("brands the fork head of a reviewable Workspace", () => {
    const reviewable = reviewableWorkspace({
      id: "workspace-1",
      status: "ready",
      forkHead,
    })

    expect(reviewable).toMatchObject({ forkHead })
  })

  test("rejects review before the first Checkpoint", () => {
    expect(() =>
      reviewableWorkspace({
        id: "workspace-1",
        status: "ready",
        forkHead: null,
      })
    ).toThrow(PreconditionFailed)
  })

  test("rejects review once the Workspace is merging or archived", () => {
    for (const status of ["merging", "archived"]) {
      let failure: unknown
      try {
        reviewableWorkspace({ id: "workspace-1", status, forkHead })
      } catch (cause) {
        failure = cause
      }
      expect(failure).toBeInstanceOf(WorkspaceReadOnly)
      expect(failure).toMatchObject({ status })
    }
  })
})
