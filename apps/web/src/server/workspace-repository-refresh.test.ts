import { describe, expect, test } from "bun:test"

import {
  readWorkspaceVersionControlResponse,
  readCurrentProjectHead,
  workspaceVersionControlRequest,
} from "./workspace-repository-refresh"

describe("Workspace Project Repository refresh", () => {
  test("checks the current Project Repository head on every Workspace load", () => {
    expect(workspaceVersionControlRequest()).toBe(
      "https://workspace/vcs?refresh=1"
    )
  })

  test("does not hide a failed Project Repository head refresh", async () => {
    const failure = new Error("Project Repository unavailable")

    await expect(
      readCurrentProjectHead(async () => {
        throw failure
      })
    ).rejects.toBe(failure)
  })

  test("uses persisted commits when an error-state Workspace has no runtime VCS", async () => {
    const baseCommit = "a".repeat(40)
    const forkHead = "b".repeat(40)

    const result = await readWorkspaceVersionControlResponse(
      new Response("Workspace version control is not initialized", {
        status: 500,
      }),
      {
        defaultRef: "main",
        baseCommit,
        forkHead,
        syncStatus: "ready",
        mergeStatus: "unreviewed",
      }
    )

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

  test("does not hide other Workspace VCS failures", async () => {
    await expect(
      readWorkspaceVersionControlResponse(
        new Response("Artifact Repository unavailable", { status: 500 }),
        {
          defaultRef: "main",
          baseCommit: "a".repeat(40),
          forkHead: "b".repeat(40),
          syncStatus: "ready",
          mergeStatus: "unreviewed",
        }
      )
    ).rejects.toThrow("Artifact Repository unavailable")
  })
})
