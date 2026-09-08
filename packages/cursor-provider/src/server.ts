import { createServer } from "node:http"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { handleCursorRequest } from "./handler"

export const cursorServer = (handle = handleCursorRequest) => {
  let active = false
  return createServer(async (incoming, outgoing) => {
    if (incoming.method !== "POST" || incoming.url !== "/") {
      outgoing.writeHead(404).end()
      return
    }
    if (active) {
      outgoing.writeHead(409).end()
      return
    }
    active = true
    const cancellation = new AbortController()
    outgoing.on("close", () => cancellation.abort())
    try {
      const chunks: Uint8Array[] = []
      let bytes = 0
      for await (const chunk of incoming) {
        if (!Buffer.isBuffer(chunk)) throw new Error("Expected request bytes")
        bytes += chunk.byteLength
        if (bytes > 16 * 1024 * 1024) {
          outgoing.writeHead(413).end()
          return
        }
        chunks.push(chunk)
      }
      const response = await handle(
        new Request("http://cursor/", {
          method: "POST",
          body: Buffer.concat(chunks),
          signal: cancellation.signal,
        })
      )
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      if (response.body) await pipeline(Readable.from(response.body), outgoing)
      else outgoing.end()
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end()
    } finally {
      active = false
    }
  })
}
