import { expect, test } from "bun:test"
import { cursorModelOptions } from "./model-options"

const variant = (isDefaultNonMax: boolean, isDefaultMax: boolean) => ({
  key: "model",
  displayName: "Model",
  parameterValues: [],
  isDefaultNonMax,
  isDefaultMax,
})

test("Cursor selects Max Mode when its catalog only offers a Max default", () => {
  expect(
    cursorModelOptions(
      { prompt: [] },
      { id: "model", variants: [variant(false, true)] }
    ).providerOptions?.cursor?.maxMode
  ).toBe(true)
})

test("Cursor keeps the ordinary default when both modes are supported", () => {
  expect(
    cursorModelOptions(
      { prompt: [] },
      { id: "model", variants: [variant(true, false), variant(false, true)] }
    ).providerOptions?.cursor?.maxMode
  ).toBe(false)
})

test("Cursor preserves explicit model options", () => {
  expect(
    cursorModelOptions(
      {
        prompt: [],
        providerOptions: {
          cursor: { maxMode: true, opencodeCompaction: true },
        },
      },
      { id: "model", variants: [variant(true, false)] }
    ).providerOptions?.cursor
  ).toEqual({ maxMode: true, opencodeCompaction: true })
})
