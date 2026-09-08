import { expect, test } from "bun:test"
import { extractCursorVariantParameters } from "cursor-opencode-provider/models"
import { cursorCatalog } from "./catalog"

const base = [{ id: "effort", value: "high" }]
const long = [...base, { id: "context", value: "1m" }]

test("Cursor catalog preserves upstream defaults and long-context wire identity", () => {
  const models = cursorCatalog([
    {
      id: "fixture",
      displayName: "Fixture",
      supportsImages: true,
      maxContext: 200_000,
      maxContextForMaxMode: 1_000_000,
      variants: [
        {
          key: "high",
          displayName: "High",
          parameterValues: base,
          isDefaultNonMax: true,
          isDefaultMax: false,
        },
        {
          key: "long",
          displayName: "Long",
          parameterValues: long,
          isDefaultNonMax: false,
          isDefaultMax: true,
        },
      ],
    },
  ])
  const normal = models.find((model) => model.id === "fixture")
  const extended = models.find((model) => model.id === "fixture-1m")
  expect(normal?.modelId).toBe("fixture")
  expect(normal?.images).toBe(true)
  expect(normal?.settings).toBeUndefined()
  expect(
    extractCursorVariantParameters(normal?.variants?.[0]?.settings)
  ).toEqual(base)
  expect(extended?.modelId).toBe("fixture")
  expect(extended?.context).toBe(1_000_000)
  expect(extractCursorVariantParameters(extended?.settings)).toEqual(long)
  expect(
    extended?.variants?.some(
      (variant) =>
        JSON.stringify(extractCursorVariantParameters(variant.settings)) ===
        JSON.stringify(long)
    )
  ).toBe(true)
})

test("Cursor catalog excludes models without agent support", () => {
  expect(
    cursorCatalog([{ id: "chat-only", supportsAgent: false, variants: [] }])
  ).toEqual([])
})

test("Cursor exposes explicit Max Mode through the supported provider option", () => {
  const [model] = cursorCatalog([
    { id: "fixture", supportsMaxMode: true, variants: [] },
  ])
  expect(model?.variants).toContainEqual({
    id: "max",
    settings: { maxMode: true },
  })
  expect(model?.settings).toBeUndefined()
})
