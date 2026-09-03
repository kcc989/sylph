import { Context, Effect, Schema } from "effect"
import git from "isomorphic-git"
import http from "isomorphic-git/http/web"

const RepositoryStoreErrorCode = Schema.Literals([
  "ALREADY_EXISTS",
  "NOT_FOUND",
  "IMPORT_IN_PROGRESS",
  "FORK_IN_PROGRESS",
  "INVALID_INPUT",
  "INVALID_REPO_NAME",
  "INVALID_TTL",
  "INVALID_URL",
  "REMOTE_AUTH_REQUIRED",
  "UPSTREAM_UNAVAILABLE",
  "MEMORY_LIMIT",
  "INTERNAL_ERROR",
  "UNKNOWN",
])
type RepositoryStoreErrorCode = typeof RepositoryStoreErrorCode.Type

export class RepositoryStoreError extends Schema.TaggedError<RepositoryStoreError>()(
  "RepositoryStoreError",
  {
    operation: Schema.NonEmptyString,
    code: RepositoryStoreErrorCode,
    retryable: Schema.Boolean,
    message: Schema.String,
  }
) {}

export interface StoredRepository {
  readonly id: string
  readonly name: string
  readonly remote: string
  readonly defaultBranch: string
}

export interface RepositoryAccess {
  readonly username: string
  readonly password: string
  readonly expiresAt: string
}

const StoredRepositorySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  remote: Schema.NonEmptyString,
  defaultBranch: Schema.NonEmptyString,
})

interface RepositoryHandle extends StoredRepository {
  readonly info?: () => Promise<StoredRepository>
  readonly createToken: (
    scope?: "read" | "write",
    ttl?: number
  ) => Promise<{ plaintext: string; expiresAt: string }>
  readonly fork: (
    name: string,
    options?: {
      description?: string
      readOnly?: boolean
      defaultBranchOnly?: boolean
    }
  ) => Promise<StoredRepository>
}

export interface RepositoryNamespace {
  readonly create: (
    name: string,
    options: { description: string; setDefaultBranch: string }
  ) => Promise<StoredRepository>
  readonly get: (name: string) => Promise<RepositoryHandle>
  readonly import: (params: {
    source: { url: string; branch?: string; depth?: number }
    target: { name: string; opts?: { description?: string } }
  }) => Promise<StoredRepository>
  readonly delete: (name: string) => Promise<boolean>
}

export class RepositoryStore extends Context.Service<
  RepositoryStore,
  {
    readonly create: (input: {
      name: string
      description: string
      defaultBranch: string
    }) => Effect.Effect<StoredRepository, RepositoryStoreError>
    readonly fork: (input: {
      sourceName: string
      name: string
      description: string
    }) => Effect.Effect<StoredRepository, RepositoryStoreError>
    readonly import: (input: {
      name: string
      description: string
      sourceUrl: string
      sourceRef: string
    }) => Effect.Effect<StoredRepository, RepositoryStoreError>
    readonly inspect: (
      name: string
    ) => Effect.Effect<StoredRepository, RepositoryStoreError>
    readonly access: (
      name: string,
      scope: "read" | "write",
      ttlSeconds: number
    ) => Effect.Effect<RepositoryAccess, RepositoryStoreError>
    readonly head: (name: string) => Effect.Effect<string, RepositoryStoreError>
    readonly remove: (
      name: string
    ) => Effect.Effect<boolean, RepositoryStoreError>
  }
>()("@sylph/web/RepositoryStore") {}

const errorCode = (cause: unknown): RepositoryStoreErrorCode => {
  if (!(cause instanceof Error) || !("code" in cause)) return "UNKNOWN"
  return Schema.decodeUnknownSync(RepositoryStoreErrorCode)(cause.code)
}

const storeError = (operation: string, cause: unknown) => {
  const code = (() => {
    try {
      return errorCode(cause)
    } catch {
      return "UNKNOWN" as const
    }
  })()
  return new RepositoryStoreError({
    operation,
    code,
    retryable:
      code === "IMPORT_IN_PROGRESS" ||
      code === "FORK_IN_PROGRESS" ||
      code === "UPSTREAM_UNAVAILABLE" ||
      code === "INTERNAL_ERROR",
    message:
      cause instanceof Error ? cause.message : "Repository operation failed",
  })
}

export const resolveStoredRepository = async (repository: RepositoryHandle) =>
  Schema.decodeUnknownPromise(StoredRepositorySchema)(
    repository.info ? await repository.info() : repository
  )

export const importPollIntervalMs = 2_000
export const importPollAttempts = 45

export const makeCloudflareArtifactsRepositoryStore = (
  binding: RepositoryNamespace,
  listRefs: (
    input: Parameters<typeof git.listServerRefs>[0]
  ) => Promise<Array<{ ref: string; oid: string }>> = git.listServerRefs,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
): RepositoryStore["Service"] => {
  const inspect = Effect.fn("RepositoryStore.inspect")(function* (
    name: string
  ) {
    return yield* Effect.tryPromise({
      try: async () => {
        let lastError: RepositoryStoreError | undefined
        for (let attempt = 0; attempt < 6; attempt += 1) {
          try {
            return resolveStoredRepository(await binding.get(name))
          } catch (cause) {
            lastError = storeError("inspect", cause)
            if (!lastError.retryable) throw lastError
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * 2 ** attempt)
            )
          }
        }
        throw (
          lastError ??
          storeError("inspect", new Error("Repository unavailable"))
        )
      },
      catch: (cause) =>
        cause instanceof RepositoryStoreError
          ? cause
          : storeError("inspect", cause),
    })
  })

  return RepositoryStore.of({
    create: Effect.fn("RepositoryStore.create")(function* (input) {
      return yield* Effect.tryPromise({
        try: async () =>
          Schema.decodeUnknownPromise(StoredRepositorySchema)(
            await binding.create(input.name, {
              description: input.description,
              setDefaultBranch: input.defaultBranch,
            })
          ),
        catch: (cause) => storeError("create", cause),
      })
    }),
    fork: Effect.fn("RepositoryStore.fork")(function* (input) {
      const source = yield* inspect(input.sourceName)
      return yield* Effect.tryPromise({
        try: async () => {
          const repository = await binding.get(source.name)
          return Schema.decodeUnknownPromise(StoredRepositorySchema)(
            await repository.fork(input.name, {
              description: input.description,
              readOnly: false,
              defaultBranchOnly: true,
            })
          )
        },
        catch: (cause) => storeError("fork", cause),
      })
    }),
    import: Effect.fn("RepositoryStore.import")(function* (input) {
      return yield* Effect.tryPromise({
        try: async () => {
          await binding.import({
            source: { url: input.sourceUrl, branch: input.sourceRef },
            target: {
              name: input.name,
              opts: { description: input.description },
            },
          })
          let lastError: RepositoryStoreError | undefined
          for (let attempt = 0; attempt < importPollAttempts; attempt += 1) {
            try {
              return await resolveStoredRepository(
                await binding.get(input.name)
              )
            } catch (cause) {
              lastError = storeError("import", cause)
              if (lastError.code !== "IMPORT_IN_PROGRESS") throw lastError
              await wait(importPollIntervalMs)
            }
          }
          throw (
            lastError ??
            storeError("import", new Error("Repository import did not finish"))
          )
        },
        catch: (cause) =>
          cause instanceof RepositoryStoreError
            ? cause
            : storeError("import", cause),
      })
    }),
    inspect,
    access: Effect.fn("RepositoryStore.access")(
      function* (name, scope, ttlSeconds) {
        return yield* Effect.tryPromise({
          try: async () => {
            const repository = await binding.get(name)
            const token = await repository.createToken(scope, ttlSeconds)
            return {
              username: "x",
              password: token.plaintext.split("?expires=")[0],
              expiresAt: token.expiresAt,
            }
          },
          catch: (cause) => storeError("access", cause),
        })
      }
    ),
    head: Effect.fn("RepositoryStore.head")(function* (name) {
      return yield* Effect.tryPromise({
        try: async () => {
          const handle = await binding.get(name)
          const repository = await resolveStoredRepository(handle)
          const token = await handle.createToken("read", 300)
          const refs = await listRefs({
            http,
            url: repository.remote,
            prefix: `refs/heads/${repository.defaultBranch}`,
            protocolVersion: 2,
            onAuth: () => ({
              username: "x",
              password: token.plaintext.split("?expires=")[0],
            }),
          })
          const head = refs.find(
            (candidate) =>
              candidate.ref === `refs/heads/${repository.defaultBranch}`
          )
          if (!head) throw new Error("Repository default ref is missing")
          return head.oid
        },
        catch: (cause) => storeError("head", cause),
      })
    }),
    remove: Effect.fn("RepositoryStore.remove")(function* (name) {
      return yield* Effect.tryPromise({
        try: () => binding.delete(name),
        catch: (cause) => storeError("remove", cause),
      })
    }),
  })
}
