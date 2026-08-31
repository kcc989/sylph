import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import {
  makeCloudflareArtifactsRepositoryStore,
  type RepositoryNamespace,
  resolveStoredRepository,
} from "./repository-store"

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

  test("forks a Workspace from the Project repository", async () => {
    const calls: Array<unknown> = []
    const binding: RepositoryNamespace = {
      create: async () => {
        throw new Error("Unexpected create")
      },
      delete: async () => {
        throw new Error("Unexpected delete")
      },
      get: async (name: string) => {
        calls.push(["get", name])
        return {
          id: "project-id",
          name,
          remote: "https://repositories.example/project",
          defaultBranch: "main",
          createToken: async () => ({ plaintext: "token", expiresAt: "later" }),
          info: async () => ({
            id: "project-id",
            name,
            remote: "https://repositories.example/project",
            defaultBranch: "main",
          }),
          fork: async (target, options) => {
            calls.push(["fork", target, options])
            return {
              id: "workspace-id",
              name: target,
              remote: "https://repositories.example/workspace",
              defaultBranch: "main",
            }
          },
        }
      },
    }
    const service = makeCloudflareArtifactsRepositoryStore(binding)

    const result = await Effect.runPromise(
      service.fork({
        sourceName: "project",
        name: "workspace",
        description: "Workspace fork",
      })
    )

    expect(result).toEqual({
      id: "workspace-id",
      name: "workspace",
      remote: "https://repositories.example/workspace",
      defaultBranch: "main",
    })
    expect(calls).toEqual([
      ["get", "project"],
      ["get", "project"],
      [
        "fork",
        "workspace",
        {
          description: "Workspace fork",
          readOnly: false,
          defaultBranchOnly: true,
        },
      ],
    ])
  })

  test("reads the repository's actual default-branch head", async () => {
    const binding: RepositoryNamespace = {
      create: async () => {
        throw new Error("Unexpected create")
      },
      delete: async () => {
        throw new Error("Unexpected delete")
      },
      get: async (name: string) => ({
        id: "project-id",
        name,
        remote: "https://repositories.example/project",
        defaultBranch: "main",
        createToken: async () => ({ plaintext: "token", expiresAt: "later" }),
        fork: async () => {
          throw new Error("Unexpected fork")
        },
      }),
    }
    const service = makeCloudflareArtifactsRepositoryStore(
      binding,
      async () => [
        {
          ref: "refs/heads/main",
          oid: "1111111111111111111111111111111111111111",
        },
      ]
    )

    const result = await Effect.runPromise(service.head("project"))

    expect(result).toBe("1111111111111111111111111111111111111111")
  })
})
