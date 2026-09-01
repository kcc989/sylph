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

describe("OpenCode key setup", () => {
  test("uses the embedded runtime catalog instead of bootstrap models", async () => {
    const result = await discoverOpenCodeKeyModels(
      {
        fetch: async (_url, request) => {
          expect(request?.method).toBe("POST")
          return Response.json({
            models: [
              {
                providerId: "cloudflare-workers-ai",
                modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
                name: "Llama 3.3 70B Instruct fp8 Fast",
              },
            ],
            recommendedModelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          })
        },
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
          fetch: async () =>
            new Response("Provider catalog unavailable", { status: 502 }),
        },
        input
      )
    ).rejects.toThrow("Provider catalog unavailable")
  })

  test("reloads the runtime when replacing an existing credential", async () => {
    const requests: string[] = []
    let connectCount = 0
    const result = await discoverOpenCodeKeyModels(
      {
        fetch: async (url) => {
          requests.push(url)
          if (url.endsWith("/evict")) return new Response(null, { status: 204 })
          connectCount += 1
          if (connectCount === 1) {
            return new Response(
              "Workspace runtime credential store refreshed",
              { status: 409 }
            )
          }
          return Response.json({
            models: [
              {
                providerId: "cloudflare-workers-ai",
                modelId: "@cf/openai/gpt-oss-120b",
                name: "GPT OSS 120B",
              },
            ],
            recommendedModelId: "@cf/openai/gpt-oss-120b",
          })
        },
      },
      input
    )

    expect(requests).toEqual([
      "https://workspace/connect/key",
      "https://workspace/evict",
      "https://workspace/connect/key",
    ])
    expect(result.recommendedModelId).toBe("@cf/openai/gpt-oss-120b")
  })
})
