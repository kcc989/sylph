import { describe, expect, test } from "bun:test"
import { GitCommitId, WorkspaceRebaseResult } from "@workspace/domain"

import { serializableWorkspaceRebaseResult } from "./workspace-rebase-result"

describe("Workspace rebase response", () => {
  test("returns a plain server-function payload", () => {
    const baseCommit = GitCommitId.make(
      "1111111111111111111111111111111111111111"
    )
    const forkHead = GitCommitId.make(
      "2222222222222222222222222222222222222222"
    )
    const result = serializableWorkspaceRebaseResult(
      new WorkspaceRebaseResult({
        baseCommit,
        forkHead,
        projectHead: baseCommit,
      })
    )

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(result).toEqual({
      baseCommit,
      forkHead,
      projectHead: baseCommit,
    })
  })
})
