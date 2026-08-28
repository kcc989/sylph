import { describe, expect, test } from "bun:test"

import {
  decodeStoredCredential,
  encodeKeyCredential,
} from "./provider-credential"

describe("stored provider credentials", () => {
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
})
