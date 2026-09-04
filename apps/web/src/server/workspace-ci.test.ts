import { describe, expect, test } from "bun:test"

import { browserEvidenceSelector } from "./workspace-ci-browser"

describe("Workspace CI browser evidence", () => {
  test("selects the rendered application readiness marker", () => {
    expect(browserEvidenceSelector("abc123")).toBe(
      '[data-sylph-checkpoint="abc123"][data-sylph-deployment="preview"]'
    )
  })
})
