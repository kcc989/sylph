import { expect, test } from "bun:test"
import { providerRuntimeErrorDetail } from "./workspace-error-summary"

test("keeps the underlying stream failure without provider credentials", () => {
  const detail = providerRuntimeErrorDetail({
    reason: {
      raw: "TypeError: unexpected frame; Authorization: Bearer secret-value; key=sk-fixture-value",
    },
  })
  expect(detail).toContain("TypeError: unexpected frame")
  expect(detail).not.toContain("secret-value")
  expect(detail).not.toContain("sk-fixture-value")
})

test("keeps ordinary runtime errors readable", () => {
  expect(providerRuntimeErrorDetail(new Error("Connection reset"))).toBe(
    "Connection reset"
  )
})
