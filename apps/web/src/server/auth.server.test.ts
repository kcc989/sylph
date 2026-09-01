import { describe, expect, test } from "bun:test"

import {
  createOAuthProxyPlugin,
  resolveOAuthProxyConfiguration,
} from "./auth.server"

describe("OAuth proxy configuration", () => {
  test("keeps direct OAuth when proxy configuration is absent", () => {
    expect(
      resolveOAuthProxyConfiguration("https://branch.example.com", {
        productionURL: "",
        secret: "",
        trustedOrigins: "",
      })
    ).toEqual({
      enabled: false,
      productionURL: "",
      secret: "",
      trustedOrigins: ["https://branch.example.com"],
    })
  })

  test("normalizes the proxy and deduplicates trusted origins", () => {
    expect(
      resolveOAuthProxyConfiguration("https://branch.example.com", {
        productionURL: "https://auth.example.com/",
        secret: "a".repeat(32),
        trustedOrigins:
          "https://*.preview.example.com, https://auth.example.com",
      })
    ).toEqual({
      enabled: true,
      productionURL: "https://auth.example.com",
      secret: "a".repeat(32),
      trustedOrigins: [
        "https://branch.example.com",
        "https://auth.example.com",
        "https://*.preview.example.com",
      ],
    })
  })

  test("requires the proxy URL and secret together", () => {
    expect(() =>
      resolveOAuthProxyConfiguration("https://branch.example.com", {
        productionURL: "https://auth.example.com",
        secret: "",
        trustedOrigins: "",
      })
    ).toThrow("OAUTH_PROXY_URL and OAUTH_PROXY_SECRET")
  })

  test("rejects a short shared secret", () => {
    expect(() =>
      resolveOAuthProxyConfiguration("https://branch.example.com", {
        productionURL: "https://auth.example.com",
        secret: "too-short",
        trustedOrigins: "",
      })
    ).toThrow("at least 32 characters")
  })

  test("requires a trusted preview origin", () => {
    expect(() =>
      resolveOAuthProxyConfiguration("https://branch.example.com", {
        productionURL: "https://auth.example.com",
        secret: "a".repeat(32),
        trustedOrigins: "",
      })
    ).toThrow("OAUTH_PROXY_TRUSTED_ORIGINS")
  })

  test("rejects an insecure remote proxy", () => {
    expect(() =>
      resolveOAuthProxyConfiguration("https://branch.example.com", {
        productionURL: "http://auth.example.com",
        secret: "a".repeat(32),
        trustedOrigins: "https://*.preview.example.com",
      })
    ).toThrow("must use HTTPS")
  })

  test("installs the OAuth proxy plugin when configured", () => {
    const proxy = createOAuthProxyPlugin("https://branch.example.com", {
      productionURL: "https://auth.example.com",
      secret: "oauth-proxy-shared-secret-0123456789abcdef",
      trustedOrigins: "https://*.preview.example.com",
    })

    expect(proxy.plugin?.id).toBe("oauth-proxy")
    expect(proxy.trustedOrigins).toEqual([
      "https://branch.example.com",
      "https://auth.example.com",
      "https://*.preview.example.com",
    ])
  })
})
