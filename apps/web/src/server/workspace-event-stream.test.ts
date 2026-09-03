import { describe, expect, test } from "bun:test"
import { WorkspaceRuntimeEvent } from "@workspace/domain"

import {
  shouldForwardWorkspaceEvent,
  workspaceEventResponse,
} from "./workspace-event-stream"

describe("workspaceEventResponse", () => {
  test("forwards only events consumed by the Workspace UI", () => {
    expect(shouldForwardWorkspaceEvent({ type: "session.text.delta" })).toBe(
      true
    )
    expect(shouldForwardWorkspaceEvent({ type: "models-dev.refreshed" })).toBe(
      false
    )
  })

  test("streams OpenCode event envelopes as server-sent events", async () => {
    async function* events() {
      yield new WorkspaceRuntimeEvent({
        id: "event-1",
        created: 1,
        type: "session.text.delta",
        data: { delta: "hello" },
      })
      yield new WorkspaceRuntimeEvent({
        id: "event-2",
        created: 2,
        type: "permission.asked",
        data: { requestID: "permission-1" },
      })
    }

    const response = workspaceEventResponse(events())
    const body = await response.text()

    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8"
    )
    expect(body).toContain(
      'id: event-1\ndata: {"id":"event-1","created":1,"type":"session.text.delta","data":{"delta":"hello"}}'
    )
    expect(body).toContain('"type":"permission.asked"')
  })
})
