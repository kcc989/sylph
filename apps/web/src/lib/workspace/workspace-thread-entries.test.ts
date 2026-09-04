import { describe, expect, test } from "bun:test"

import { emptyWorkspaceLiveState } from "@/lib/workspace-runtime-events"
import { workspaceThreadEntries } from "./workspace-thread-entries"

describe("Workspace thread entries", () => {
  test("reports a failed turn when the provider produced no assistant message", () => {
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
        status: "ready",
        lastTurnOutcome: "failed",
      },
      emptyWorkspaceLiveState(),
      [],
      () => undefined
    )

    expect(entries.map((entry) => entry.id)).toEqual([
      "user-1:text:0",
      "turn-failed:user-1",
    ])
    expect(entries.at(-1)?.title).toBe("Assistant error")
  })

  test("keeps a specific assistant error without adding a generic failure", () => {
    const entries = workspaceThreadEntries(
      {
        files: [],
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            createdAt: 1,
            parts: [],
            error: "Provider unavailable",
          },
        ],
        status: "ready",
        lastTurnOutcome: "failed",
      },
      emptyWorkspaceLiveState(),
      [],
      () => undefined
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.body).toBe("Provider unavailable")
  })

  test("does not show the previous failure during a new turn", () => {
    for (const status of ["running", "provisioning", "interrupted"]) {
      const entries = workspaceThreadEntries(
        { files: [], messages: [], status, lastTurnOutcome: "failed" },
        emptyWorkspaceLiveState(),
        [],
        () => undefined
      )
      expect(entries.some((entry) => entry.id.startsWith("turn-failed:"))).toBe(
        false
      )
    }
  })

  test("hides the previous failure as soon as a retry is submitted", () => {
    const entries = workspaceThreadEntries(
      { files: [], messages: [], status: "ready", lastTurnOutcome: "failed" },
      emptyWorkspaceLiveState(),
      [{ id: "retry", kind: "user", body: "Retry" }],
      () => undefined
    )
    expect(entries.some((entry) => entry.id.startsWith("turn-failed:"))).toBe(
      false
    )
    expect(entries.at(-1)?.id).toBe("retry")
  })

  test("does not infer a failed turn from a missing assistant message", () => {
    for (const lastTurnOutcome of [null, "succeeded"] as const) {
      const entries = workspaceThreadEntries(
        { files: [], messages: [], status: "ready", lastTurnOutcome },
        emptyWorkspaceLiveState(),
        [],
        () => undefined
      )
      expect(entries.some((entry) => entry.id.startsWith("turn-failed:"))).toBe(
        false
      )
    }
  })

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
