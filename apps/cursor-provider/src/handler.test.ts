import { expect, test } from "bun:test"
import { handleCursorRequest } from "./handler"
import { CursorLogin } from "@workspace/domain/cursor-provider"
import { Schema } from "effect"

test("Cursor sign-in generates a fresh PKCE challenge without inference", async () => {
  const request = () =>
    new Request("http://cursor/", {
      method: "POST",
      body: JSON.stringify({ operation: "login" }),
    })
  const first = await Schema.decodeUnknownPromise(CursorLogin)(
    await (await handleCursorRequest(request())).json()
  )
  const second = await Schema.decodeUnknownPromise(CursorLogin)(
    await (await handleCursorRequest(request())).json()
  )
  expect(first.uuid).not.toBe(second.uuid)
  expect(first.verifier).not.toBe(second.verifier)
  const url = new URL(first.url)
  expect(url.origin).toBe("https://cursor.com")
  expect(url.searchParams.get("uuid")).toBe(first.uuid)
  expect(url.searchParams.has("verifier")).toBe(false)
})

test("Expired Cursor sign-in is rejected before contacting Cursor", async () => {
  const response = await handleCursorRequest(
    new Request("http://cursor/", {
      method: "POST",
      body: JSON.stringify({
        operation: "poll",
        login: {
          uuid: "test",
          verifier: "test",
          url: "https://cursor.com",
          expiresAt: 0,
        },
      }),
    })
  )
  expect(response.status).toBe(410)
})
