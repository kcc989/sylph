import { describe, expect, test } from "bun:test"

import { emptyWorkspaceLiveState } from "@/lib/workspace-runtime-events"
import { workspaceThreadEntries } from "./workspace-thread-entries"

describe("Workspace thread entries", () => {
  test("shows a ready entry for a new Workspace", () => {
    const entries = workspaceThreadEntries(
      { files: ["README.md"], messages: [], status: "ready" },
      emptyWorkspaceLiveState(),
      [],
      () => undefined
    )

    expect(entries[0]?.id).toBe("workspace-ready")
    expect(entries[0]?.details).toBeUndefined()
    expect(entries[0]?.meta).toBeUndefined()
  })

  test("appends optimistic and unsnapshotted streaming entries", () => {
    const entries = workspaceThreadEntries(
      {
        files: [],
        messages: [
          {
            id: "user-1",
            role: "user",
            createdAt: 1,
            parts: [{ type: "text", text: "Build it" }],
            error: null,
          },
        ],
        status: "running",
      },
      {
        partialMessages: { "agent-1": "Working" },
        permissionRequests: {},
      },
      [{ id: "optimistic-1", kind: "user", body: "Next task" }],
      () => undefined
    )

    expect(entries.map((entry) => entry.id)).toEqual([
      "user-1:text:0",
      "optimistic-1",
      "agent-1",
    ])
  })
})

test("does not claim a provisioning Workspace is ready", () => {
  const entries = workspaceThreadEntries(
    { files: [], messages: [], status: "provisioning" },
    emptyWorkspaceLiveState(),
    [],
    () => undefined
  )
  expect(entries[0]?.id).toBe("workspace-provisioning")
  expect(entries[0]?.title).toBe("Starting your Workspace")
})

test("renders system check notices separately from user messages", () => {
  const entries = workspaceThreadEntries(
    {
      files: [],
      status: "ready",
      messages: [
        {
          id: "notice",
          role: "user",
          createdAt: 1,
          notice: { summary: "Checks passed" },
          parts: [{ type: "text", text: "Checks passed" }],
          error: null,
        },
      ],
    },
    emptyWorkspaceLiveState(),
    [],
    () => undefined
  )
  expect(entries).toEqual([
    { id: "notice", kind: "notice", body: "Checks passed" },
  ])
})
