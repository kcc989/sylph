import { expect, test } from "bun:test"
import { codexContainerResponse } from "./codex-container-response"

const endpoint = "https://chatgpt.com/backend-api/codex/responses"
const blocked = () =>
  new Response("blocked", {
    status: 403,
    headers: { "content-type": "text/html" },
  })

test("replays a blocked Codex request through the Container without consuming the original", async () => {
  const request = new Request(endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "chatgpt-account-id": "test-account",
    },
    body: "request body",
  })
  const upstream = new Response("data: test\n\n", {
    headers: { "content-type": "text/event-stream" },
  })
  const result = await codexContainerResponse(
    request,
    blocked(),
    async (forwarded) => {
      expect(forwarded.url).toBe(endpoint)
      expect(forwarded.headers.get("authorization")).toBe("Bearer test")
      expect(forwarded.headers.get("chatgpt-account-id")).toBe("test-account")
      expect(await forwarded.text()).toBe("request body")
      return upstream
    }
  )
  expect(result).toBe(upstream)
  expect(await request.text()).toBe("request body")
  expect(await result.text()).toBe("data: test\n\n")
})

test("does not replay successful requests, API keys, or JSON authorization failures", async () => {
  for (const [url, response] of [
    [endpoint, new Response("ok")],
    ["https://api.openai.com/v1/responses", blocked()],
    [
      endpoint,
      new Response("{}", {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    ],
  ] as const) {
    const result = await codexContainerResponse(
      new Request(url),
      response,
      async () => {
        throw new Error("Unexpected Container request")
      }
    )
    expect(result).toBe(response)
  }
})
