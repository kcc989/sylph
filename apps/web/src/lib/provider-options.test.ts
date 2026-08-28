import { describe, expect, test } from "bun:test"

import {
  findProviderOption,
  providerConfiguration,
  providerDisplayName,
  providerOptions,
} from "./provider-options"

describe("provider options", () => {
  test("offers the supported API key integrations", () => {
    expect(providerOptions.map((provider) => provider.id)).toEqual([
      "openai",
      "openrouter",
      "cloudflare-workers-ai",
      "anthropic",
      "opencode",
    ])
  })

  test("builds the Cloudflare account configuration", () => {
    const provider = findProviderOption("cloudflare-workers-ai")

    if (!provider) throw new Error("Cloudflare provider is missing")
    expect(providerConfiguration(provider, " account-1 ")).toEqual({
      accountId: "account-1",
    })
  })

  test("uses product names in model selectors", () => {
    expect(providerDisplayName("openai")).toBe("OpenAI")
    expect(providerDisplayName("opencode")).toBe("OpenCode Zen / Go")
    expect(providerDisplayName("custom")).toBe("custom")
  })
})
