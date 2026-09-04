import { describe, expect, test } from "bun:test"
import { openRouterErrorResponse } from "./openrouter-response"

describe("OpenRouter provider errors", () => {
  test("preserves the upstream rejection detail and response status", async () => {
    const result = await openRouterErrorResponse(
      Response.json(
        {
          error: {
            message: "Provider returned error",
            code: 400,
            metadata: {
              raw: JSON.stringify({
                error: {
                  message: "Invalid tool schema",
                  type: "invalid_request_error",
                },
              }),
            },
          },
        },
        { status: 400 }
      )
    )
    expect(result.status).toBe(400)
    expect(await result.json()).toMatchObject({
      error: { message: "Provider returned error: Invalid tool schema" },
    })
  })

  test("leaves successful streams and unknown error bodies unchanged", async () => {
    const stream = new Response("data: hello", {
      headers: { "content-type": "text/event-stream" },
    })
    expect(await openRouterErrorResponse(stream)).toBe(stream)
    const failure = new Response("Bad gateway", { status: 502 })
    expect(await openRouterErrorResponse(failure)).toBe(failure)
    expect(await failure.text()).toBe("Bad gateway")
  })

  test("redacts credentials from the upstream message", async () => {
    const result = await openRouterErrorResponse(
      Response.json(
        {
          error: {
            message: "Provider returned error",
            metadata: {
              raw: {
                error: {
                  message: "Rejected api_key=secret-value and sk-private-key",
                },
              },
            },
          },
        },
        { status: 400 }
      )
    )
    expect(await result.json()).toMatchObject({
      error: {
        message:
          "Provider returned error: Rejected api_key=[redacted] and [redacted]",
      },
    })
  })
})

test("preserves xAI's string error field", async () => {
  const response = Response.json(
    {
      error: {
        message: "Provider returned error",
        metadata: {
          raw: JSON.stringify({
            code: "invalid_argument",
            error: "tool parameter root must be an object type",
          }),
        },
      },
    },
    { status: 400 }
  )
  const result = await openRouterErrorResponse(response)
  expect(await result.json()).toMatchObject({
    error: {
      message:
        "Provider returned error: tool parameter root must be an object type",
    },
  })
})
