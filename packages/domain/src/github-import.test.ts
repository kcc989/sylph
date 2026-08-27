import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import { parseGitHubRepositoryUrl } from "./github-import"

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
