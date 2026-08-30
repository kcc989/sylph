import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import {
  GitHubRepositoryService,
  githubRepositoryTestLayer,
} from "./github-repository-service"

const repository = {
  name: "private-project",
  full_name: "octocat/private-project",
  description: null,
  private: true,
  default_branch: "main",
  stargazers_count: 0,
  language: "TypeScript",
  updated_at: "2026-08-29T12:00:00Z",
  html_url: "https://github.com/octocat/private-project",
  owner: {
    login: "octocat",
    avatar_url: "https://avatars.example/octocat",
  },
}

describe("GitHubRepositoryService", () => {
  test("uses a GitHub App user token to inspect private repositories", async () => {
    let authorization = ""
    const layer = githubRepositoryTestLayer(async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? ""
      return Response.json(repository)
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* GitHubRepositoryService
        return yield* service.inspect({
          owner: "octocat",
          name: "private-project",
          accessToken: "ghu_private",
        })
      }).pipe(Effect.provide(layer))
    )

    expect(authorization).toBe("Bearer ghu_private")
    expect(result.visibility).toBe("private")
  })

  test("explains missing GitHub App repository grants", async () => {
    const layer = githubRepositoryTestLayer(async () =>
      Response.json({}, { status: 404 })
    )

    const result = await Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          const service = yield* GitHubRepositoryService
          return yield* service.inspect({
            owner: "octocat",
            name: "private-project",
            accessToken: "ghu_private",
          })
        }).pipe(Effect.provide(layer))
      )
    )

    expect(result._tag).toBe("Failure")
    expect(String(result)).toContain("not granted")
  })
})
