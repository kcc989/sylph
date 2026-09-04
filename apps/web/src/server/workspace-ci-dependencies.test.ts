import { describe, expect, test } from "bun:test"

import { dependencyInstallCommand } from "./workspace-ci-dependencies"

describe("Workspace CI dependencies", () => {
  test("uses frozen installs when a lockfile is present", () => {
    expect(dependencyInstallCommand).toContain("bun install --frozen-lockfile")
    expect(dependencyInstallCommand).toContain("npm ci")
  })

  test("preserves installed modules for downstream runners", () => {
    expect(dependencyInstallCommand).not.toContain("rm -rf")
  })
})
