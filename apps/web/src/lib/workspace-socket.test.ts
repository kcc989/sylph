import { describe, expect, test } from "bun:test"
import { WorkspaceRuntimeEvent } from "@workspace/domain"

import { advanceWorkspaceSocketCursor } from "./workspace-socket"

const event = (sequence?: number) =>
  new WorkspaceRuntimeEvent({
    id: `event-${sequence ?? "ephemeral"}`,
    created: 1,
    type: "session.idle",
    data: {},
    durable:
      sequence === undefined
        ? undefined
        : { aggregateID: "session-1", seq: sequence, version: 1 },
  })

describe("Workspace socket client cursor", () => {
  test("drops a reconnect duplicate and applies the next durable event", () => {
    expect(advanceWorkspaceSocketCursor(event(8), 8)).toBeNull()
    expect(advanceWorkspaceSocketCursor(event(9), 8)).toBe(9)
  })

  test("applies ephemeral events without moving the durable cursor", () => {
    expect(advanceWorkspaceSocketCursor(event(), 9)).toBe(9)
  })
})
