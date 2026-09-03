import { createHash } from "node:crypto"
import { Schema } from "effect"

const ApiError = Schema.Struct({ message: Schema.String })

const PermissionGroup = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

export type PermissionGroup = typeof PermissionGroup.Type

const PermissionGroupsResponse = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.optional(Schema.NullOr(Schema.Array(PermissionGroup))),
  errors: Schema.optional(Schema.NullOr(Schema.Array(ApiError))),
})

const TokenResponse = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.optional(
    Schema.NullOr(Schema.Struct({ id: Schema.String, value: Schema.String }))
  ),
  errors: Schema.optional(Schema.NullOr(Schema.Array(ApiError))),
})

export const decodePermissionGroups = Schema.decodeUnknownSync(
  PermissionGroupsResponse
)

export const decodeToken = Schema.decodeUnknownSync(TokenResponse)

export const errorMessage = (
  errors: ReadonlyArray<{ readonly message: string }> | null | undefined,
  fallback: string
) =>
  errors !== null && errors !== undefined && errors.length > 0
    ? errors.map((error) => error.message).join("; ")
    : fallback

export const permissionGroupIds = (
  groups: ReadonlyArray<PermissionGroup>,
  names: ReadonlyArray<string>
) =>
  names.map((name) => {
    const group = groups.find((candidate) => candidate.name === name)
    if (group === undefined) {
      throw new Error(
        `Cloudflare has no account permission group named "${name}"`
      )
    }
    return group.id
  })

export const permissionNames = (list: string) =>
  list
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")

export const tokenRequest = (
  accountId: string,
  name: string,
  groupIds: ReadonlyArray<string>
) => ({
  name,
  policies: [
    {
      effect: "allow",
      resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
      permission_groups: groupIds.map((id) => ({ id })),
    },
  ],
})

export const r2SecretAccessKey = (tokenValue: string) =>
  createHash("sha256").update(tokenValue).digest("hex")

const accountUrl = (accountId: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`

export const permissionGroupsUrl = (accountId: string) =>
  `${accountUrl(accountId)}/tokens/permission_groups?scope=com.cloudflare.api.account`

export const tokensUrl = (accountId: string) =>
  `${accountUrl(accountId)}/tokens`
