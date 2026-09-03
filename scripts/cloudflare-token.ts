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
} from "../tools/wizard/cloudflare-token"

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const required = (name: string) => {
  const value = Bun.env[name] ?? ""
  return value === "" ? fail(`${name} is required`) : value
}

const accountId = required("CLOUDFLARE_ACCOUNT_ID")
const deployToken = required("CLOUDFLARE_API_TOKEN")
const [name = "", permissions = ""] = Bun.argv.slice(2)

if (name === "" || permissions === "") {
  fail(
    "usage: bun scripts/cloudflare-token.ts <token name> <comma-separated permission groups>"
  )
}

const headers = {
  authorization: `Bearer ${deployToken}`,
  "content-type": "application/json",
}

const groupsResponse = await fetch(permissionGroupsUrl(accountId), { headers })
const groups = decodePermissionGroups(await groupsResponse.json())

if (!groups.success || groups.result === null || groups.result === undefined) {
  fail(errorMessage(groups.errors, "Cloudflare did not list permission groups"))
} else {
  const request = tokenRequest(
    accountId,
    name,
    permissionGroupIds(groups.result, permissionNames(permissions))
  )
  const tokenResponse = await fetch(tokensUrl(accountId), {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  })
  const token = decodeToken(await tokenResponse.json())

  if (!token.success || token.result === null || token.result === undefined) {
    fail(errorMessage(token.errors, "Cloudflare did not create the token"))
  } else {
    console.log(
      JSON.stringify({
        id: token.result.id,
        value: token.result.value,
        secretAccessKey: r2SecretAccessKey(token.result.value),
      })
    )
  }
}
