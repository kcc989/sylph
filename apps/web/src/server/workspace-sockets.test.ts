import { describe, expect, test } from "bun:test"
import {
  WorkspaceRuntimeEvent,
  WorkspaceSocketAttachment,
  WorkspaceSocketServerFrame,
} from "@workspace/domain"
import { Effect, Schema } from "effect"
import {
  WorkspaceSockets,
  type WorkspaceSocketSource,
} from "./workspace-sockets"

const decodeFrame = Schema.decodeUnknownSync(WorkspaceSocketServerFrame)
class Socket {
  readyState: WebSocket["readyState"] = 1
  frames: WorkspaceSocketServerFrame[] = []
  attachment: typeof WorkspaceSocketAttachment.Type = {
    userId: "user",
    name: "Ada",
    writable: true,
    connectedAt: 1,
    sessionId: null,
    cursor: null,
    synced: false,
  }
  serializeAttachment(value: typeof WorkspaceSocketAttachment.Type) {
    this.attachment = value
  }
  deserializeAttachment() {
    return this.attachment
  }
  send(value: string) {
    if (this.readyState !== 1) throw new Error("Closed")
    this.frames.push(decodeFrame(JSON.parse(value)))
  }
  close() {
    this.readyState = 3
  }
}

const event = (sequence: number, sessionID = "session") =>
  new WorkspaceRuntimeEvent({
    id: `event-${sequence}`,
    created: sequence,
    type: "session.idle",
    data: { sessionID },
    durable: { seq: sequence },
  })
const deferred = () => {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const fixture = (replay: WorkspaceSocketSource["sessions"]["log"]) => {
  const sockets: Socket[] = []
  const cursors: number[] = []
  const pending: WorkspaceRuntimeEvent[] = []
  const signals: AbortSignal[] = []
  const subscriptions: Promise<void>[] = []
  let wake = deferred()
  const source: WorkspaceSocketSource = {
    sessions: { log: replay },
    permission: { request: { list: async () => ({ data: [] }) } },
    events: {
      subscribe: async function* ({ signal }) {
        signals.push(signal)
        signal.addEventListener("abort", () => wake.resolve(), { once: true })
        while (!signal.aborted) {
          const next = pending.shift()
          if (next) {
            yield next
            continue
          }
          await wake.promise
          wake = deferred()
        }
      },
    },
  }
  const layer = WorkspaceSockets.layer(
    {
      getWebSockets: (tag) =>
        sockets.filter(
          (socket) => !tag || tag === `user:${socket.attachment.userId}`
        ),
      waitUntil: (promise) => {
        subscriptions.push(promise)
      },
    },
    Promise.resolve(source),
    () => ({ sessionId: "session", archivedAt: null }),
    (cursor) => {
      cursors.push(cursor)
    }
  )
  const service = Effect.runSync(
    Effect.gen(function* () {
      return yield* WorkspaceSockets
    }).pipe(Effect.provide(layer))
  )
  return {
    service,
    sockets,
    cursors,
    signals,
    connect: async (socket: Socket, cursor: number | null = null) => {
      sockets.push(socket)
      await service.webSocketMessage(
        socket,
        JSON.stringify({ type: "hello", sessionId: "session", cursor })
      )
    },
    emit: (value: WorkspaceRuntimeEvent) => {
      pending.push(value)
      wake.resolve()
    },
    stop: async () => {
      service.stop()
      await Promise.all(subscriptions)
    },
  }
}
const received = (socket: Socket) =>
  socket.frames.flatMap((frame) =>
    frame.type === "event" ? [frame.event.id] : []
  )
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("Workspace socket synchronization", () => {
  test("buffers live events during replay and suppresses duplicate durable events", async () => {
    const replayStarted = deferred()
    const finishReplay = deferred()
    const f = fixture(async function* () {
      replayStarted.resolve()
      await finishReplay.promise
      yield event(1)
      yield event(2)
      yield { type: "log.synced", seq: 2 }
    })
    const socket = new Socket()
    const connecting = f.connect(socket)
    await replayStarted.promise
    f.emit(event(2))
    f.emit(event(3))
    f.emit(event(4, "other-session"))
    await tick()
    expect(received(socket)).toEqual([])
    finishReplay.resolve()
    await connecting
    expect(received(socket)).toEqual(["event-1", "event-2", "event-3"])
    expect(socket.attachment.cursor).toBe(3)
    expect(
      socket.frames.some(
        (frame) => frame.type === "synced" && frame.cursor === 3
      )
    ).toBe(true)
    await f.stop()
  })
  test("reconnects from the saved cursor and counts tabs in presence", async () => {
    const f = fixture(async function* () {
      yield event(1)
      yield event(2)
    })
    const first = new Socket()
    await f.connect(first, 1)
    const second = new Socket()
    await f.connect(second, 2)
    expect(received(first)).toEqual(["event-2"])
    expect(received(second)).toEqual([])
    expect(second.frames.at(-1)).toEqual({
      type: "presence",
      users: [{ userId: "user", name: "Ada", connections: 2 }],
    })
    f.service.webSocketClose(first, 1000, "Closed", true)
    expect(f.signals[0]?.aborted).toBe(false)
    f.service.webSocketClose(second, 1000, "Closed", true)
    expect(f.signals[0]?.aborted).toBe(true)
    await f.stop()
  })
  test("does not complete a replay after its socket closes", async () => {
    const started = deferred()
    const finish = deferred()
    const f = fixture(async function* () {
      started.resolve()
      await finish.promise
      yield event(1)
    })
    const socket = new Socket()
    const connecting = f.connect(socket)
    await started.promise
    f.service.webSocketClose(socket, 1000, "Closed", true)
    finish.resolve()
    await connecting
    expect(received(socket)).toEqual([])
    expect(socket.attachment.synced).toBe(false)
    expect(f.signals[0]?.aborted).toBe(true)
    await f.stop()
  })
  test("cleans up after a replay fails and permits a retry", async () => {
    let fail = true
    const f = fixture(async function* () {
      if (fail) throw new Error("Replay failed")
      yield event(1)
    })
    const socket = new Socket()
    await f.connect(socket)
    expect(socket.attachment.sessionId).toBeNull()
    expect(f.signals[0]?.aborted).toBe(true)
    fail = false
    await f.service.webSocketMessage(
      socket,
      JSON.stringify({ type: "hello", sessionId: "session", cursor: null })
    )
    expect(received(socket)).toEqual(["event-1"])
    expect(socket.attachment.synced).toBe(true)
    await f.stop()
  })
})
