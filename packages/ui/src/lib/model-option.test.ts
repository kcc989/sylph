import { describe, expect, test } from "bun:test"

import { decodeModelOption, encodeModelOption } from "./model-option"

describe("model option values", () => {
  test("round trips provider and model IDs through an HTML-safe value", () => {
    const selection = { providerId: "openai", modelId: "gpt-5.6-sol" }
    const encoded = encodeModelOption(selection)

    expect(encoded).not.toContain("\u0000")
    expect(decodeModelOption(encoded)).toEqual(selection)
  })

  test("rejects malformed values", () => {
    expect(decodeModelOption("openai/gpt-5.6-sol")).toBeNull()
    expect(decodeModelOption('["openai"]')).toBeNull()
  })
})
