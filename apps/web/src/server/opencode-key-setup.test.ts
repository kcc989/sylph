import { describe, expect, test } from "bun:test"
import { OpenCodeKeySetupInput, OrganizationId } from "@workspace/domain"

import { discoverOpenCodeKeyModels } from "./opencode-key-setup"

const input = new OpenCodeKeySetupInput({
  organizationId: OrganizationId.make("organization-1"),
  scope: "organization",
  providerId: "cloudflare-workers-ai",
  apiKey: "provider-key",
  configuration: { accountId: "account-1" },
})

const catalog = (modelId: string) => ({
  models: [{ providerId: "cloudflare-workers-ai", modelId, name: modelId }],
  recommendedModelId: modelId,
})

describe("OpenCode key setup", () => {
  test("uses the embedded runtime catalog instead of bootstrap models", async () => {
    const result = await discoverOpenCodeKeyModels(
      {
        connectKey: async (received) => {
          expect(received.providerId).toBe("cloudflare-workers-ai")
          expect(received.apiKey).toBe("provider-key")
          return catalog("@cf/meta/llama-3.3-70b-instruct-fp8-fast")
        },
        evict: async () => undefined,
      },
      input
    )

    expect(result.models[0]?.modelId).toBe(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
    )
  })

  test("preserves the runtime connection failure", async () => {
    await expect(
      discoverOpenCodeKeyModels(
        {
          connectKey: async () => {
            throw new Error("Provider catalog unavailable")
          },
          evict: async () => undefined,
        },
        input
      )
    ).rejects.toThrow("Provider catalog unavailable")
  })

  test("reloads the runtime when replacing an existing credential", async () => {
    const calls: string[] = []
    const result = await discoverOpenCodeKeyModels(
      {
        connectKey: async () => {
          calls.push("connect")
          if (calls.length === 1) {
            throw new Error("Workspace runtime credential store refreshed")
          }
          return catalog("@cf/openai/gpt-oss-120b")
        },
        evict: async () => {
          calls.push("evict")
          throw new Error("Durable Object reset")
        },
      },
      input
    )

    expect(calls).toEqual(["connect", "evict", "connect"])
    expect(result.recommendedModelId).toBe("@cf/openai/gpt-oss-120b")
  })
})
