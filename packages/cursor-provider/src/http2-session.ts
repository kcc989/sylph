import "./hpack-types"
import { Schema } from "effect"
import { Buffer } from "node:buffer"
import { EventEmitter } from "node:events"
import { Duplex } from "node:stream"
import { compressor, decompressor } from "hpack.js"
import {
  encodeFrame,
  encodeNumber,
  FrameReader,
  initialWindowSize,
  maxFrameSize,
  maxHeaderSize,
  unpad,
  type Http2Frame,
} from "./http2-wire"

export type TransportSocket = {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  opened: Promise<unknown>
  closed: Promise<unknown>
  close(): Promise<void>
}

const asError = (cause: unknown) =>
  cause instanceof Error
    ? cause
    : new Error("HTTP/2 transport failed", { cause })

const decodeHeader = Schema.decodeUnknownSync(
  Schema.Struct({ name: Schema.String, value: Schema.String })
)

class ClientStream extends Duplex {
  rstCode = 0
  headersReceived = false
  remoteEnded = false
  #session: ClientSession

  constructor(session: ClientSession) {
    super({ autoDestroy: false })
    this.#session = session
  }

  override _read() {
    this.#session.releaseReceiveWindow()
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    this.#session.sendData(chunk).then(
      () => callback(),
      (cause: unknown) => callback(asError(cause))
    )
  }

  override _final(callback: (error?: Error | null) => void) {
    this.#session.sendFrame(0, 1, 1).then(
      () => callback(),
      (cause: unknown) => callback(asError(cause))
    )
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void
  ) {
    this.#session.destroy()
    callback(error)
  }

  close() {
    this.destroy()
  }
}

export class ClientSession extends EventEmitter {
  destroyed = false
  closed = false
  #authority: string
  #socket: TransportSocket
  #writer: WritableStreamDefaultWriter<Uint8Array>
  #reader: ReadableStreamDefaultReader<Uint8Array>
  #frameReader = new FrameReader()
  #stream: ClientStream | undefined
  #writes: Promise<void> = Promise.resolve()
  #connectionWindow = initialWindowSize
  #streamWindow = initialWindowSize
  #initialStreamWindow = initialWindowSize
  #receiveWindow = initialWindowSize
  #uncredited = 0
  #windowWaiters = new Set<() => void>()
  #headerFragments: Buffer[] = []
  #headerBytes = 0
  #headerEnd = false
  #continuation = false
  #ready = false
  #decoder = decompressor.create({ table: { maxSize: 4096 } })
  #pings = new Map<string, (error: Error | null) => void>()
  #failure: Error | undefined
  #connectTimer: ReturnType<typeof setTimeout>

  constructor(socket: TransportSocket, authority = "localhost") {
    super()
    this.#authority = authority
    this.#socket = socket
    this.#writer = socket.writable.getWriter()
    this.#reader = socket.readable.getReader()
    this.#decoder.on("error", (error: Error) => this.#fail(error))
    this.#connectTimer = setTimeout(
      () => this.#fail(new Error("HTTP/2 handshake timed out")),
      10_000
    )
    socket.closed.catch((cause: unknown) => this.#fail(asError(cause)))
    this.#run().catch((cause: unknown) => this.#fail(asError(cause)))
  }

  #wake() {
    for (const wake of this.#windowWaiters) wake()
    this.#windowWaiters.clear()
  }

  #fail(error: Error) {
    if (this.destroyed) return
    this.#failure = error
    this.#stream?.destroy(error)
    this.emit("error", error)
    this.destroy()
  }

  #checkOpen() {
    if (this.destroyed || this.#failure)
      throw this.#failure ?? new Error("HTTP/2 connection closed")
  }

  async #run() {
    await this.#socket.opened
    await this.#writer.write(Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"))
    await this.sendFrame(4, 0, 0, Buffer.from([0, 2, 0, 0, 0, 0]))
    while (!this.destroyed) {
      const chunk = await this.#reader.read()
      if (chunk.done) {
        this.#frameReader.finish()
        if (!this.#stream?.remoteEnded)
          throw new Error("HTTP/2 connection ended before response completion")
        this.destroy()
        break
      }
      for (const frame of this.#frameReader.add(chunk.value))
        await this.#handle(frame)
    }
  }

  sendFrame(type: number, flags: number, id: number, data?: Uint8Array) {
    const next = this.#writes.then(async () => {
      this.#checkOpen()
      await this.#writer.write(encodeFrame(type, flags, id, data))
    })
    this.#writes = next.catch((cause: unknown) => this.#fail(asError(cause)))
    return next
  }

  request(headers: Record<string, string>, _options?: { endStream?: boolean }) {
    this.#checkOpen()
    if (!this.#ready || this.closed || this.#stream)
      throw new Error("HTTP/2 connection cannot accept another stream")
    const stream = new ClientStream(this)
    this.#stream = stream
    const encoder = compressor.create({ table: { maxSize: 0 } })
    encoder.write(
      Object.entries({
        ":scheme": "https",
        ":authority": this.#authority,
        ...headers,
      })
        .sort(
          ([a], [b]) => Number(b.startsWith(":")) - Number(a.startsWith(":"))
        )
        .map(([name, value]) => ({
          name,
          value,
          neverIndex: true,
        }))
    )
    const block: unknown = encoder.read()
    if (!(block instanceof Uint8Array) || block.length > maxHeaderSize)
      throw new Error("Invalid HTTP/2 request headers")
    for (let offset = 0; offset < block.length; offset += maxFrameSize) {
      const end = Math.min(offset + maxFrameSize, block.length)
      this.sendFrame(
        offset === 0 ? 1 : 9,
        end === block.length ? 4 : 0,
        1,
        block.subarray(offset, end)
      ).catch((cause: unknown) => this.#fail(asError(cause)))
    }
    return stream
  }

  async sendData(data: Buffer) {
    let offset = 0
    while (offset < data.length) {
      this.#checkOpen()
      if (this.#stream?.destroyed) throw new Error("HTTP/2 stream closed")
      const length = Math.min(
        data.length - offset,
        maxFrameSize,
        this.#connectionWindow,
        this.#streamWindow
      )
      if (length <= 0) {
        await new Promise<void>((resolve) => this.#windowWaiters.add(resolve))
        continue
      }
      this.#connectionWindow -= length
      this.#streamWindow -= length
      await this.sendFrame(0, 0, 1, data.subarray(offset, offset + length))
      offset += length
    }
  }

  releaseReceiveWindow() {
    if (!this.#uncredited || this.destroyed) return
    const credit = this.#uncredited
    this.#uncredited = 0
    this.#receiveWindow += credit
    Promise.all([
      this.sendFrame(8, 0, 0, encodeNumber(credit)),
      this.sendFrame(8, 0, 1, encodeNumber(credit)),
    ]).catch((cause: unknown) => this.#fail(asError(cause)))
  }

  async #handle(frame: Http2Frame) {
    if (this.#continuation && (frame.type !== 9 || frame.streamId !== 1))
      throw new Error("Interrupted HTTP/2 header block")
    if (!this.#ready && (frame.type !== 4 || frame.flags & 1))
      throw new Error("Server did not begin with HTTP/2 SETTINGS")
    if (frame.type === 4) {
      if (
        frame.streamId ||
        frame.payload.length % 6 ||
        (frame.flags & 1 && frame.payload.length)
      )
        throw new Error("Invalid HTTP/2 SETTINGS")
      if (frame.flags & 1) return
      for (let offset = 0; offset < frame.payload.length; offset += 6) {
        const id = new DataView(
          frame.payload.buffer,
          frame.payload.byteOffset,
          frame.payload.byteLength
        ).getUint16(offset)
        const value = new DataView(
          frame.payload.buffer,
          frame.payload.byteOffset,
          frame.payload.byteLength
        ).getUint32(offset + 2)
        if (id === 2 && value > 1)
          throw new Error("Invalid HTTP/2 push setting")
        if (id === 4) {
          if (value > 0x7fffffff) throw new Error("Invalid HTTP/2 window size")
          this.#streamWindow += value - this.#initialStreamWindow
          this.#initialStreamWindow = value
          if (this.#streamWindow > 0x7fffffff)
            throw new Error("HTTP/2 window overflow")
        }
        if (id === 5 && (value < maxFrameSize || value > 0xffffff))
          throw new Error("Invalid HTTP/2 maximum frame size")
      }
      await this.sendFrame(4, 1, 0)
      this.#wake()
      if (!this.#ready) {
        this.#ready = true
        clearTimeout(this.#connectTimer)
        this.emit("connect")
      }
      return
    }
    if (frame.type === 6) {
      if (frame.streamId || frame.payload.length !== 8)
        throw new Error("Invalid HTTP/2 PING")
      if (frame.flags & 1) {
        const key = Buffer.from(frame.payload).toString("hex")
        this.#pings.get(key)?.(null)
        this.#pings.delete(key)
      } else await this.sendFrame(6, 1, 0, frame.payload)
      return
    }
    if (frame.type === 7) {
      if (frame.streamId || frame.payload.length < 8)
        throw new Error("Invalid HTTP/2 GOAWAY")
      this.closed = true
      const last =
        new DataView(
          frame.payload.buffer,
          frame.payload.byteOffset,
          frame.payload.byteLength
        ).getUint32(0) & 0x7fffffff
      const code = new DataView(
        frame.payload.buffer,
        frame.payload.byteOffset,
        frame.payload.byteLength
      ).getUint32(4)
      this.emit("goaway", code, last)
      if (code || last < 1)
        throw new Error("HTTP/2 server closed the connection")
      return
    }
    if (frame.type === 8) {
      if (frame.payload.length !== 4 || frame.streamId > 1)
        throw new Error("Invalid HTTP/2 WINDOW_UPDATE")
      const increment =
        new DataView(
          frame.payload.buffer,
          frame.payload.byteOffset,
          frame.payload.byteLength
        ).getUint32(0) & 0x7fffffff
      if (!increment) throw new Error("Invalid HTTP/2 window increment")
      if (frame.streamId) this.#streamWindow += increment
      else this.#connectionWindow += increment
      if (
        this.#streamWindow > 0x7fffffff ||
        this.#connectionWindow > 0x7fffffff
      )
        throw new Error("HTTP/2 window overflow")
      this.#wake()
      return
    }
    if (frame.type === 5) throw new Error("HTTP/2 server push is disabled")
    if (![0, 1, 2, 3, 9].includes(frame.type)) return
    if (frame.streamId !== 1 || !this.#stream)
      throw new Error("Unexpected HTTP/2 stream")
    const stream = this.#stream
    if (frame.type === 3) {
      if (frame.payload.length !== 4)
        throw new Error("Invalid HTTP/2 RST_STREAM")
      stream.rstCode = new DataView(
        frame.payload.buffer,
        frame.payload.byteOffset,
        frame.payload.byteLength
      ).getUint32(0)
      throw new Error(`HTTP/2 stream reset (${stream.rstCode})`)
    }
    if (frame.type === 2) {
      if (frame.payload.length !== 5) throw new Error("Invalid HTTP/2 PRIORITY")
      return
    }
    if (stream.remoteEnded) throw new Error("HTTP/2 data after response end")
    if (frame.type === 1 || frame.type === 9) {
      if (frame.type === 9 && !this.#continuation)
        throw new Error("Unexpected HTTP/2 CONTINUATION")
      let payload = frame.type === 1 ? unpad(frame) : frame.payload
      if (frame.type === 1 && frame.flags & 32) {
        if (payload.length < 5)
          throw new Error("Invalid HTTP/2 priority headers")
        payload = payload.subarray(5)
      }
      this.#headerBytes += payload.length
      if (this.#headerBytes > maxHeaderSize)
        throw new Error("HTTP/2 headers exceed limit")
      this.#headerFragments.push(payload)
      if (frame.type === 1) this.#headerEnd = Boolean(frame.flags & 1)
      this.#continuation = !(frame.flags & 4)
      if (this.#continuation) return
      const headers: Record<string, string> = {}
      this.#decoder.write(Buffer.concat(this.#headerFragments))
      this.#decoder.execute()
      if (this.#failure) throw this.#failure
      let size = 0
      for (;;) {
        const header: unknown = this.#decoder.read()
        if (header === null) break
        const decoded = decodeHeader(header)
        size += decoded.name.length + decoded.value.length
        if (size > maxHeaderSize)
          throw new Error("HTTP/2 decoded headers exceed limit")
        headers[decoded.name] = decoded.value
      }
      this.#headerFragments = []
      this.#headerBytes = 0
      if (!stream.headersReceived) {
        const status = Number(headers[":status"])
        if (!Number.isInteger(status) || status < 100 || status > 599)
          throw new Error("Invalid HTTP/2 response status")
        if (status < 200) return
        stream.headersReceived = true
        stream.emit("response", { ...headers, ":status": status })
      } else stream.emit("trailers", headers)
      if (this.#headerEnd) this.#endResponse()
      return
    }
    if (!stream.headersReceived)
      throw new Error("HTTP/2 DATA before response headers")
    this.#receiveWindow -= frame.payload.length
    if (this.#receiveWindow < 0)
      throw new Error("HTTP/2 receive window exceeded")
    this.#uncredited += frame.payload.length
    const accepted = stream.push(unpad(frame))
    if (accepted) this.releaseReceiveWindow()
    if (frame.flags & 1) this.#endResponse()
  }

  #endResponse() {
    if (!this.#stream) return
    this.#stream.remoteEnded = true
    this.#stream.push(null)
  }

  ping(callback: (error: Error | null) => void) {
    if (this.destroyed || this.closed) return false
    const payload = crypto.getRandomValues(new Uint8Array(8))
    this.#pings.set(Buffer.from(payload).toString("hex"), callback)
    this.sendFrame(6, 0, 0, payload).catch((cause: unknown) =>
      this.#fail(asError(cause))
    )
    return true
  }

  close() {
    this.destroy()
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.closed = true
    clearTimeout(this.#connectTimer)
    this.#wake()
    for (const callback of this.#pings.values())
      callback(new Error("HTTP/2 connection closed"))
    this.#pings.clear()
    this.#stream?.destroy(this.#failure)
    this.#reader.cancel().catch(() => undefined)
    this.#socket.close().catch(() => undefined)
    this.#decoder.destroy()
    this.emit("close")
  }
}
