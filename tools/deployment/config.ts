import { Schema } from "effect"

export const normalizeDomain = (value: string) => {
  const domain = value.trim().toLowerCase()
  if (!domain) return ""
  if (
    domain.length > 253 ||
    !domain.includes(".") ||
    !domain
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    domain.endsWith(".workers.dev")
  ) {
    throw new Error(
      "SYLPH_DOMAIN must be a hostname such as sylph.example.com. Leave it empty for workers.dev."
    )
  }
  return domain
}

export const DeploymentConfiguration = Schema.Struct({
  accountId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
  token: Schema.NonEmptyString,
  setupCode: Schema.String.check(
    Schema.isMinLength(32),
    Schema.isMaxLength(256)
  ),
  domain: Schema.String,
})

const Envelope = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Unknown,
})
const Subdomain = Schema.Struct({ subdomain: Schema.NullOr(Schema.String) })
const Zones = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    status: Schema.String,
  })
)
const Token = Schema.Struct({ status: Schema.String })
const Records = Schema.Array(Schema.Struct({ type: Schema.String }))

export const checkDeployment = async (
  input: typeof DeploymentConfiguration.Type,
  request: (url: string, init?: RequestInit) => Promise<Response> = fetch
) => {
  Schema.decodeUnknownSync(DeploymentConfiguration)(input)
  const domain = normalizeDomain(input.domain)
  const account = `/accounts/${input.accountId}`
  const get = async (path: string, label: string) => {
    const response = await request(
      `https://api.cloudflare.com/client/v4${path}`,
      { headers: { authorization: `Bearer ${input.token}` } }
    )
    if (!response.ok)
      throw new Error(
        `${label}: Cloudflare returned HTTP ${response.status}. Check account access and token permissions, then rerun deployment.`
      )
    const body = Schema.decodeUnknownSync(Envelope)(await response.json())
    if (!body.success)
      throw new Error(
        `${label}: Cloudflare rejected the request. Check account access and token permissions.`
      )
    return body.result
  }
  const token = Schema.decodeUnknownSync(Token)(
    await get(`${account}/tokens/verify`, "Deploy token")
  )
  if (token.status !== "active")
    throw new Error("The Cloudflare deploy token is not active")
  const subdomain = Schema.decodeUnknownSync(Subdomain)(
    await get(`${account}/workers/subdomain`, "workers.dev address")
  )
  if (!subdomain.subdomain)
    throw new Error(
      "Register a workers.dev subdomain under Cloudflare Workers & Pages, then rerun deployment"
    )
  await get(`${account}/r2/buckets`, "R2 storage")
  await get(`${account}/artifacts/namespaces`, "Artifacts access")
  if (domain) {
    let zone: (typeof Zones.Type)[number] | undefined
    const labels = domain.split(".")
    for (let index = 0; index < labels.length - 1; index += 1) {
      const name = labels.slice(index).join(".")
      const zones = Schema.decodeUnknownSync(Zones)(
        await get(
          `/zones?account.id=${input.accountId}&name=${encodeURIComponent(name)}`,
          "Custom domain zone"
        )
      )
      zone = zones.find(
        (candidate) => candidate.name === name && candidate.status === "active"
      )
      if (zone) break
    }
    if (!zone)
      throw new Error(
        "SYLPH_DOMAIN needs an active zone in this Cloudflare account. Add the zone or leave SYLPH_DOMAIN empty."
      )
    const records = Schema.decodeUnknownSync(Records)(
      await get(
        `/zones/${zone.id}/dns_records?name=${encodeURIComponent(domain)}&type=CNAME`,
        "Custom domain DNS"
      )
    )
    if (records.length)
      throw new Error(
        "The custom hostname already has a CNAME record. Choose an unused hostname or remove the conflicting record before deploying."
      )
  }
  return { domain, subdomain: subdomain.subdomain }
}
