import { Buffer } from "node:buffer"

export const maxFrameSize = 16_384
export const maxHeaderSize = 65_536
export const initialWindowSize = 65_535

export type Http2Frame = {
  type: number
  flags: number
  streamId: number
  payload: Buffer
}

export const encodeFrame = (
  type: number,
  flags: number,
  streamId: number,
  payload: Uint8Array = new Uint8Array()
) => {
  const frame = Buffer.alloc(9 + payload.length)
  frame.writeUIntBE(payload.length, 0, 3)
  frame[3] = type
  frame[4] = flags
  frame.writeUInt32BE(streamId, 5)
  frame.set(payload, 9)
  return frame
}

export const encodeNumber = (value: number) => {
  const payload = Buffer.alloc(4)
  payload.writeUInt32BE(value)
  return payload
}

export class FrameReader {
  #buffer = Buffer.alloc(0)

  add(chunk: Uint8Array): Http2Frame[] {
    this.#buffer = Buffer.concat([this.#buffer, chunk])
    const frames: Http2Frame[] = []
    while (this.#buffer.length >= 9) {
      const length = this.#buffer.readUIntBE(0, 3)
      if (length > maxFrameSize) throw new Error("HTTP/2 frame exceeds limit")
      if (this.#buffer.length < length + 9) break
      frames.push({
        type: this.#buffer[3],
        flags: this.#buffer[4],
        streamId: this.#buffer.readUInt32BE(5) & 0x7fffffff,
        payload: this.#buffer.subarray(9, length + 9),
      })
      this.#buffer = this.#buffer.subarray(length + 9)
    }
    return frames
  }

  finish() {
    if (this.#buffer.length) throw new Error("Truncated HTTP/2 frame")
  }
}

export const unpad = (frame: Http2Frame) => {
  if (!(frame.flags & 8)) return frame.payload
  const padding = frame.payload[0]
  if (padding === undefined || padding >= frame.payload.length)
    throw new Error("Invalid HTTP/2 padding")
  return frame.payload.subarray(1, frame.payload.length - padding)
}
