import { Schema } from "effect"

import { OrganizationId } from "./ids"

export class OrganizationRequestInput extends Schema.Class<OrganizationRequestInput>(
  "@sylph/domain/OrganizationRequestInput"
)({
  organizationId: OrganizationId,
}) {}

export class InstallationClaimInput extends Schema.Class<InstallationClaimInput>(
  "@sylph/domain/InstallationClaimInput"
)({
  claimSecret: Schema.String,
  confirmedEmail: Schema.NonEmptyString,
  organizationName: Schema.NonEmptyString,
}) {}

export class MagicLinkRequest extends Schema.Class<MagicLinkRequest>(
  "@sylph/domain/MagicLinkRequest"
)({
  email: Schema.NonEmptyString,
}) {}

export const InstallationSetupCode = Schema.String.check(
  Schema.isMinLength(32),
  Schema.isMaxLength(256)
)

export class InstallationSetupUnlock extends Schema.Class<InstallationSetupUnlock>(
  "@sylph/domain/InstallationSetupUnlock"
)({
  code: InstallationSetupCode,
}) {}

export class InstallationGithubApp extends Schema.Class<InstallationGithubApp>(
  "@sylph/domain/InstallationGithubApp"
)({
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.NonEmptyString,
  appUrl: Schema.String,
}) {}

export class InstallationGithubManifest extends Schema.Class<InstallationGithubManifest>(
  "@sylph/domain/InstallationGithubManifest"
)({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(34)),
  owner: Schema.String.check(Schema.isMaxLength(100)),
}) {}

export class InstallationSetupFailure extends Schema.TaggedError<InstallationSetupFailure>()(
  "InstallationSetupFailure",
  {
    message: Schema.String,
    status: Schema.Number,
  }
) {}

export const InstallationSetupStatus = Schema.Struct({
  claimed: Schema.Boolean,
  unlocked: Schema.Boolean,
  githubConnected: Schema.Boolean,
  appUrl: Schema.String,
  origin: Schema.String,
})

export const InstallationSetupErrorResponse = Schema.Struct({
  message: Schema.String,
})
