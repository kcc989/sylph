import {
  WorkspaceRuntimeEvent,
  WorkspaceSocketClientFrame,
  type WorkspaceSocketServerFrame,
  type WorkspaceSocketAttachment,
} from "@workspace/domain"
import { Context, Layer, Schema } from "effect"
import {
  decodeWorkspaceSocketAttachment,
  encodeWorkspaceSocketFrame,
  shouldForwardWorkspaceEvent,
  workspaceEventCursor,
  workspaceEventFollowsCursor,
  workspaceEventSessionId,
  workspacePresence,
} from "./workspace-socket-server"

export type WorkspaceSocket = Pick<
  WebSocket,
  | "readyState"
  | "send"
  | "close"
  | "serializeAttachment"
  | "deserializeAttachment"
>
export type WorkspaceSocketHost = {
  getWebSockets: (tag?: string) => WorkspaceSocket[]
  waitUntil: (promise: Promise<void>) => void
}
export type WorkspaceSocketState = {
  sessionId: string | null
  archivedAt: number | null
}
export type WorkspaceSocketSource = {
  sessions: {
    log: (input: {
      sessionID: string
      after?: number
      follow: boolean
    }) => AsyncIterable<{ type: string; seq?: number }>
  }
  events: {
    subscribe: (input: {
      signal: AbortSignal
    }) => AsyncIterable<{ type: string }>
  }
  permission: {
    request: {
      list: (input: {
        location: { directory: string }
      }) => Promise<{ data: ReadonlyArray<{ id: string; sessionID: string }> }>
    }
  }
}

const decodeWorkspaceRuntimeEventPromise = Schema.decodeUnknownPromise(
  WorkspaceRuntimeEvent
)
const decodeWorkspaceSocketClientFramePromise = Schema.decodeUnknownPromise(
  WorkspaceSocketClientFrame
)
const decodeSocketTextPromise = Schema.decodeUnknownPromise(Schema.String)

class WorkspaceSocketSession {
  #socketSubscriber: Promise<void> | null = null
  #socketSubscriberAbort: AbortController | null = null
  readonly #socketPendingEvents = new WeakMap<
    WorkspaceSocket,
    WorkspaceRuntimeEvent[]
  >()
  constructor(
    private readonly host: WorkspaceSocketHost,
    private readonly opencode: Promise<WorkspaceSocketSource>,
    private readonly state: () => WorkspaceSocketState | undefined,
    private readonly recordCursor: (cursor: number) => void
  ) {}

  broadcast(event: WorkspaceRuntimeEvent) {
    for (const socket of this.#initializedSockets())
      this.#send(socket, { type: "event", event })
  }

  disconnectUser(userId: string) {
    for (const socket of this.host.getWebSockets(`user:${userId}`)) {
      this.#sendError(
        socket,
        "access_revoked",
        "Workspace access was revoked",
        true
      )
    }
    this.#afterClose()
  }

  archive() {
    for (const socket of this.#initializedSockets()) {
      this.#sendError(
        socket,
        "workspace_archived",
        "Workspace was archived",
        true
      )
    }
    this.stop()
  }

  stop() {
    this.#socketSubscriberAbort?.abort()
  }

  #afterClose() {
    this.#broadcastPresence()
    if (this.#initializedSockets().length === 0) this.stop()
  }

  async webSocketMessage(
    socket: WorkspaceSocket,
    message: string | ArrayBuffer
  ) {
    try {
      const text = await decodeSocketTextPromise(message)
      if (new TextEncoder().encode(text).byteLength > 16 * 1024) {
        this.#sendError(
          socket,
          "frame_too_large",
          "Workspace socket frame exceeds the inbound limit",
          true
        )
        return
      }
      const frame = await decodeWorkspaceSocketClientFramePromise(
        JSON.parse(text)
      )
      if (frame.type !== "hello") {
        this.#sendError(
          socket,
          "terminal_unavailable",
          "Workspace terminals require a separate sandbox connection",
          false
        )
        return
      }
      await this.#hello(socket, frame.sessionId, frame.cursor)
    } catch {
      this.#sendError(
        socket,
        "invalid_frame",
        "Workspace socket frame is invalid",
        false
      )
    }
  }

  webSocketClose(
    socket: WorkspaceSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ) {
    socket.close(code, reason)
    this.#socketPendingEvents.delete(socket)
    this.#afterClose()
  }

  webSocketError(socket: WorkspaceSocket, cause: unknown) {
    console.error("Workspace socket failed", cause)
    socket.close(1011, "Workspace socket failed")
    this.#socketPendingEvents.delete(socket)
    this.#afterClose()
  }

  #attachment(socket: WorkspaceSocket): WorkspaceSocketAttachment {
    return decodeWorkspaceSocketAttachment(socket.deserializeAttachment())
  }

  #initializedSockets() {
    return this.host
      .getWebSockets()
      .filter(
        (socket) =>
          socket.readyState === 1 && Boolean(this.#attachment(socket).sessionId)
      )
  }

  #send(socket: WorkspaceSocket, frame: WorkspaceSocketServerFrame) {
    const encoded = encodeWorkspaceSocketFrame(frame)
    try {
      socket.send(encoded)
    } catch {
      return false
    }
    return true
  }

  #sendError(
    socket: WorkspaceSocket,
    code: string,
    message: string,
    fatal: boolean
  ) {
    this.#send(socket, { type: "error", code, message, fatal })
    if (fatal) {
      socket.close(4001, message.slice(0, 120))
      this.#socketPendingEvents.delete(socket)
      this.#afterClose()
    }
  }

  #broadcastPresence() {
    const sockets = this.#initializedSockets()
    const users = workspacePresence(
      sockets.map((socket) => this.#attachment(socket))
    )
    for (const socket of sockets) {
      this.#send(socket, { type: "presence", users })
    }
  }

  async #hello(
    socket: WorkspaceSocket,
    sessionId: string,
    cursor: number | null
  ) {
    const state = this.state()
    if (!state?.sessionId) {
      this.#sendError(
        socket,
        "not_initialized",
        "OpenCode session is not initialized",
        true
      )
      return
    }
    if (state.archivedAt !== null) {
      this.#sendError(
        socket,
        "workspace_archived",
        "Archived Workspaces do not accept live connections",
        true
      )
      return
    }
    if (sessionId !== state.sessionId) {
      this.#sendError(
        socket,
        "session_mismatch",
        "Workspace session does not match",
        true
      )
      return
    }

    const attachment = this.#attachment(socket)
    socket.serializeAttachment({
      ...attachment,
      sessionId,
      cursor,
      synced: false,
    } satisfies WorkspaceSocketAttachment)
    const pendingEvents: WorkspaceRuntimeEvent[] = []
    this.#socketPendingEvents.set(socket, pendingEvents)
    const current = () =>
      socket.readyState === 1 &&
      this.#socketPendingEvents.get(socket) === pendingEvents
    let synced = false
    try {
      const opencode = await this.opencode
      if (!current()) return
      this.#ensureSocketSubscriber(opencode)

      const pending = await opencode.permission.request.list({
        location: { directory: "/workspace" },
      })
      if (!current()) return
      for (const request of pending.data) {
        if (request.sessionID !== sessionId) continue
        this.#send(socket, {
          type: "event",
          event: new WorkspaceRuntimeEvent({
            id: `pending-${request.id}`,
            created: Date.now(),
            type: "permission.asked",
            data: request,
          }),
        })
      }

      let appliedCursor = cursor
      for await (const item of opencode.sessions.log({
        sessionID: sessionId,
        after: cursor ?? undefined,
        follow: false,
      })) {
        if (!current()) return
        if (item.type === "log.synced") {
          appliedCursor = Math.max(appliedCursor ?? 0, item.seq ?? 0) || null
          continue
        }
        if (!shouldForwardWorkspaceEvent(item)) continue
        const event = await decodeWorkspaceRuntimeEventPromise(item)
        if (!current()) return
        if (!workspaceEventFollowsCursor(event, appliedCursor)) continue
        this.#send(socket, { type: "event", event })
        appliedCursor = workspaceEventCursor(event) ?? appliedCursor
      }

      if (!current()) return
      const queued = pendingEvents
      for (const event of queued) {
        if (!current()) return
        if (!workspaceEventFollowsCursor(event, appliedCursor)) continue
        this.#send(socket, { type: "event", event })
        appliedCursor = workspaceEventCursor(event) ?? appliedCursor
      }
      synced = true
      this.#socketPendingEvents.delete(socket)
      socket.serializeAttachment({
        ...this.#attachment(socket),
        cursor: appliedCursor,
        synced: true,
      } satisfies WorkspaceSocketAttachment)
      this.#send(socket, { type: "synced", cursor: appliedCursor })
      this.#broadcastPresence()
    } finally {
      if (!synced && this.#socketPendingEvents.get(socket) === pendingEvents) {
        this.#socketPendingEvents.delete(socket)
        socket.serializeAttachment({
          ...this.#attachment(socket),
          sessionId: null,
          synced: false,
        } satisfies WorkspaceSocketAttachment)
        this.#afterClose()
      }
    }
  }

  #ensureSocketSubscriber(opencode: WorkspaceSocketSource) {
    if (this.#socketSubscriber && !this.#socketSubscriberAbort?.signal.aborted)
      return
    const abort = new AbortController()
    this.#socketSubscriberAbort = abort
    this.#socketSubscriber = this.#consumeSocketEvents(opencode, abort.signal)
      .catch((error) => {
        if (!abort.signal.aborted) {
          console.error("Workspace event subscriber failed", error)
          for (const socket of this.#initializedSockets()) {
            this.#sendError(
              socket,
              "event_subscriber_failed",
              "Workspace event delivery stopped",
              false
            )
          }
        }
      })
      .finally(() => {
        if (this.#socketSubscriberAbort === abort) {
          this.#socketSubscriber = null
          this.#socketSubscriberAbort = null
        }
      })
    this.host.waitUntil(this.#socketSubscriber)
  }

  async #consumeSocketEvents(
    opencode: WorkspaceSocketSource,
    signal: AbortSignal
  ) {
    for await (const raw of opencode.events.subscribe({ signal })) {
      if (!shouldForwardWorkspaceEvent(raw)) continue
      const event = await decodeWorkspaceRuntimeEventPromise(raw)
      const cursor = workspaceEventCursor(event)
      if (cursor !== null) {
        this.recordCursor(cursor)
      }
      for (const socket of this.#initializedSockets()) {
        const attachment = this.#attachment(socket)
        const eventSessionId = workspaceEventSessionId(event)
        if (eventSessionId && eventSessionId !== attachment.sessionId) continue
        if (!attachment.synced) {
          this.#socketPendingEvents.get(socket)?.push(event)
          continue
        }
        if (!workspaceEventFollowsCursor(event, attachment.cursor)) continue
        this.#send(socket, { type: "event", event })
        socket.serializeAttachment({
          ...attachment,
          cursor: cursor ?? attachment.cursor,
        } satisfies WorkspaceSocketAttachment)
      }
    }
  }
}

export class WorkspaceSockets extends Context.Service<
  WorkspaceSockets,
  Pick<
    WorkspaceSocketSession,
    | "webSocketMessage"
    | "webSocketClose"
    | "webSocketError"
    | "broadcast"
    | "disconnectUser"
    | "archive"
    | "stop"
  >
>()("@sylph/WorkspaceSockets") {
  static layer(
    host: WorkspaceSocketHost,
    source: Promise<WorkspaceSocketSource>,
    state: () => WorkspaceSocketState | undefined,
    recordCursor: (cursor: number) => void
  ) {
    return Layer.sync(
      WorkspaceSockets,
      () => new WorkspaceSocketSession(host, source, state, recordCursor)
    )
  }
}
