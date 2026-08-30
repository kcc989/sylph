import { Context, Effect, Schema } from "effect"

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
    readonly inspect: (
      name: string
    ) => Effect.Effect<StoredRepository, RepositoryStoreError>
    readonly access: (
      name: string,
      scope: "read" | "write",
      ttlSeconds: number
    ) => Effect.Effect<RepositoryAccess, RepositoryStoreError>
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

export const makeCloudflareArtifactsRepositoryStore = (
  binding: Artifacts
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
              defaultBranchOnly: false,
            })
          )
        },
        catch: (cause) => storeError("fork", cause),
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
    remove: Effect.fn("RepositoryStore.remove")(function* (name) {
      return yield* Effect.tryPromise({
        try: () => binding.delete(name),
        catch: (cause) => storeError("remove", cause),
      })
    }),
  })
}
