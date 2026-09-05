import { expect, test } from "bun:test"
import { workspaceModelCacheBody } from "./workspace-model-cache"

test("enables automatic Claude caching while preserving model settings", () => {
  expect(
    workspaceModelCacheBody("openrouter", "anthropic/claude-sonnet-4.6", {
      temperature: 0,
    })
  ).toEqual({
    cache_control: { type: "ephemeral" },
    temperature: 0,
  })
})

test("preserves explicit cache settings and leaves other models alone", () => {
  const body = { cache_control: { type: "ephemeral", ttl: "1h" } }
  expect(
    workspaceModelCacheBody("openrouter", "anthropic/claude-sonnet-4.6", body)
  ).toEqual(body)
  expect(
    workspaceModelCacheBody("openrouter", "nvidia/nemotron-3.5-lightning:free")
  ).toBeUndefined()
  expect(
    workspaceModelCacheBody("anthropic", "claude-sonnet-4.6")
  ).toBeUndefined()
})
