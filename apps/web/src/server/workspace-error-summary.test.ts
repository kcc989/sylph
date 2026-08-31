import { describe, expect, test } from "bun:test"

import { providerConnectionErrorSummary } from "./workspace-error-summary"

describe("providerConnectionErrorSummary", () => {
  test("keeps actionable nested causes without exposing credentials", () => {
    const cause = new Error(
      "Authorization failed: missing required field accountId; token=cf_example_secret"
    )
    const error = new Error("OpenCode request failed", { cause })

    expect(providerConnectionErrorSummary("cloudflare-workers-ai", error)).toBe(
      "The AI provider could not connect to cloudflare-workers-ai. OpenCode request failed: Authorization failed: missing required field accountId; token=[redacted]"
    )
  })

  test("falls back to reconnect guidance for unknown failures", () => {
    expect(providerConnectionErrorSummary("cloudflare-workers-ai", null)).toBe(
      "The AI provider could not connect to cloudflare-workers-ai. Reconnect it and try again."
    )
  })

  test("preserves the decoded OpenCode request failure", () => {
    const error = {
      _tag: "InvalidRequestError" as const,
      message: "Account ID is required",
    }

    expect(providerConnectionErrorSummary("cloudflare-workers-ai", error)).toBe(
      "The AI provider could not connect to cloudflare-workers-ai. Account ID is required"
    )
  })
})
