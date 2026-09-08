import { Schema } from "effect"
import { expect, test } from "bun:test"
import { once } from "node:events"
import { cursorServer } from "./server"

const listen = async (handle: Parameters<typeof cursorServer>[0]) => {
  const server = cursorServer(handle)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || Schema.is(Schema.String)(address))
    throw new Error("Missing server port")
  return { server, url: `http://127.0.0.1:${address.port}/` }
}

test("Cursor HTTP bridge preserves streamed responses and rejects overlapping calls", async () => {
  const { server, url } = await listen(async (request) => {
    expect(await request.json()).toEqual({ operation: "stream" })
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("first\n"))
          request.signal.addEventListener("abort", () => controller.close(), {
            once: true,
          })
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } }
    )
  })
  try {
    expect((await fetch(`${url}other`)).status).toBe(404)
    const cancellation = new AbortController()
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ operation: "stream" }),
      signal: cancellation.signal,
    })
    expect(response.headers.get("content-type")).toBe("application/x-ndjson")
    const reader = response.body?.getReader()
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe(
      "first\n"
    )
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(409)
    cancellation.abort()
    await reader?.cancel().catch(() => undefined)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test("Cursor HTTP bridge rejects oversized bodies before calling the provider", async () => {
  let called = false
  const { server, url } = await listen(async () => {
    called = true
    return new Response()
  })
  try {
    const response = await fetch(url, {
      method: "POST",
      body: "x".repeat(16 * 1024 * 1024 + 1),
    })
    expect(response.status).toBe(413)
    expect(called).toBe(false)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})
