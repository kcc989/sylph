import { describe, expect, test } from "bun:test"
import {
  WorkspaceRuntimeEvent,
  type WorkspaceSocketServerFrame,
} from "@workspace/domain"

import {
  advanceWorkspaceSocketCursor,
  WorkspaceSocket,
} from "./workspace-socket"

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

test("reconnect replays an event whose application failed and ignores the old connection", async () => {
  const sockets: FakeSocket[] = []
  const timers: Array<() => void> = []
  class FakeSocket extends EventTarget {
    static OPEN = 1
    readyState = 1
    sent: string[] = []
    constructor() {
      super()
      sockets.push(this)
    }
    send(frame: string) {
      this.sent.push(frame)
    }
    close(code = 1000) {
      this.readyState = 3
      this.dispatchEvent(Object.assign(new Event("close"), { code }))
    }
    receive(data: WorkspaceSocketServerFrame) {
      this.dispatchEvent(
        new MessageEvent("message", { data: JSON.stringify(data) })
      )
    }
  }
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")
  const socketDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "WebSocket"
  )
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { href: "https://sylph.test/workspace" },
      setTimeout: (callback: () => void) => timers.push(callback),
      clearTimeout: () => {},
    },
  })
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeSocket,
  })
  const applied: string[] = []
  let fails = true
  const client = new WorkspaceSocket({
    workspaceId: "workspace",
    sessionId: "session-1",
    cursor: 8,
    onConnecting: () => {},
    onPresence: () => {},
    onSynced: () => {},
    onEvent: (value) => {
      if (fails) {
        fails = false
        throw new Error("refresh failed")
      }
      applied.push(value.id)
    },
  })
  try {
    client.connect()
    const first = sockets[0]
    if (!first) throw new Error("Missing socket")
    first.dispatchEvent(new Event("open"))
    first.receive({ type: "event", event: event(9) })
    await Bun.sleep(10)
    timers.shift()?.()
    const second = sockets[1]
    if (!second) throw new Error("Missing reconnect")
    second.dispatchEvent(new Event("open"))
    expect(JSON.parse(second.sent[0] ?? "{}").cursor).toBe(8)
    first.receive({ type: "event", event: event(100) })
    second.receive({ type: "event", event: event(9) })
    second.receive({ type: "event", event: event(9) })
    await Bun.sleep(10)
    expect(applied).toEqual(["event-9"])
    second.close(1006)
    timers.shift()?.()
    const third = sockets[2]
    if (!third) throw new Error("Missing second reconnect")
    third.dispatchEvent(new Event("open"))
    expect(JSON.parse(third.sent[0] ?? "{}").cursor).toBe(9)
  } finally {
    client.close()
    if (windowDescriptor)
      Object.defineProperty(globalThis, "window", windowDescriptor)
    else Reflect.deleteProperty(globalThis, "window")
    if (socketDescriptor)
      Object.defineProperty(globalThis, "WebSocket", socketDescriptor)
    else Reflect.deleteProperty(globalThis, "WebSocket")
  }
})
