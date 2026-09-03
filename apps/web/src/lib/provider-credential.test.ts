import { describe, expect, test } from "bun:test"

import {
  decodeStoredCredential,
  encodeKeyCredential,
  normalizeProviderApiKey,
} from "./provider-credential"

describe("stored provider credentials", () => {
  test.each([
    ["secret", "secret"],
    ["  secret  ", "secret"],
    ['"secret"', "secret"],
    ["'secret'", "secret"],
    ['  "secret"  ', "secret"],
    ['"secret', '"secret'],
    ['sec"ret', 'sec"ret'],
  ])("normalizes pasted API keys", (value, expected) => {
    expect(normalizeProviderApiKey(value)).toBe(expected)
  })

  test("preserves provider configuration across runtime restarts", async () => {
    const stored = encodeKeyCredential("secret", { accountId: "account-1" })

    await expect(decodeStoredCredential("api-key", stored)).resolves.toEqual({
      type: "key",
      key: "secret",
      configuration: { accountId: "account-1" },
    })
  })

  test("reads API keys stored before structured credentials", async () => {
    await expect(
      decodeStoredCredential("api-key", "legacy-secret")
    ).resolves.toEqual({ type: "key", key: "legacy-secret" })
  })

  test.each([
    ['{"type":"key","key":"\\\"structured-secret\\\""}', "structured-secret"],
    ['"legacy-secret"', "legacy-secret"],
  ])("repairs quoted stored API keys", async (stored, expected) => {
    await expect(decodeStoredCredential("api-key", stored)).resolves.toEqual({
      type: "key",
      key: expected,
    })
  })
})
