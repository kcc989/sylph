import { describe, expect, test } from "bun:test"
import { WorkspaceVersionControlSnapshot } from "@workspace/domain"
import { Schema } from "effect"

import { readWorkspaceVersionControlSnapshot } from "./workspace-repository-refresh"

const baseCommit = "a".repeat(40)
const forkHead = "b".repeat(40)
const snapshot = Schema.decodeUnknownSync(WorkspaceVersionControlSnapshot)({
  vcs: {
    defaultRef: "main",
    currentRef: "main",
    baseCommit,
    forkHead,
    projectHead: baseCommit,
    projectChanged: false,
    syncStatus: "ready" as const,
    mergeStatus: "ready" as const,
    working: [],
    branch: [],
  },
  checkpoints: [
    {
      id: "checkpoint-1",
      commit: forkHead,
      message: "Add feature",
      createdAt: 1,
    },
  ],
})

describe("Workspace Project Repository refresh", () => {
  test("decodes the runtime snapshot when version control is initialized", async () => {
    const result = await readWorkspaceVersionControlSnapshot(snapshot, {
      defaultRef: "main",
      baseCommit: null,
      forkHead: null,
      syncStatus: "pending",
      mergeStatus: "unreviewed",
    })

    expect(result.versionControl).toMatchObject({ forkHead })
    expect(result.checkpoints).toHaveLength(1)
  })

  test("returns persisted commits immediately while a Workspace initializes", async () => {
    const result = await readWorkspaceVersionControlSnapshot(null, {
      defaultRef: "main",
      baseCommit,
      forkHead,
      syncStatus: "ready",
      mergeStatus: "unreviewed",
    })

    expect(result.versionControl).toMatchObject({
      defaultRef: "main",
      currentRef: "main",
      baseCommit,
      forkHead,
      projectHead: baseCommit,
      projectChanged: false,
      syncStatus: "ready",
      mergeStatus: "unreviewed",
      working: [],
      branch: [],
    })
    expect(result.checkpoints).toEqual([])
  })

  test("reports a Workspace that has neither runtime nor persisted version control", async () => {
    await expect(
      readWorkspaceVersionControlSnapshot(null, {
        defaultRef: "main",
        baseCommit: null,
        forkHead: null,
        syncStatus: "pending",
        mergeStatus: "unreviewed",
      })
    ).rejects.toThrow("Workspace version control is not initialized")
  })
})
