import { describe, expect, test } from "bun:test"

import {
  artifactGitProtocolVersion,
  isRepositoryMetadata,
} from "./workspace-git"

describe("WorkspaceGit", () => {
  test("excludes Git internals from user-facing changes", () => {
    expect(isRepositoryMetadata(".git")).toBe(true)
    expect(isRepositoryMetadata(".git/config")).toBe(true)
    expect(isRepositoryMetadata("conversation-check.md")).toBe(false)
  })

  test("uses protocol v1 for Artifacts push discovery", () => {
    expect(artifactGitProtocolVersion(true)).toBe(1)
    expect(artifactGitProtocolVersion(false)).toBe(2)
  })
})
