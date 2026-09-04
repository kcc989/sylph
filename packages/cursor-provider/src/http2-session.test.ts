import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { connect } from "node:net"

import { ClientSession } from "./http2-session"
import { once } from "node:events"
import { encodeFrame, FrameReader } from "./http2-wire"

const withServer = async (run: (session: ClientSession) => Promise<void>) => {
  const server = spawn(
    "node",
    [new URL("./http2-fixture.mjs", import.meta.url).pathname],
    { stdio: ["ignore", "pipe", "inherit"] }
  )
  const [port] = await once(server.stdout, "data")
  const socket = connect(Number(port.toString().trim()), "127.0.0.1")
  const streams = {
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        socket.on("data", (chunk: Buffer) => controller.enqueue(chunk))
        socket.on("end", () => controller.close())
        socket.on("error", (error) => controller.error(error))
      },
      cancel() {
        socket.destroy()
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        return new Promise<void>((resolve, reject) =>
          socket.write(chunk, (error) => (error ? reject(error) : resolve()))
        )
      },
    }),
  }
  const read = streams.readable.getReader()
  const write = streams.writable.getWriter()
  const session = new ClientSession({
    readable: new ReadableStream<Uint8Array>({
      async pull(controller) {
        const item = await read.read()
        if (item.done) controller.close()
        else controller.enqueue(item.value)
      },
      cancel() {
        socket.destroy()
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write: (chunk) => write.write(chunk),
    }),
    opened: once(socket, "connect"),
    closed: new Promise<void>((resolve) =>
      socket.once("close", () => resolve())
    ),
    close: async () => {
      socket.destroy()
    },
  })
  session.on("error", () => undefined)
  try {
    await once(session, "connect")
    await run(session)
  } finally {
    session.destroy()
    server.kill()
    await once(server, "exit")
  }
}

describe("Worker HTTP/2 transport", () => {
  test("exchanges data before request end and honors small flow-control windows", async () => {
    await withServer(async (session) => {
      const stream = session.request({
        ":method": "POST",
        ":path": "/",
        ":scheme": "http",
        ":authority": "localhost",
      })
      const response = once(stream, "response")
      const chunks: Buffer[] = []
      let received = 0
      let finish: () => void = () => undefined
      const echoed = new Promise<void>((resolve) => {
        finish = resolve
      })
      stream.on("data", (data: Buffer) => {
        chunks.push(data)
        received += data.length
        if (received === 200_000) finish()
      })
      stream.write(Buffer.alloc(200_000, 42))
      const [headers] = await response
      expect(headers[":status"]).toBe(200)
      expect(headers["x-header"]).toBe("compressed-value")
      await echoed
      expect(stream.writableEnded).toBe(false)
      expect(Buffer.concat(chunks).equals(Buffer.alloc(200_000, 42))).toBe(true)
      stream.end()
      await once(stream, "end")
    })
  }, 10_000)

  test("cancellation releases a flow-controlled write", async () => {
    await withServer(async (session) => {
      const stream = session.request({
        ":method": "POST",
        ":path": "/",
        ":scheme": "http",
        ":authority": "localhost",
      })
      stream.on("error", () => undefined)
      stream.write(Buffer.alloc(200_000))
      stream.close()
      await once(stream, "close")
      expect(session.destroyed).toBe(true)
    })
  })

  test("decodes CONTINUATION headers and response trailers", async () => {
    await withServer(async (session) => {
      const stream = session.request({
        ":method": "POST",
        ":path": "/headers",
        ":scheme": "http",
        ":authority": "localhost",
      })
      const response = once(stream, "response")
      const trailers = once(stream, "trailers")
      const ended = once(stream, "end")
      stream.resume()
      stream.end()
      expect((await response)[0]["x-long"].length).toBe(32000)
      expect((await trailers)[0]["x-complete"]).toBe("yes")
      await ended
    })
  })

  test("propagates server resets to the stream", async () => {
    await withServer(async (session) => {
      const stream = session.request({
        ":method": "POST",
        ":path": "/reset",
        ":scheme": "http",
        ":authority": "localhost",
      })
      const error = new Promise<Error>((resolve) =>
        stream.once("error", resolve)
      )
      const closed = new Promise<void>((resolve) =>
        stream.once("close", resolve)
      )
      stream.end()
      expect((await error).message).toContain("reset")
      await closed
      expect(stream.rstCode).toBe(8)
    })
  })

  test("parses fragmented frames and rejects oversized or truncated frames", () => {
    const reader = new FrameReader()
    const frame = encodeFrame(0, 0, 1, Buffer.from("hello"))
    expect(reader.add(frame.subarray(0, 7))).toEqual([])
    expect(reader.add(frame.subarray(7))[0].payload.toString()).toBe("hello")
    reader.finish()
    expect(() =>
      new FrameReader().add(encodeFrame(0, 0, 1, Buffer.alloc(16_385)))
    ).toThrow()
    reader.add(frame.subarray(0, 7))
    expect(() => reader.finish()).toThrow("Truncated")
  })
})
