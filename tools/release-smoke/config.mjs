import { parseEnv } from "node:util"
import { homedir } from "node:os"
import { resolve } from "node:path"

export const configurationPath = (environment) =>
  resolve(
    environment.SYLPH_SMOKE_ENV_FILE ||
      `${environment.XDG_CONFIG_HOME || `${homedir()}/.config`}/sylph/release-smoke.env`
  )

export function smokeConfiguration(source, path, auth) {
  const values = parseEnv(source)
  if (!["github", "magic"].includes(auth)) {
    throw new Error("Use --auth github or --auth magic")
  }
  if (
    values.OAUTH_PROXY &&
    values.OAUTH_PROXY_URL &&
    values.OAUTH_PROXY !== values.OAUTH_PROXY_URL
  ) {
    throw new Error(
      "OAUTH_PROXY and OAUTH_PROXY_URL conflict; keep only OAUTH_PROXY_URL"
    )
  }
  values.OAUTH_PROXY_URL ||= values.OAUTH_PROXY || ""
  delete values.OAUTH_PROXY
  values.SYLPH_SMOKE_AUTH_MODE = auth
  values.SYLPH_SMOKE_AUTH_STATE ||= resolve(path, "../release-smoke-auth.json")
  const required = [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CF_TOKEN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "BETTER_AUTH_SECRET",
    "CREDENTIAL_ENCRYPTION_KEY",
    "INSTALLATION_CLAIM_SECRET",
  ]
  if (auth === "github") {
    required.push(
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "OAUTH_PROXY_URL",
      "OAUTH_PROXY_SECRET",
      "OAUTH_PROXY_TRUSTED_ORIGINS"
    )
  } else {
    for (const name of [
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "OAUTH_PROXY_URL",
      "OAUTH_PROXY_SECRET",
      "OAUTH_PROXY_TRUSTED_ORIGINS",
    ])
      values[name] = ""
  }
  values.ALLOW_TEST_MAGIC_LINKS = auth === "magic" ? "true" : "false"
  const missing = required.filter((name) => !values[name]?.trim())
  if (missing.length)
    throw new Error(`Missing in ${path}: ${missing.join(", ")}`)
  for (const name of [
    "BETTER_AUTH_SECRET",
    "CREDENTIAL_ENCRYPTION_KEY",
    "INSTALLATION_CLAIM_SECRET",
    ...(auth === "github" ? ["OAUTH_PROXY_SECRET"] : []),
  ]) {
    if (values[name].length < 32)
      throw new Error(`${name} must have at least 32 characters`)
  }
  if (auth === "github") {
    const url = new URL(values.OAUTH_PROXY_URL)
    if (url.protocol !== "https:" || url.origin !== values.OAUTH_PROXY_URL)
      throw new Error(
        "OAUTH_PROXY_URL must be an HTTPS origin without a trailing slash"
      )
  }
  return values
}

export function serializeEnvironment(values) {
  return (
    Object.entries(values)
      .map(([name, value]) => {
        if (/[\r\n"\\]/.test(value))
          throw new Error(`${name} contains unsupported dotenv characters`)
        return `${name}="${value}"`
      })
      .join("\n") + "\n"
  )
}

export function requireSmokeStage(stage) {
  if (!/^smoke-[a-z0-9-]{1,45}$/.test(stage))
    throw new Error(
      "Stage must start with smoke- and contain only lowercase letters, digits, and hyphens (51 characters maximum)"
    )
  return stage
}

export function deployedWebsite(output) {
  const matches = [...output.matchAll(/websiteUrl[^h]*(https:[^'"\s,}]+)/g)]
  const match = matches.at(-1)
  if (!match)
    throw new Error(
      "Alchemy did not report websiteUrl; inspect the deployment before retrying"
    )
  return new URL(match[1]).origin
}

export function githubSessionAvailable(state, now = Date.now() / 1000) {
  return (
    state.cookies?.some(
      (cookie) =>
        ["github.com", ".github.com"].includes(cookie.domain) &&
        cookie.name === "user_session" &&
        (cookie.expires === -1 || cookie.expires > now)
    ) === true
  )
}

export function requireOpenRouterCredit(data) {
  if (Number.isFinite(data.limit_remaining) && data.limit_remaining <= 0) {
    throw new Error(
      "OpenRouter key spending limit is exhausted. Increase its limit or use a funded test key before running the browser suite."
    )
  }
  if (
    Number.isFinite(data.total_credits) &&
    Number.isFinite(data.total_usage) &&
    data.total_credits <= data.total_usage
  ) {
    throw new Error(
      "OpenRouter account has insufficient credits. Add credits or use a funded test key before running the browser suite."
    )
  }
}

export function requireBrowserConfiguration(configuration) {
  const missing = ["SYLPH_SMOKE_ADMIN_EMAIL", "OPENROUTER_API_KEY"].filter(
    (name) => !configuration[name]?.trim()
  )
  if (missing.length)
    throw new Error(`Missing browser-test configuration: ${missing.join(", ")}`)
}

export function reuseGitHubConfiguration(source, githubSource) {
  const values = parseEnv(source)
  const existing = parseEnv(githubSource)
  if (
    values.GITHUB_CLIENT_ID &&
    existing.GITHUB_CLIENT_ID &&
    values.GITHUB_CLIENT_ID !== existing.GITHUB_CLIENT_ID &&
    !values.GITHUB_CLIENT_SECRET
  ) {
    throw new Error(
      "The existing configuration belongs to a different GitHub App; cannot reuse its client secret"
    )
  }
  for (const name of [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "OAUTH_PROXY_URL",
    "OAUTH_PROXY_SECRET",
    "OAUTH_PROXY_TRUSTED_ORIGINS",
  ]) {
    if (name === "OAUTH_PROXY_URL" && values.OAUTH_PROXY) continue
    values[name] ||=
      existing[name] ||
      (name === "OAUTH_PROXY_URL" ? existing.OAUTH_PROXY : "") ||
      ""
  }
  return serializeEnvironment(values)
}
