import { describe, expect, test } from "bun:test"

import {
  artifactGitProtocolVersion,
  isRepositoryMetadata,
  workspaceHydrationRefs,
  workspaceRepositoryDefaultBranch,
  workspaceProjectRemote,
  workspaceRebaseConflictState,
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

  test("marks a conflicted rebase recoverable against the new Project head", () => {
    expect(
      workspaceRebaseConflictState("9719a4437d6d50091b89a2d9cd8caa97f07b90a5")
    ).toEqual({
      projectHead: "9719a4437d6d50091b89a2d9cd8caa97f07b90a5",
      syncStatus: "diverged",
      mergeStatus: "unreviewed",
    })
  })

  test("configures the Project remote before an older Workspace fetches it", () => {
    expect(
      workspaceProjectRemote("https://artifacts.example/project.git")
    ).toEqual({
      remote: "project",
      url: "https://artifacts.example/project.git",
      force: true,
    })
  })

  test("hydrates a named Workspace branch from the Project default branch", () => {
    expect(workspaceHydrationRefs("quiet-lynx", "main")).toEqual({
      createRef: "quiet-lynx",
      sourceRef: "main",
    })
    expect(workspaceHydrationRefs("main", "main")).toEqual({
      createRef: null,
      sourceRef: "main",
    })
  })
})

test("resolves the default branch through the Artifacts RPC metadata method", async () => {
  const repository = {
    defaultBranch: "rpc-property",
    info: async () => ({ defaultBranch: "main" }),
    createToken: async () => ({ plaintext: "fixture" }),
  }
  expect(await workspaceRepositoryDefaultBranch(repository)).toBe("main")
  expect(
    await workspaceRepositoryDefaultBranch({
      defaultBranch: "trunk",
      createToken: repository.createToken,
    })
  ).toBe("trunk")
})
