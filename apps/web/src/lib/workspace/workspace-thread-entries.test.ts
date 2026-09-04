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
    expect(entries[0]?.details).toEqual(["README.md"])
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
