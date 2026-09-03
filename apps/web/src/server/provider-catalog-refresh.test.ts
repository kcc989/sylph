import { describe, expect, test } from "bun:test"

import {
  decodeOpenCodeCatalog,
  providerModelsFromOpenCodeCatalog,
} from "@/lib/provider-catalog"

describe("provider catalog refresh", () => {
  test("reads current usable models from the OpenCode catalog", async () => {
    const catalog = await decodeOpenCodeCatalog({
      openrouter: {
        models: {
          "x-ai/grok-4.6": {
            id: "x-ai/grok-4.6",
            name: "Grok 4.6",
          },
          duplicate: {
            id: "x-ai/grok-4.6",
            name: "Grok duplicate",
          },
          old: {
            id: "old/model",
            name: "Old model",
            status: "deprecated",
          },
          disabled: {
            id: "disabled/model",
            name: "Disabled model",
            disabled: true,
          },
        },
      },
    })
    const models = providerModelsFromOpenCodeCatalog(catalog, "openrouter")

    expect(models).toEqual([
      {
        providerId: "openrouter",
        modelId: "x-ai/grok-4.6",
        name: "Grok 4.6",
      },
    ])
  })

  test("rejects a catalog without the requested provider", async () => {
    const catalog = await decodeOpenCodeCatalog({})
    expect(() =>
      providerModelsFromOpenCodeCatalog(catalog, "openrouter")
    ).toThrow("OpenCode catalog has no openrouter provider")
  })

  test("does not accept an empty provider catalog", async () => {
    const catalog = await decodeOpenCodeCatalog({
      openrouter: { models: {} },
    })
    expect(() =>
      providerModelsFromOpenCodeCatalog(catalog, "openrouter")
    ).toThrow("OpenCode catalog has no usable openrouter models")
  })
})
