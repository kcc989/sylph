import { expect, test } from "bun:test"
import { parseEnv } from "node:util"
import {
  smokeConfiguration,
  serializeEnvironment,
  requireSmokeStage,
  deployedWebsite,
  githubSessionAvailable,
  requireOpenRouterCredit,
  requireBrowserConfiguration,
  reuseGitHubConfiguration,
} from "./config.mjs"

const credentials = Object.fromEntries(
  [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "CF_TOKEN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "BETTER_AUTH_SECRET",
    "CREDENTIAL_ENCRYPTION_KEY",
    "INSTALLATION_CLAIM_SECRET",
    "SYLPH_SMOKE_ADMIN_EMAIL",
    "OPENROUTER_API_KEY",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "OAUTH_PROXY_SECRET",
    "OAUTH_PROXY_TRUSTED_ORIGINS",
  ].map((name) => [name, "a".repeat(32)])
)

test("legacy proxy name works without changing the stored file", () => {
  const source = serializeEnvironment({
    ...credentials,
    OAUTH_PROXY: "https://proxy.example",
  })
  expect(
    smokeConfiguration(source, "/tmp/smoke.env", "github").OAUTH_PROXY_URL
  ).toBe("https://proxy.example")
})

test("conflicting proxy aliases fail before deployment", () => {
  expect(() =>
    smokeConfiguration(
      serializeEnvironment({
        ...credentials,
        OAUTH_PROXY: "https://a.example",
        OAUTH_PROXY_URL: "https://b.example",
      }),
      "/tmp/smoke.env",
      "github"
    )
  ).toThrow("conflict")
})

test("magic mode removes partial OAuth configuration", () => {
  const config = smokeConfiguration(
    serializeEnvironment(credentials),
    "/tmp/smoke.env",
    "magic"
  )
  expect(config.OAUTH_PROXY_SECRET).toBe("")
  expect(config.GITHUB_CLIENT_SECRET).toBe("")
  expect(config.ALLOW_TEST_MAGIC_LINKS).toBe("true")
})

test("missing GitHub credentials fail with key names only", () => {
  expect(() =>
    smokeConfiguration(
      serializeEnvironment({ ...credentials, GITHUB_CLIENT_SECRET: "" }),
      "/tmp/smoke.env",
      "github"
    )
  ).toThrow("GITHUB_CLIENT_SECRET")
})

test("dotenv values retain spaces, hash signs, and shell syntax without evaluation", () => {
  const value = "secret # $(touch /tmp/should-not-exist) `echo hi`"
  expect(parseEnv(serializeEnvironment({ TOKEN: value })).TOKEN).toBe(value)
})

test("production and arbitrary stages cannot enter smoke deployment", () => {
  for (const stage of ["prod", "production", "release-smoke", "smoke-../prod"])
    expect(() => requireSmokeStage(stage)).toThrow()
  expect(requireSmokeStage("smoke-example-123")).toBe("smoke-example-123")
})

test("website output selects the last explicit websiteUrl", () => {
  expect(
    deployedWebsite(
      "other: https://wrong.example\nwebsiteUrl: 'https://right.example',"
    )
  ).toBe("https://right.example")
  expect(() => deployedWebsite("https://wrong.example")).toThrow()
})

test("old Sylph cookies and expired GitHub sessions do not count as GitHub login", () => {
  expect(
    githubSessionAvailable({
      cookies: [{ domain: "sylph.example", name: "user_session", expires: -1 }],
    })
  ).toBe(false)
  expect(
    githubSessionAvailable(
      {
        cookies: [{ domain: ".github.com", name: "user_session", expires: 10 }],
      },
      20
    )
  ).toBe(false)
  expect(
    githubSessionAvailable(
      {
        cookies: [{ domain: ".github.com", name: "user_session", expires: 30 }],
      },
      20
    )
  ).toBe(true)
})

test("unlimited keys do not imply a funded account", () => {
  expect(() => requireOpenRouterCredit({ limit_remaining: null })).not.toThrow()
  expect(() =>
    requireOpenRouterCredit({ total_credits: 160, total_usage: 163.2 })
  ).toThrow("insufficient credits")
  expect(() =>
    requireOpenRouterCredit({ total_credits: 10, total_usage: 10 })
  ).toThrow("insufficient credits")
  expect(() => requireOpenRouterCredit({ limit_remaining: 0 })).toThrow(
    "spending limit"
  )
  expect(() =>
    requireOpenRouterCredit({ total_credits: 10, total_usage: 2 })
  ).not.toThrow()
})

test("deployment does not require browser identity or provider credentials", () => {
  const source = serializeEnvironment({
    ...credentials,
    SYLPH_SMOKE_ADMIN_EMAIL: "",
    OPENROUTER_API_KEY: "",
  })
  const config = smokeConfiguration(source, "/tmp/smoke.env", "magic")
  expect(config.ALLOW_TEST_MAGIC_LINKS).toBe("true")
  expect(() => requireBrowserConfiguration(config)).toThrow(
    "browser-test configuration"
  )
})

test("existing GitHub App settings fill only missing OAuth values", () => {
  const merged = parseEnv(
    reuseGitHubConfiguration(
      "GITHUB_CLIENT_ID=smoke-app\nCLOUDFLARE_ACCOUNT_ID=smoke-account\nOAUTH_PROXY=https://smoke.example",
      "GITHUB_CLIENT_ID=smoke-app\nGITHUB_CLIENT_SECRET=existing-secret\nCLOUDFLARE_ACCOUNT_ID=production-account\nOAUTH_PROXY_URL=https://production.example"
    )
  )
  expect(merged.GITHUB_CLIENT_ID).toBe("smoke-app")
  expect(merged.GITHUB_CLIENT_SECRET).toBe("existing-secret")
  expect(merged.CLOUDFLARE_ACCOUNT_ID).toBe("smoke-account")
  expect(merged.OAUTH_PROXY_URL).toBeUndefined()
})

test("a different GitHub App cannot supply the missing client secret", () => {
  expect(() =>
    reuseGitHubConfiguration(
      "GITHUB_CLIENT_ID=smoke-app",
      "GITHUB_CLIENT_ID=another-app\nGITHUB_CLIENT_SECRET=another-secret"
    )
  ).toThrow("different GitHub App")
})
