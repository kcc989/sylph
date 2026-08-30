import { describe, expect, test } from "bun:test"

import { resolveStoredRepository } from "./repository-store"

describe("Repository Store metadata", () => {
  test("resolves metadata through an RPC repository handle", async () => {
    const result = await resolveStoredRepository({
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
      createToken: async () => ({ plaintext: "token", expiresAt: "later" }),
      fork: async () => ({
        id: "repo-2",
        name: "fork",
        remote: "https://repositories.example/fork",
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
