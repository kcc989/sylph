import { describe, expect, test } from "bun:test"
import { WorkspaceRuntimeEvent } from "@workspace/domain"

import {
  encodeWorkspaceSocketFrame,
  shouldForwardWorkspaceEvent,
  workspaceEventFollowsCursor,
  workspaceEventSessionId,
  workspacePresence,
  type WorkspaceSocketAttachment,
} from "./workspace-socket-server"

const attachment = (
  input: Partial<WorkspaceSocketAttachment> & { userId: string; name: string }
): WorkspaceSocketAttachment => ({
  writable: true,
  connectedAt: 1,
  sessionId: "session-1",
  cursor: null,
  synced: true,
  ...input,
})

describe("Workspace socket server", () => {
  test("forwards only events consumed by the Workspace UI", () => {
    expect(shouldForwardWorkspaceEvent({ type: "session.text.delta" })).toBe(
      true
    )
    expect(shouldForwardWorkspaceEvent({ type: "session.tool.called" })).toBe(
      true
    )
    expect(shouldForwardWorkspaceEvent({ type: "models-dev.refreshed" })).toBe(
      false
    )
  })

  test("filters replayed durable events without dropping ephemeral events", () => {
    const durable = new WorkspaceRuntimeEvent({
      id: "event-1",
      created: 1,
      type: "session.idle",
      data: {},
      durable: { aggregateID: "session-1", seq: 7, version: 1 },
    })
    const ephemeral = new WorkspaceRuntimeEvent({
      id: "event-2",
      created: 2,
      type: "permission.asked",
      data: {},
    })

    expect(workspaceEventFollowsCursor(durable, 7)).toBe(false)
    expect(workspaceEventFollowsCursor(durable, 6)).toBe(true)
    expect(workspaceEventFollowsCursor(ephemeral, 7)).toBe(true)
  })

  test("reads direct and nested OpenCode session identities", () => {
    const direct = new WorkspaceRuntimeEvent({
      id: "event-1",
      created: 1,
      type: "session.idle",
      data: { sessionID: "session-1" },
    })
    const nested = new WorkspaceRuntimeEvent({
      id: "event-2",
      created: 2,
      type: "form.created",
      data: { form: { sessionID: "session-2" } },
    })

    expect(workspaceEventSessionId(direct)).toBe("session-1")
    expect(workspaceEventSessionId(nested)).toBe("session-2")
  })

  test("builds presence from initialized socket attachments", () => {
    expect(
      workspacePresence([
        attachment({ userId: "user-1", name: "Ada" }),
        attachment({ userId: "user-1", name: "Ada", connectedAt: 2 }),
        attachment({
          userId: "user-2",
          name: "Grace",
          sessionId: null,
        }),
      ])
    ).toEqual([{ userId: "user-1", name: "Ada", connections: 2 }])
  })

  test("truncates oversized event payloads before encoding", () => {
    const encoded = encodeWorkspaceSocketFrame({
      type: "event",
      event: new WorkspaceRuntimeEvent({
        id: "event-1",
        created: 1,
        type: "session.tool.success",
        data: { output: "x".repeat(70_000) },
      }),
    })

    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThanOrEqual(
      64 * 1024
    )
    expect(encoded).toContain('"truncated":true')
  })
})
