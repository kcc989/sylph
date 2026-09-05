import { expect, test } from "bun:test"
import {
  findWorkspaceModel,
  workspaceThinkingOptions,
} from "./workspace-model-options"

const model = (id: string, modelID: string, variants: string[]) => ({
  id,
  modelID,
  providerID: "openrouter",
  enabled: true,
  status: "active" as const,
  variants: variants.map((id) => ({ id })),
})

test("uses the catalog ID before a conflicting provider request ID", () => {
  const alias = model("other-alias", "nemotron", [])
  const canonical = model("nemotron", "nvidia/nemotron", ["none", "thinking"])
  expect(
    findWorkspaceModel([alias, canonical], {
      providerId: "openrouter",
      modelId: "nemotron",
    })
  ).toBe(canonical)
})

test("does not guess between aliases sharing a request model ID", () => {
  expect(
    findWorkspaceModel(
      [model("a", "request", []), model("b", "request", ["high"])],
      { providerId: "openrouter", modelId: "request" }
    )
  ).toBeUndefined()
})

test("shows toggle options without inventing effort levels", () => {
  expect(
    workspaceThinkingOptions(
      model("nemotron", "request", ["none", "thinking", "creative"])
    )
  ).toEqual([
    { value: "none", label: "Off", kind: "toggle" },
    { value: "thinking", label: "On", kind: "toggle" },
  ])
})

test("labels native effort settings while preserving variant identifiers", () => {
  expect(
    workspaceThinkingOptions({
      variants: [
        { id: "deep", settings: { reasoningEffort: "xhigh" } },
        { id: "fast", settings: { reasoningEffort: "low" } },
      ],
    })
  ).toEqual([
    { value: "deep", label: "Extra high", kind: "effort" },
    { value: "fast", label: "Low", kind: "effort" },
  ])
})

test("does not offer unrelated variants as reasoning settings", () => {
  expect(
    workspaceThinkingOptions(model("plain", "request", ["creative", "precise"]))
  ).toEqual([])
})

test("reads thinking mode and effort from native provider settings", () => {
  expect(
    workspaceThinkingOptions({
      variants: [
        { id: "deliberate", settings: { thinking: { type: "enabled" } } },
        { id: "quick", settings: { thinking: { type: "disabled" } } },
      ],
    })
  ).toEqual([
    { value: "deliberate", label: "On", kind: "toggle" },
    { value: "quick", label: "Off", kind: "toggle" },
  ])
  expect(
    workspaceThinkingOptions({
      variants: [
        {
          id: "advanced",
          settings: { thinkingConfig: { thinkingLevel: "high" } },
        },
      ],
    })
  ).toEqual([{ value: "advanced", label: "High", kind: "effort" }])
})
