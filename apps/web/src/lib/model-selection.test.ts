import { describe, expect, test } from "bun:test"

import { resolveModelSelection, type AvailableModel } from "./model-selection"

const models: AvailableModel[] = [
  {
    providerId: "openai",
    modelId: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    providerName: "OpenAI",
    scope: "organization",
  },
  {
    providerId: "opencode",
    modelId: "nemotron",
    name: "Nemotron",
    providerName: "OpenCode Zen",
    scope: "personal",
  },
]

describe("model selection hierarchy", () => {
  test("conversation selection overrides personal and Organization defaults", () => {
    const result = resolveModelSelection({
      models,
      conversation: { providerId: "openai", modelId: "gpt-5.6-sol" },
      personal: { providerId: "opencode", modelId: "nemotron" },
      organization: { providerId: "opencode", modelId: "nemotron" },
    })

    expect(result.model?.modelId).toBe("gpt-5.6-sol")
    expect(result.source).toBe("conversation")
  })

  test("personal default overrides the Organization default", () => {
    const result = resolveModelSelection({
      models,
      personal: { providerId: "opencode", modelId: "nemotron" },
      organization: { providerId: "openai", modelId: "gpt-5.6-sol" },
    })

    expect(result.model?.modelId).toBe("nemotron")
    expect(result.source).toBe("personal")
  })

  test("falls back with an explanation when the selected model is unavailable", () => {
    const result = resolveModelSelection({
      models,
      conversation: { providerId: "openai", modelId: "retired-model" },
      organization: { providerId: "openai", modelId: "gpt-5.6-sol" },
    })

    expect(result.model?.modelId).toBe("gpt-5.6-sol")
    expect(result.notice).toContain("retired-model is unavailable")
  })

  test("returns no model when no providers are available", () => {
    const result = resolveModelSelection({ models: [] })

    expect(result.model).toBeNull()
    expect(result.source).toBeNull()
  })

  test("uses OpenRouter Auto Router when a saved default is unavailable", () => {
    const result = resolveModelSelection({
      models: [
        {
          providerId: "openrouter",
          modelId: "aion/aion-2.0",
          name: "Aion-2.0",
          providerName: "OpenRouter",
          scope: "organization",
        },
        {
          providerId: "openrouter",
          modelId: "openrouter/auto",
          name: "Auto Router",
          providerName: "OpenRouter",
          scope: "organization",
        },
      ],
      organization: { providerId: "openai", modelId: "gpt-5.6-sol" },
    })

    expect(result.model?.modelId).toBe("openrouter/auto")
    expect(result.source).toBe("fallback")
  })
})
