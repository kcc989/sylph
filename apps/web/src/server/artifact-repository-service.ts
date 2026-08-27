import { Context, Effect, Schema } from "effect"

const ArtifactErrorCode = Schema.Literals([
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
type ArtifactErrorCode = typeof ArtifactErrorCode.Type

export class ArtifactRepositoryError extends Schema.TaggedError<ArtifactRepositoryError>()(
  "ArtifactRepositoryError",
  {
    operation: Schema.NonEmptyString,
    code: ArtifactErrorCode,
    retryable: Schema.Boolean,
    message: Schema.String,
  }
) {}

export interface ArtifactRepositoryMetadata {
  readonly id: string
  readonly name: string
  readonly remote: string
  readonly defaultBranch: string
}

const ArtifactRepositoryMetadataSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  remote: Schema.NonEmptyString,
  defaultBranch: Schema.NonEmptyString,
})

interface ArtifactRepositoryHandle extends ArtifactRepositoryMetadata {
  readonly info?: () => Promise<ArtifactRepositoryMetadata>
}

interface CreateProjectRepository {
  readonly name: string
  readonly description: string
  readonly defaultBranch: string
}

interface ImportProjectRepository {
  readonly name: string
  readonly description: string
  readonly sourceUrl: string
  readonly sourceBranch?: string
}

interface ForkWorkspaceRepository {
  readonly sourceName: string
  readonly name: string
  readonly description: string
}

export class ArtifactRepositoryService extends Context.Service<
  ArtifactRepositoryService,
  {
    readonly createProject: (
      input: CreateProjectRepository
    ) => Effect.Effect<ArtifactRepositoryMetadata, ArtifactRepositoryError>
    readonly importProject: (
      input: ImportProjectRepository
    ) => Effect.Effect<ArtifactRepositoryMetadata, ArtifactRepositoryError>
    readonly forkWorkspace: (
      input: ForkWorkspaceRepository
    ) => Effect.Effect<ArtifactRepositoryMetadata, ArtifactRepositoryError>
    readonly inspect: (
      name: string
    ) => Effect.Effect<ArtifactRepositoryMetadata, ArtifactRepositoryError>
    readonly delete: (
      name: string
    ) => Effect.Effect<boolean, ArtifactRepositoryError>
  }
>()("@sylph/web/ArtifactRepositoryService") {}

const codeOf = (cause: unknown): ArtifactErrorCode => {
  if (!(cause instanceof Error) || !("code" in cause)) return "UNKNOWN"
  return Schema.decodeUnknownSync(ArtifactErrorCode)(cause.code)
}

const repositoryError = (operation: string, cause: unknown) => {
  const code = (() => {
    try {
      return codeOf(cause)
    } catch {
      return "UNKNOWN" as const
    }
  })()
  return new ArtifactRepositoryError({
    operation,
    code,
    retryable:
      code === "IMPORT_IN_PROGRESS" ||
      code === "FORK_IN_PROGRESS" ||
      code === "UPSTREAM_UNAVAILABLE" ||
      code === "INTERNAL_ERROR",
    message:
      cause instanceof Error ? cause.message : "Artifact operation failed",
  })
}

export const resolveArtifactRepositoryMetadata = async (
  repository: ArtifactRepositoryHandle
) => {
  const metadata = repository.info ? await repository.info() : repository

  return Schema.decodeUnknownPromise(ArtifactRepositoryMetadataSchema)(metadata)
}

export const makeArtifactRepositoryService = (
  binding: Artifacts
): ArtifactRepositoryService["Service"] => {
  const inspect = Effect.fn("ArtifactRepositoryService.inspect")(function* (
    name: string
  ) {
    return yield* Effect.tryPromise({
      try: async () => {
        let lastError: ArtifactRepositoryError | undefined
        for (let attempt = 0; attempt < 6; attempt += 1) {
          try {
            return resolveArtifactRepositoryMetadata(await binding.get(name))
          } catch (cause) {
            lastError = repositoryError("inspect", cause)
            if (!lastError.retryable) throw lastError
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * 2 ** attempt)
            )
          }
        }
        throw (
          lastError ??
          repositoryError("inspect", new Error("Repository unavailable"))
        )
      },
      catch: (cause) =>
        cause instanceof ArtifactRepositoryError
          ? cause
          : repositoryError("inspect", cause),
    })
  })

  return ArtifactRepositoryService.of({
    createProject: Effect.fn("ArtifactRepositoryService.createProject")(
      function* (input: CreateProjectRepository) {
        return yield* Effect.tryPromise({
          try: async () =>
            Schema.decodeUnknownPromise(ArtifactRepositoryMetadataSchema)(
              await binding.create(input.name, {
                description: input.description,
                setDefaultBranch: input.defaultBranch,
              })
            ),
          catch: (cause) => repositoryError("create_project", cause),
        })
      }
    ),
    importProject: Effect.fn("ArtifactRepositoryService.importProject")(
      function* (input: ImportProjectRepository) {
        return yield* Effect.tryPromise({
          try: async () =>
            Schema.decodeUnknownPromise(ArtifactRepositoryMetadataSchema)(
              await binding.import({
                source: {
                  url: input.sourceUrl,
                  branch: input.sourceBranch,
                },
                target: {
                  name: input.name,
                  opts: { description: input.description },
                },
              })
            ),
          catch: (cause) => repositoryError("import_project", cause),
        })
      }
    ),
    forkWorkspace: Effect.fn("ArtifactRepositoryService.forkWorkspace")(
      function* (input: ForkWorkspaceRepository) {
        yield* inspect(input.sourceName)
        const source = yield* Effect.tryPromise({
          try: () => binding.get(input.sourceName),
          catch: (cause) => repositoryError("inspect_fork_source", cause),
        })
        return yield* Effect.tryPromise({
          try: async () =>
            Schema.decodeUnknownPromise(ArtifactRepositoryMetadataSchema)(
              await source.fork(input.name, {
                description: input.description,
                defaultBranchOnly: true,
              })
            ),
          catch: (cause) => repositoryError("fork_workspace", cause),
        })
      }
    ),
    inspect,
    delete: Effect.fn("ArtifactRepositoryService.delete")(function* (
      name: string
    ) {
      return yield* Effect.tryPromise({
        try: () => binding.delete(name),
        catch: (cause) => repositoryError("delete", cause),
      })
    }),
  })
}
