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
})
