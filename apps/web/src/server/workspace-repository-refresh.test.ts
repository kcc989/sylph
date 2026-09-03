import { describe, expect, test } from "bun:test"
import {
  isRuntimeNotInitialized,
  WorkspaceVersionControlSnapshot,
} from "@workspace/domain"
import { Schema } from "effect"

import {
  readWorkspaceVersionControlSnapshot,
  waitForWorkspaceVersionControl,
} from "./workspace-repository-refresh"

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
  test("waits while a new Workspace initializes version control", async () => {
    let attempts = 0

    const result = await waitForWorkspaceVersionControl(
      async () => {
        attempts += 1
        return attempts === 1 ? null : snapshot
      },
      { attempts: 2, delay: async () => undefined }
    )

    expect(result).toBe(snapshot)
    expect(attempts).toBe(2)
  })

  test("gives up when version control never initializes", async () => {
    const failure = await waitForWorkspaceVersionControl(async () => null, {
      attempts: 2,
      delay: async () => undefined,
    }).catch((cause) => cause)
    expect(isRuntimeNotInitialized(failure)).toBe(true)
    expect(failure.message).toBe("Workspace version control is not initialized")
  })

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

  test("uses persisted commits when an error-state Workspace has no runtime VCS", async () => {
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
