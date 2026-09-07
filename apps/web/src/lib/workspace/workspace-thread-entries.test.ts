import { describe, expect, test } from "bun:test"

import { emptyWorkspaceLiveState } from "@/lib/workspace-runtime-events"
import { workspaceThreadEntries } from "./workspace-thread-entries"

describe("Workspace thread entries", () => {
  test("leaves a new ready Workspace conversation empty", () => {
    const entries = workspaceThreadEntries(
      { files: ["README.md"], messages: [], status: "ready" },
      emptyWorkspaceLiveState(),
      [],
      () => undefined
    )

    expect(entries).toEqual([])
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
        dismissedPermissionRequests: [],
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

test("leaves a provisioning Workspace conversation empty", () => {
  const entries = workspaceThreadEntries(
    { files: [], messages: [], status: "provisioning" },
    emptyWorkspaceLiveState(),
    [],
    () => undefined
  )
  expect(entries).toEqual([])
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
