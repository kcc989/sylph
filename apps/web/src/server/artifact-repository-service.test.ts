import { describe, expect, test } from "bun:test"

import { resolveArtifactRepositoryMetadata } from "./artifact-repository-service"

describe("Artifact Repository metadata", () => {
  test("resolves metadata through an RPC repository handle", async () => {
    const result = await resolveArtifactRepositoryMetadata({
      id: "rpc-id",
      name: "rpc-name",
      remote: "rpc-remote",
      defaultBranch: "rpc-default-branch",
      info: async () => ({
        id: "repo-1",
        name: "weather-desk",
        remote: "https://repositories.example/weather-desk",
        defaultBranch: "main",
      }),
    })

    expect(result).toEqual({
      id: "repo-1",
      name: "weather-desk",
      remote: "https://repositories.example/weather-desk",
      defaultBranch: "main",
    })
  })
})
