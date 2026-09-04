import { expect, test } from "bun:test"
import { cursorTokenExpiresAt } from "./cursor-token-expiry"

test("uses the Cursor token expiry instead of elapsed connection time", () => {
  const expiry = 2_000_000_000
  const claims = Buffer.from(JSON.stringify({ exp: expiry })).toString(
    "base64url"
  )
  expect(cursorTokenExpiresAt(`header.${claims}.signature`)).toBe(expiry * 1000)
})

test("treats malformed or missing expiry claims as expired", () => {
  expect(cursorTokenExpiresAt("opaque-token")).toBe(0)
  expect(cursorTokenExpiresAt("header.e30.signature")).toBe(0)
  expect(cursorTokenExpiresAt("header.!.signature")).toBe(0)
})
