import { describe, expect, test } from "bun:test"

import {
  bootstrapProviderModels,
  normalizeProviderModels,
  selectInitialProviderModel,
} from "./provider-models"

describe("provider model normalization", () => {
  test("provides OpenRouter bootstrap models without provider discovery", () => {
    expect(bootstrapProviderModels("openrouter")).toEqual([
      {
        providerId: "openrouter",
        modelId: "openrouter/auto",
        name: "Auto Router",
      },
      {
        providerId: "openrouter",
        modelId: "deepseek/deepseek-v4-flash-0731",
        name: "DeepSeek V4 Flash 0731",
      },
    ])
  })

  test("provides a tool-capable Workers AI bootstrap model", () => {
    expect(bootstrapProviderModels("cloudflare-workers-ai")).toEqual([
      {
        providerId: "cloudflare-workers-ai",
        modelId: "@cf/moonshotai/kimi-k2.7-code",
        name: "Kimi K2.7 Code",
      },
    ])
  })

  test("keeps one model for each provider model ID", () => {
    const models = normalizeProviderModels(
      [
        { providerId: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
        {
          providerId: "openai",
          modelId: "gpt-5.4",
          name: "GPT-5.4 Fast",
        },
        {
          providerId: "openai",
          modelId: "gpt-5.6-sol",
          name: "GPT-5.6 Sol",
        },
      ],
      "openai"
    )

    expect(models).toEqual([
      { providerId: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
      {
        providerId: "openai",
        modelId: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
      },
    ])
  })

  test("excludes models reported for another provider", () => {
    const models = normalizeProviderModels(
      [
        { providerId: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
        { providerId: "anthropic", modelId: "opus", name: "Opus" },
      ],
      "openai"
    )

    expect(models).toEqual([
      { providerId: "openai", modelId: "gpt-5.4", name: "GPT-5.4" },
    ])
  })

  test("selects GPT-5.6 Sol as the initial OpenAI default", () => {
    const model = selectInitialProviderModel(
      [
        {
          providerId: "openai",
          modelId: "gpt-5.3-codex-spark",
          name: "GPT-5.3 Codex Spark",
        },
        {
          providerId: "openai",
          modelId: "gpt-5.6-sol",
          name: "GPT-5.6 Sol",
        },
      ],
      "openai",
      "gpt-5.3-codex-spark"
    )

    expect(model?.modelId).toBe("gpt-5.6-sol")
  })

  test("uses another provider's recommendation when available", () => {
    const model = selectInitialProviderModel(
      [
        { providerId: "anthropic", modelId: "sonnet", name: "Sonnet" },
        { providerId: "anthropic", modelId: "opus", name: "Opus" },
      ],
      "anthropic",
      "opus"
    )

    expect(model?.modelId).toBe("opus")
  })
})
