import { describe, expect, test } from "bun:test"

import {
  ProviderApiKeyValidationError,
  validateProviderApiKey,
} from "./provider-key-validation"

describe("provider API key validation", () => {
  test("validates OpenRouter keys with the provider", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = []

    await validateProviderApiKey(
      { providerId: "openrouter", apiKey: "test-key" },
      async (input, init) => {
        requests.push({
          url: input.toString(),
          authorization: new Headers(init?.headers).get("Authorization"),
        })
        return new Response(null, { status: 200 })
      }
    )

    expect(requests).toEqual([
      {
        url: "https://openrouter.ai/api/v1/auth/key",
        authorization: "Bearer test-key",
      },
    ])
  })

  test("reports rejected OpenRouter keys", async () => {
    await expect(
      validateProviderApiKey(
        { providerId: "openrouter", apiKey: "bad-key" },
        async () => new Response(null, { status: 401 })
      )
    ).rejects.toEqual(new ProviderApiKeyValidationError("rejected"))
  })

  test("reports provider validation outages", async () => {
    await expect(
      validateProviderApiKey(
        { providerId: "openrouter", apiKey: "test-key" },
        () => Promise.reject(new Error("offline"))
      )
    ).rejects.toEqual(new ProviderApiKeyValidationError("unavailable"))
  })

  test("leaves providers without a validation endpoint unchanged", async () => {
    let called = false

    await validateProviderApiKey(
      { providerId: "anthropic", apiKey: "test-key" },
      async () => {
        called = true
        return new Response(null, { status: 200 })
      }
    )

    expect(called).toBe(false)
  })
})
