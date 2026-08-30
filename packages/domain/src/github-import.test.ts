import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import {
  encodeGitHubRepositoryInfo,
  GitHubRepositoryInfo,
  parseGitHubRepositoryUrl,
} from "./github-import"

describe("parseGitHubRepositoryUrl", () => {
  test("parses canonical GitHub repository URLs", async () => {
    const repository = await Effect.runPromise(
      parseGitHubRepositoryUrl("https://github.com/kcc989/Sylph")
    )

    expect(repository).toEqual({ owner: "kcc989", name: "Sylph" })
  })

  test("removes the git suffix", async () => {
    const repository = await Effect.runPromise(
      parseGitHubRepositoryUrl("https://github.com/kcc989/Sylph.git")
    )

    expect(repository).toEqual({ owner: "kcc989", name: "Sylph" })
  })

  test("rejects non-repository GitHub paths", async () => {
    const result = await Effect.runPromise(
      Effect.exit(
        parseGitHubRepositoryUrl("https://github.com/kcc989/Sylph/issues")
      )
    )

    expect(result._tag).toBe("Failure")
  })
})

describe("GitHubRepositoryInfo", () => {
  test("encodes to a server-function-safe plain object", async () => {
    const encoded = await encodeGitHubRepositoryInfo(
      new GitHubRepositoryInfo({
        owner: "octocat",
        name: "private-project",
        fullName: "octocat/private-project",
        description: null,
        visibility: "private",
        defaultBranch: "main",
        stars: 0,
        language: null,
        updatedAt: "2026-08-29T00:00:00Z",
        url: "https://github.com/octocat/private-project",
        ownerAvatarUrl: "https://avatars.githubusercontent.com/u/583231",
      })
    )

    expect(Object.getPrototypeOf(encoded)).toBe(Object.prototype)
    expect(encoded.visibility).toBe("private")
  })
})
