import { describe, expect, test } from "bun:test"

import { requireProjectProviderConnection } from "./project-provider-guard"

describe("Project provider gate", () => {
  test("rejects Project creation before any provider is connected", () => {
    expect(() => requireProjectProviderConnection(null)).toThrow(
      "Connect an AI provider before creating a Project"
    )
  })

  test("returns the connected provider", () => {
    const connection = { providerId: "openai", modelId: "gpt-5.6-sol" }

    expect(requireProjectProviderConnection(connection)).toBe(connection)
  })
})
