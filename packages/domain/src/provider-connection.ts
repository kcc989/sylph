import { Schema } from "effect"

import { OrganizationId } from "./ids"

export const OpenCodeAuthMethod = Schema.Literals([
  "api-key",
  "chatgpt-subscription",
  "cursor-subscription",
])
export type OpenCodeAuthMethod = typeof OpenCodeAuthMethod.Type

export const OpenCodeKeyProviderId = Schema.Literals([
  "openai",
  "openrouter",
  "cloudflare-workers-ai",
  "anthropic",
  "opencode",
])
export type OpenCodeKeyProviderId = typeof OpenCodeKeyProviderId.Type

export const OpenCodeKeyConfiguration = Schema.Record(
  Schema.String,
  Schema.Union([
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Array(Schema.String),
  ])
)
export type OpenCodeKeyConfiguration = typeof OpenCodeKeyConfiguration.Type

export const OpenCodeCredential = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("key"),
    key: Schema.NonEmptyString,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    configuration: Schema.optional(OpenCodeKeyConfiguration),
  }),
  Schema.Struct({
    type: Schema.Literal("oauth"),
    methodID: Schema.NonEmptyString,
    refresh: Schema.NonEmptyString,
    access: Schema.NonEmptyString,
    expires: Schema.Int,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
])
export type OpenCodeCredential = typeof OpenCodeCredential.Type

export const ConnectionScope = Schema.Literals(["organization", "user"])
export type ConnectionScope = typeof ConnectionScope.Type

export class ModelSelection extends Schema.Class<ModelSelection>(
  "@sylph/domain/ModelSelection"
)({
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
  variant: Schema.optional(Schema.NonEmptyString),
}) {}

export class ProviderModel extends Schema.Class<ProviderModel>(
  "@sylph/domain/ProviderModel"
)({
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  variants: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
}) {}

export class OpenCodeConnectionResult extends Schema.Class<OpenCodeConnectionResult>(
  "@sylph/domain/OpenCodeConnectionResult"
)({
  models: Schema.Array(ProviderModel),
  recommendedModelId: Schema.NullOr(Schema.NonEmptyString),
}) {}

export class OpenCodeKeySetupInput extends Schema.Class<OpenCodeKeySetupInput>(
  "@sylph/domain/OpenCodeKeySetupInput"
)({
  organizationId: OrganizationId,
  scope: ConnectionScope,
  providerId: OpenCodeKeyProviderId,
  apiKey: Schema.NonEmptyString,
  configuration: Schema.optional(OpenCodeKeyConfiguration),
}) {}

export class SetDefaultModelInput extends Schema.Class<SetDefaultModelInput>(
  "@sylph/domain/SetDefaultModelInput"
)({
  organizationId: OrganizationId,
  scope: ConnectionScope,
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
}) {}

export class DisconnectOpenCodeConnectionInput extends Schema.Class<DisconnectOpenCodeConnectionInput>(
  "@sylph/domain/DisconnectOpenCodeConnectionInput"
)({
  organizationId: OrganizationId,
  scope: ConnectionScope,
  providerId: Schema.NonEmptyString,
}) {}

export class OpenCodeSubscriptionStartInput extends Schema.Class<OpenCodeSubscriptionStartInput>(
  "@sylph/domain/OpenCodeSubscriptionStartInput"
)({
  organizationId: OrganizationId,
  scope: ConnectionScope,
}) {}

export class OpenCodeSubscriptionStatusInput extends Schema.Class<OpenCodeSubscriptionStatusInput>(
  "@sylph/domain/OpenCodeSubscriptionStatusInput"
)({
  organizationId: OrganizationId,
  scope: ConnectionScope,
  attemptId: Schema.NonEmptyString,
}) {}

export class OpenCodeSubscriptionAttempt extends Schema.Class<OpenCodeSubscriptionAttempt>(
  "@sylph/domain/OpenCodeSubscriptionAttempt"
)({
  attemptId: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  instructions: Schema.NonEmptyString,
  expiresAt: Schema.Number,
}) {}

export class OpenCodeSubscriptionStatus extends Schema.Class<OpenCodeSubscriptionStatus>(
  "@sylph/domain/OpenCodeSubscriptionStatus"
)({
  status: Schema.Literals(["pending", "complete", "failed", "expired"]),
  message: Schema.optional(Schema.String),
}) {}

export class OpenCodeSubscriptionRuntimeStatus extends Schema.Class<OpenCodeSubscriptionRuntimeStatus>(
  "@sylph/domain/OpenCodeSubscriptionRuntimeStatus"
)({
  status: Schema.Literals(["pending", "complete", "failed", "expired"]),
  message: Schema.optional(Schema.String),
  credential: Schema.optional(OpenCodeCredential),
  models: Schema.optional(Schema.Array(ProviderModel)),
  recommendedModelId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
}) {}
