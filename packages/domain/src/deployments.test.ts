import { describe, expect, test } from "bun:test"

import { productionDeployConfirmed } from "./deployments"

describe("Production deploy confirmation", () => {
  test("requires the confirmed commit to match the requested commit", () => {
    expect(
      productionDeployConfirmed({ commit: "abc", confirmedCommit: "abc" })
    ).toBeTrue()
    expect(
      productionDeployConfirmed({ commit: "abc", confirmedCommit: "abd" })
    ).toBeFalse()
  })
})
