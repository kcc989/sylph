import { describe, expect, test } from "bun:test"

import { assertInstallationClaimIdentity } from "./installation-claim"

describe("Installation claim identity", () => {
  test("accepts an explicitly confirmed verified email", () => {
    expect(() =>
      assertInstallationClaimIdentity(
        { email: "operator@example.com", emailVerified: true },
        "Operator@example.com"
      )
    ).not.toThrow()
  })

  test("rejects an unverified account", () => {
    expect(() =>
      assertInstallationClaimIdentity(
        { email: "operator@example.com", emailVerified: false },
        "operator@example.com"
      )
    ).toThrow("Verify your email")
  })

  test("rejects a different confirmed address", () => {
    expect(() =>
      assertInstallationClaimIdentity(
        { email: "operator@example.com", emailVerified: true },
        "wrong@example.com"
      )
    ).toThrow("does not match")
  })
})
