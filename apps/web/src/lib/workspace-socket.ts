import {
  type WorkspacePresenceUser,
  type WorkspaceRuntimeEvent,
  type WorkspaceSocketClientFrame,
  WorkspaceSocketServerFrame,
} from "@workspace/domain"
import { Schema } from "effect"

const decodeServerFrame = Schema.decodeUnknownPromise(
  WorkspaceSocketServerFrame
)
const decodeSocketText = Schema.decodeUnknownPromise(Schema.String)
const fatalCloseCodeStart = 4000
const fatalCloseCodeEnd = 4099
const maxBufferedFrames = 32

type WorkspaceSocketOptions = {
  workspaceId: string
  sessionId: string
  cursor: number | null
  onConnecting: () => void
  onEvent: (event: WorkspaceRuntimeEvent) => void | Promise<void>
  onSynced: (cursor: number | null) => void
  onPresence: (users: ReadonlyArray<WorkspacePresenceUser>) => void
  onError?: (message: string) => void
}

export const advanceWorkspaceSocketCursor = (
  event: WorkspaceRuntimeEvent,
  cursor: number | null
) => {
  const sequence = event.durable?.seq
  if (sequence !== undefined && sequence <= (cursor ?? -1)) return null
  return sequence ?? cursor
}

export class WorkspaceSocket {
  readonly #options: WorkspaceSocketOptions
  readonly #buffer: string[] = []
  #socket: WebSocket | null = null
  #cursor: number | null
  #attempt = 0
  #retryTimer: number | null = null
  #stopped = false
  #paused = false
  #fatal = false
  #receiveQueue = Promise.resolve()

  constructor(options: WorkspaceSocketOptions) {
    this.#options = options
    this.#cursor = options.cursor
  }

  connect() {
    if (this.#stopped || this.#paused || this.#socket) return
    this.#options.onConnecting()
    const url = new URL(
      `/api/workspaces/${encodeURIComponent(this.#options.workspaceId)}/socket`,
      window.location.href
    )
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const socket = new WebSocket(url)
    this.#socket = socket
    socket.addEventListener("open", () => {
      this.#attempt = 0
      this.#sendNow(
        JSON.stringify({
          type: "hello",
          sessionId: this.#options.sessionId,
          cursor: this.#cursor,
        })
      )
      for (const frame of this.#buffer.splice(0)) this.#sendNow(frame)
    })
    socket.addEventListener("message", (message) => {
      this.#receiveQueue = this.#receiveQueue
        .then(() => this.#receive(message.data))
        .catch(() => undefined)
    })
    socket.addEventListener("close", (event) => {
      if (this.#socket === socket) this.#socket = null
      if (
        event.code >= fatalCloseCodeStart &&
        event.code <= fatalCloseCodeEnd
      ) {
        this.#fatal = true
      }
      this.#scheduleReconnect()
    })
    socket.addEventListener("error", () => socket.close())
  }

  send(frame: WorkspaceSocketClientFrame) {
    const encoded = JSON.stringify(frame)
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#sendNow(encoded)
      return
    }
    if (this.#buffer.length === maxBufferedFrames) this.#buffer.shift()
    this.#buffer.push(encoded)
  }

  pause() {
    this.#paused = true
    if (this.#retryTimer !== null) window.clearTimeout(this.#retryTimer)
    this.#retryTimer = null
    this.#socket?.close(1000, "Page hidden")
    this.#socket = null
  }

  resume() {
    this.#paused = false
    if (!this.#stopped && !this.#fatal) this.connect()
  }

  close() {
    this.#stopped = true
    if (this.#retryTimer !== null) window.clearTimeout(this.#retryTimer)
    this.#retryTimer = null
    this.#socket?.close(1000, "Workspace closed")
    this.#socket = null
  }

  #sendNow(frame: string) {
    this.#socket?.send(frame)
  }

  async #receive(value: string | ArrayBuffer | Blob) {
    try {
      const text = await decodeSocketText(value)
      const frame = await decodeServerFrame(JSON.parse(text))
      if (frame.type === "event") {
        const cursor = advanceWorkspaceSocketCursor(frame.event, this.#cursor)
        if (cursor === null && frame.event.durable) return
        this.#cursor = cursor
        await this.#options.onEvent(frame.event)
        return
      }
      if (frame.type === "synced") {
        this.#cursor = frame.cursor
        this.#options.onSynced(frame.cursor)
        return
      }
      if (frame.type === "presence") {
        this.#options.onPresence(frame.users)
        return
      }
      if (frame.type === "error") {
        this.#fatal ||= frame.fatal
        this.#options.onError?.(frame.message)
      }
    } catch {
      this.#options.onError?.("Workspace sent an invalid socket frame")
    }
  }

  #scheduleReconnect() {
    if (
      this.#stopped ||
      this.#paused ||
      this.#fatal ||
      this.#retryTimer !== null
    )
      return
    const maximum = Math.min(30_000, 1_000 * 2 ** this.#attempt)
    const delay = maximum * (0.5 + Math.random() * 0.5)
    this.#attempt += 1
    this.#retryTimer = window.setTimeout(() => {
      this.#retryTimer = null
      this.connect()
    }, delay)
  }
}
