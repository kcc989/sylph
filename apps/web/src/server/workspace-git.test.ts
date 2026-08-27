import { describe, expect, test } from "bun:test"

import { isRepositoryMetadata } from "./workspace-git"

describe("WorkspaceGit", () => {
  test("excludes Git internals from user-facing changes", () => {
    expect(isRepositoryMetadata(".git")).toBe(true)
    expect(isRepositoryMetadata(".git/config")).toBe(true)
    expect(isRepositoryMetadata("conversation-check.md")).toBe(false)
  })
})
