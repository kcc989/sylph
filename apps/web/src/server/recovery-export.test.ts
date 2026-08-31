import { describe, expect, test } from "bun:test"

import { recoveryRepositoryEntry } from "./recovery-export"

describe("Recovery export", () => {
  test("uses the actual repository head instead of stale Workspace metadata", () => {
    const entry = recoveryRepositoryEntry(
      {
        kind: "workspace",
        id: "workspace-1",
        title: "Conflict recovery",
        repositoryName: "workspace-repository",
        baseCommit: "1111111111111111111111111111111111111111",
        forkHead: "2222222222222222222222222222222222222222",
        acceptedCommit: null,
      },
      {
        id: "repository-1",
        name: "workspace-repository",
        remote: "https://repositories.example/workspace.git",
        defaultBranch: "main",
      },
      { username: "x", password: "token", expiresAt: "later" },
      "3333333333333333333333333333333333333333"
    )

    expect(entry.headCommit).toBe("3333333333333333333333333333333333333333")
    expect(entry.forkHead).toBe("3333333333333333333333333333333333333333")
  })
})
