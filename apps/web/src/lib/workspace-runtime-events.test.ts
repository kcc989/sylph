import { describe, expect, test } from "bun:test"
import { WorkspaceRuntimeEvent } from "@workspace/domain"

import {
  applyWorkspaceRuntimeEvent,
  emptyWorkspaceLiveState,
  workspaceEventNeedsSnapshot,
} from "./workspace-runtime-events"

describe("applyWorkspaceRuntimeEvent", () => {
  test("accumulates assistant text deltas", async () => {
    const first = await applyWorkspaceRuntimeEvent(
      emptyWorkspaceLiveState(),
      new WorkspaceRuntimeEvent({
        id: "event-1",
        created: 1,
        type: "session.text.delta",
        data: {
          sessionID: "session-1",
          assistantMessageID: "message-1",
          delta: "Hel",
        },
      })
    )
    const second = await applyWorkspaceRuntimeEvent(
      first,
      new WorkspaceRuntimeEvent({
        id: "event-2",
        created: 2,
        type: "session.text.delta",
        data: {
          sessionID: "session-1",
          assistantMessageID: "message-1",
          delta: "lo",
        },
      })
    )

    expect(second.partialMessages["message-1"]).toBe("Hello")
  })

  test("adds and removes permission requests", async () => {
    const asked = await applyWorkspaceRuntimeEvent(
      emptyWorkspaceLiveState(),
      new WorkspaceRuntimeEvent({
        id: "event-1",
        created: 1,
        type: "permission.asked",
        data: {
          id: "permission-1",
          sessionID: "session-1",
          action: "workspace_write_file",
          resources: ["SMOKE_TEST.md"],
          save: ["SMOKE_TEST.md"],
        },
      })
    )

    expect(asked.permissionRequests["permission-1"]?.canSave).toBe(true)

    const replied = await applyWorkspaceRuntimeEvent(
      asked,
      new WorkspaceRuntimeEvent({
        id: "event-2",
        created: 2,
        type: "permission.replied",
        data: {
          sessionID: "session-1",
          requestID: "permission-1",
          reply: "once",
        },
      })
    )

    expect(replied.permissionRequests).toEqual({})
  })

  test("refreshes durable inbox and question changes", () => {
    for (const type of [
      "session.inbox.enqueued",
      "session.inbox.delivered",
      "session.inbox.cancelled",
      "session.tool.called",
      "form.created",
      "form.replied",
      "form.cancelled",
    ]) {
      expect(
        workspaceEventNeedsSnapshot(
          new WorkspaceRuntimeEvent({
            id: type,
            created: 1,
            type,
            data: {},
          })
        )
      ).toBeTrue()
    }
  })
})
