import { describe, expect, test } from "bun:test"

import {
  readCurrentProjectHead,
  readWorkspaceVersionControl,
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

  test("waits while a new Workspace initializes version control", async () => {
    let attempts = 0

    const response = await readWorkspaceVersionControl(
      async () => {
        attempts += 1
        return attempts === 1
          ? new Response("Workspace version control is not initialized", {
              status: 409,
            })
          : Response.json({ vcs: {} })
      },
      { attempts: 2, delay: async () => undefined }
    )

    expect(response.ok).toBe(true)
    expect(attempts).toBe(2)
  })

  test("reports version-control failures that are not initialization races", async () => {
    await expect(
      readWorkspaceVersionControl(
        async () => new Response("Repository unavailable", { status: 503 }),
        { attempts: 2, delay: async () => undefined }
      )
    ).rejects.toThrow("Repository unavailable")
  })
})
