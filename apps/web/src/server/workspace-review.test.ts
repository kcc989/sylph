import { describe, expect, test } from "bun:test"

import {
  reviewAllowsAcceptance,
  reviewDecisionAfterComment,
} from "./workspace-review"

describe("Workspace review", () => {
  test("accepts only an approval for the current Workspace revision", () => {
    expect(
      reviewAllowsAcceptance({
        decision: "approved",
        reviewCommit: "current",
        forkHead: "current",
        unresolvedComments: 0,
      })
    ).toBeTrue()
    expect(
      reviewAllowsAcceptance({
        decision: "changes_requested",
        reviewCommit: "current",
        forkHead: "current",
        unresolvedComments: 0,
      })
    ).toBeFalse()
    expect(
      reviewAllowsAcceptance({
        decision: "approved",
        reviewCommit: "earlier",
        forkHead: "current",
        unresolvedComments: 0,
      })
    ).toBeFalse()
    expect(
      reviewAllowsAcceptance({
        decision: "approved",
        reviewCommit: "current",
        forkHead: "current",
        unresolvedComments: 1,
      })
    ).toBeFalse()
  })

  test("returns a review to pending when a comment is added", () => {
    expect(reviewDecisionAfterComment()).toBe("pending")
  })
})
