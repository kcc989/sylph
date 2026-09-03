import { Schema } from "effect"

export const AccessDeniedResource = Schema.Literals([
  "installation",
  "organization",
  "project",
  "issue",
  "workspace",
  "review",
])
export type AccessDeniedResource = typeof AccessDeniedResource.Type

export class AuthenticationRequired extends Schema.TaggedError<AuthenticationRequired>()(
  "AuthenticationRequired",
  {
    message: Schema.String,
  }
) {}

export class AccessDenied extends Schema.TaggedError<AccessDenied>()(
  "AccessDenied",
  {
    message: Schema.String,
    resource: AccessDeniedResource,
  }
) {}

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
  "InvalidRequest",
  {
    message: Schema.String,
  }
) {}

export class PreconditionFailed extends Schema.TaggedError<PreconditionFailed>()(
  "PreconditionFailed",
  {
    message: Schema.String,
  }
) {}

export class WorkspaceReadOnly extends Schema.TaggedError<WorkspaceReadOnly>()(
  "WorkspaceReadOnly",
  {
    message: Schema.String,
    status: Schema.Literals(["archived", "merging"]),
  }
) {}

export class ProviderConnectionRequired extends Schema.TaggedError<ProviderConnectionRequired>()(
  "ProviderConnectionRequired",
  {
    message: Schema.String,
  }
) {}

export class InstallationClaimRejected extends Schema.TaggedError<InstallationClaimRejected>()(
  "InstallationClaimRejected",
  {
    message: Schema.String,
  }
) {}

export class WorkspaceRuntimeFailure extends Schema.TaggedError<WorkspaceRuntimeFailure>()(
  "WorkspaceRuntimeFailure",
  {
    message: Schema.String,
    reason: Schema.optional(Schema.Literal("not_initialized")),
  }
) {}

export class WorkspaceFileNotFound extends Schema.TaggedError<WorkspaceFileNotFound>()(
  "WorkspaceFileNotFound",
  {
    message: Schema.String,
    path: Schema.String,
  }
) {}

export const ServerFailure = Schema.Union([
  AuthenticationRequired,
  AccessDenied,
  InvalidRequest,
  PreconditionFailed,
  WorkspaceReadOnly,
  ProviderConnectionRequired,
  InstallationClaimRejected,
  WorkspaceRuntimeFailure,
  WorkspaceFileNotFound,
])
export type ServerFailure = typeof ServerFailure.Type
export type ServerFailureTag = ServerFailure["_tag"]

export const isServerFailure = Schema.is(ServerFailure)
export const encodeServerFailure = Schema.encodeSync(ServerFailure)
export const decodeServerFailure = Schema.decodeUnknownSync(ServerFailure)

export const failureMessage = (cause: unknown, fallback: string) =>
  isServerFailure(cause) || cause instanceof Error
    ? cause.message || fallback
    : fallback

export const failureTag = (cause: unknown): ServerFailureTag | null =>
  isServerFailure(cause) ? cause._tag : null

export const isRuntimeNotInitialized = (cause: unknown) =>
  isServerFailure(cause) &&
  cause._tag === "WorkspaceRuntimeFailure" &&
  cause.reason === "not_initialized"

const failureEnvelopePrefix = "@sylph/failure:"

export const serializeServerFailure = (failure: ServerFailure) =>
  `${failureEnvelopePrefix}${JSON.stringify(encodeServerFailure(failure))}`

export const parseServerFailure = (message: string): ServerFailure | null => {
  if (!message.startsWith(failureEnvelopePrefix)) return null
  try {
    return decodeServerFailure(
      JSON.parse(message.slice(failureEnvelopePrefix.length))
    )
  } catch {
    return null
  }
}

export const runtimeFailure = (cause: unknown): ServerFailure => {
  if (isServerFailure(cause)) return cause
  const message = failureMessage(cause, "Workspace runtime failed")
  return parseServerFailure(message) ?? new WorkspaceRuntimeFailure({ message })
}
