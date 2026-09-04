import { createServer } from "node:http"
import { once } from "node:events"
import { mkdir } from "node:fs/promises"
import { handleCursorRequest } from "./handler"

await mkdir("/tmp/cursor-workspace", { recursive: true })
const server = createServer(async (incoming, outgoing) => {
  if (incoming.method !== "POST" || incoming.url !== "/") {
    outgoing.writeHead(404).end()
    return
  }
  const controller = new AbortController()
  outgoing.on("close", () => {
    if (!outgoing.writableFinished) controller.abort()
  })
  const timeout = setTimeout(() => controller.abort(), 900_000)
  try {
    let size = 0
    const chunks: Buffer[] = []
    for await (const chunk of incoming) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > 8_388_608) {
        outgoing.writeHead(413).end()
        return
      }
      chunks.push(bytes)
    }
    const response = await handleCursorRequest(
      new Request("http://cursor/", {
        method: "POST",
        body: Buffer.concat(chunks),
        signal: controller.signal,
      })
    )
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) {
      for await (const chunk of response.body) {
        if (outgoing.destroyed) break
        if (!outgoing.write(chunk))
          await once(outgoing, "drain", { signal: controller.signal })
      }
    }
    outgoing.end()
  } catch {
    if (!outgoing.headersSent)
      outgoing.writeHead(502).end("Cursor provider request failed")
    else outgoing.destroy()
  } finally {
    clearTimeout(timeout)
  }
})
server.requestTimeout = 30_000
server.listen(8080, "0.0.0.0")
