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
  claimSecret: Schema.NonEmptyString,
  confirmedEmail: Schema.NonEmptyString,
  organizationName: Schema.NonEmptyString,
}) {}

export class MagicLinkRequest extends Schema.Class<MagicLinkRequest>(
  "@sylph/domain/MagicLinkRequest"
)({
  email: Schema.NonEmptyString,
}) {}
