import { Schema } from "effect"

export const AccessDeniedResource = Schema.Literals([
  "installation",
  "organization",
  "project",
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
