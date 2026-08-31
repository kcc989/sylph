import { describe, expect, test } from "bun:test"

import {
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
})
