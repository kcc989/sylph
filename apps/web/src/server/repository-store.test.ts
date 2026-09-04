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
      import: async () => {
        throw new Error("Unexpected import")
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
      import: async () => {
        throw new Error("Unexpected import")
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

describe("Repository Store import", () => {
  test("imports a Template Repository and waits for the import to finish", async () => {
    const calls: Array<unknown> = []
    let reads = 0
    const binding: RepositoryNamespace = {
      create: async () => {
        throw new Error("Unexpected create")
      },
      delete: async () => {
        throw new Error("Unexpected delete")
      },
      import: async (params) => {
        calls.push(["import", params])
        return {
          id: "template-id",
          name: params.target.name,
          remote: "https://repositories.example/template",
          defaultBranch: "main",
        }
      },
      get: async (name: string) => {
        reads += 1
        if (reads < 3) {
          throw Object.assign(new Error("importing"), {
            code: "IMPORT_IN_PROGRESS",
          })
        }
        return {
          id: "template-id",
          name,
          remote: "https://repositories.example/template",
          defaultBranch: "main",
          createToken: async () => ({ plaintext: "token", expiresAt: "later" }),
          fork: async () => {
            throw new Error("Unexpected fork")
          },
        }
      },
    }
    const waits: Array<number> = []
    const service = makeCloudflareArtifactsRepositoryStore(
      binding,
      async () => [],
      async (milliseconds) => {
        waits.push(milliseconds)
      }
    )

    const result = await Effect.runPromise(
      service.import({
        name: "acme-template-cloudflare-tanstack-main",
        description: "Cloudflare app template imported by Sylph",
        sourceUrl: "https://github.com/kcc989/sylph-tanstack-template",
        sourceRef: "main",
      })
    )

    expect(result).toEqual({
      id: "template-id",
      name: "acme-template-cloudflare-tanstack-main",
      remote: "https://repositories.example/template",
      defaultBranch: "main",
    })
    expect(calls).toEqual([
      [
        "import",
        {
          source: {
            url: "https://github.com/kcc989/sylph-tanstack-template",
            branch: "main",
          },
          target: {
            name: "acme-template-cloudflare-tanstack-main",
            opts: { description: "Cloudflare app template imported by Sylph" },
          },
        },
      ],
    ])
    expect(waits).toEqual([2_000, 2_000])
  })

  test("reports a template import failure with its Artifacts code", async () => {
    const binding: RepositoryNamespace = {
      create: async () => {
        throw new Error("Unexpected create")
      },
      delete: async () => {
        throw new Error("Unexpected delete")
      },
      import: async () => {
        throw Object.assign(new Error("exists"), { code: "ALREADY_EXISTS" })
      },
      get: async () => {
        throw new Error("Unexpected get")
      },
    }
    const service = makeCloudflareArtifactsRepositoryStore(binding)

    const failure = await Effect.runPromise(
      service
        .import({
          name: "acme-template-cloudflare-tanstack-main",
          description: "template",
          sourceUrl: "https://github.com/kcc989/sylph-tanstack-template",
          sourceRef: "main",
        })
        .pipe(Effect.flip)
    )

    expect(failure.operation).toBe("import")
    expect(failure.code).toBe("ALREADY_EXISTS")
    expect(failure.retryable).toBe(false)
  })
  test("recognizes the duplicate-repository error after RPC drops its code", async () => {
    const binding: RepositoryNamespace = {
      create: async () => {
        throw new Error("Unexpected create")
      },
      delete: async () => {
        throw new Error("Unexpected delete")
      },
      get: async () => {
        throw new Error("Unexpected get")
      },
      import: async () => {
        throw new Error(
          "ArtifactsError: repo already exists: sylph-template-cloudflare-tanstack-main"
        )
      },
    }
    const service = makeCloudflareArtifactsRepositoryStore(binding)
    const failure = await Effect.runPromise(
      service
        .import({
          name: "sylph-template-cloudflare-tanstack-main",
          description: "template",
          sourceUrl: "https://github.com/kcc989/sylph-tanstack-template",
          sourceRef: "main",
        })
        .pipe(Effect.flip)
    )
    expect(failure.code).toBe("ALREADY_EXISTS")
  })

  test("retries asynchronous metadata reads during import recovery", async () => {
    let reads = 0
    const metadata = {
      id: "template-id",
      name: "template",
      remote: "https://repositories.example/template",
      defaultBranch: "main",
    }
    const binding: RepositoryNamespace = {
      create: async () => {
        throw new Error("Unexpected create")
      },
      delete: async () => {
        throw new Error("Unexpected delete")
      },
      import: async () => {
        throw new Error("Unexpected import")
      },
      get: async () => ({
        ...metadata,
        info: async () => {
          reads += 1
          if (reads < 3)
            throw Object.assign(new Error("importing"), {
              code: "IMPORT_IN_PROGRESS",
            })
          return metadata
        },
        createToken: async () => ({ plaintext: "token", expiresAt: "later" }),
        fork: async () => {
          throw new Error("Unexpected fork")
        },
      }),
    }
    const waits: number[] = []
    const service = makeCloudflareArtifactsRepositoryStore(
      binding,
      async () => [],
      async (milliseconds) => {
        waits.push(milliseconds)
      }
    )
    expect(await Effect.runPromise(service.inspect("template"))).toEqual(
      metadata
    )
    expect(waits).toEqual([100, 200])
  })
})
