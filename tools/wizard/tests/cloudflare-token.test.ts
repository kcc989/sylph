import { expect, test } from "bun:test"
import {
  decodePermissionGroups,
  decodeToken,
  errorMessage,
  permissionGroupIds,
  permissionGroupsUrl,
  permissionNames,
  r2SecretAccessKey,
  tokenRequest,
  tokensUrl,
} from "../cloudflare-token"

const groups = [
  { id: "g1", name: "Workers Scripts Write" },
  { id: "g2", name: "Workers R2 Storage Write" },
]

test("permission names are resolved to group IDs in order", () => {
  expect(
    permissionGroupIds(groups, [
      "Workers R2 Storage Write",
      "Workers Scripts Write",
    ])
  ).toEqual(["g2", "g1"])
  expect(() => permissionGroupIds(groups, ["Containers Write"])).toThrow(
    'no account permission group named "Containers Write"'
  )
})

test("permission lists are split and trimmed", () => {
  expect(permissionNames(" Workers Scripts Write, D1 Write ,")).toEqual([
    "Workers Scripts Write",
    "D1 Write",
  ])
})

test("the token request scopes every permission to one account", () => {
  const request = tokenRequest("acct", "Sylph runtime", ["g1", "g2"])

  expect(request.name).toBe("Sylph runtime")
  expect(request.policies).toEqual([
    {
      effect: "allow",
      resources: { "com.cloudflare.api.account.acct": "*" },
      permission_groups: [{ id: "g1" }, { id: "g2" }],
    },
  ])
})

test("the R2 secret access key is the SHA-256 of the token value", () => {
  expect(r2SecretAccessKey("token")).toBe(
    "3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0"
  )
})

test("responses are validated and errors are summarized", () => {
  const listed = decodePermissionGroups({ success: true, result: groups })
  expect(listed.result).toEqual(groups)

  const created = decodeToken({
    success: true,
    result: { id: "id", value: "value", status: "active" },
  })
  expect(created.result?.value).toBe("value")

  const failed = decodeToken({
    success: false,
    result: null,
    errors: [
      { code: 9109, message: "Unauthorized to access requested resource" },
    ],
  })
  expect(errorMessage(failed.errors, "fallback")).toBe(
    "Unauthorized to access requested resource"
  )
  expect(errorMessage([], "fallback")).toBe("fallback")
  expect(errorMessage(undefined, "fallback")).toBe("fallback")
})

test("account URLs encode the account ID", () => {
  expect(permissionGroupsUrl("a/b")).toBe(
    "https://api.cloudflare.com/client/v4/accounts/a%2Fb/tokens/permission_groups?scope=com.cloudflare.api.account"
  )
  expect(tokensUrl("acct")).toBe(
    "https://api.cloudflare.com/client/v4/accounts/acct/tokens"
  )
})
