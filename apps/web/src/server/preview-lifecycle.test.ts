import { expect, test } from "bun:test"
import { previewRetention } from "./preview-lifecycle"

test("preview retention defaults to seven days and rejects invalid overrides", () => {
  expect(previewRetention()).toBe("7 days")
  expect(previewRetention("5")).toBe(5)
  expect(() => previewRetention("invalid")).toThrow()
  expect(() => previewRetention("-1")).toThrow()
})
