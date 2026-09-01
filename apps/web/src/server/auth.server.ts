import { schema } from "@workspace/db"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { betterAuth } from "better-auth/minimal"
import { magicLink, oAuthProxy, organization } from "better-auth/plugins"
import { drizzle } from "drizzle-orm/d1"

import { canProvisionInstallationAccount } from "@/server/auth-access"

interface OAuthProxyConfiguration {
  productionURL: string
  secret: string
  trustedOrigins: string
}

export const resolveOAuthProxyConfiguration = (
  baseURL: string,
  input: OAuthProxyConfiguration
) => {
  const productionURL = input.productionURL.trim()
  const secret = input.secret.trim()

  if (!productionURL && !secret) {
    return {
      enabled: false as const,
      productionURL: "",
      secret: "",
      trustedOrigins: [baseURL],
    }
  }

  if (!productionURL || !secret) {
    throw new Error(
      "OAUTH_PROXY_URL and OAUTH_PROXY_SECRET must be configured together"
    )
  }

  if (secret.length < 32) {
    throw new Error("OAUTH_PROXY_SECRET must contain at least 32 characters")
  }

  const parsedProductionURL = new URL(productionURL)
  const localProxy = ["localhost", "127.0.0.1", "::1"].includes(
    parsedProductionURL.hostname
  )

  if (parsedProductionURL.protocol !== "https:" && !localProxy) {
    throw new Error("OAUTH_PROXY_URL must use HTTPS")
  }

  if (
    parsedProductionURL.pathname !== "/" ||
    parsedProductionURL.search ||
    parsedProductionURL.hash ||
    parsedProductionURL.username ||
    parsedProductionURL.password
  ) {
    throw new Error("OAUTH_PROXY_URL must contain only an origin")
  }

  const configuredTrustedOrigins = input.trustedOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (configuredTrustedOrigins.length === 0) {
    throw new Error(
      "OAUTH_PROXY_TRUSTED_ORIGINS must include the preview origin pattern"
    )
  }

  const normalizedProductionURL = parsedProductionURL.origin
  const trustedOrigins = [
    baseURL,
    normalizedProductionURL,
    ...configuredTrustedOrigins,
  ].filter(
    (origin, index, origins) => origin && origins.indexOf(origin) === index
  )

  return {
    enabled: true as const,
    productionURL: normalizedProductionURL,
    secret,
    trustedOrigins,
  }
}

export const createOAuthProxyPlugin = (
  baseURL: string,
  input: OAuthProxyConfiguration
) => {
  const configuration = resolveOAuthProxyConfiguration(baseURL, input)

  return {
    plugin: configuration.enabled
      ? oAuthProxy({
          currentURL: baseURL,
          productionURL: configuration.productionURL,
          secret: configuration.secret,
          maxAge: 60,
        })
      : null,
    trustedOrigins: configuration.trustedOrigins,
  }
}

export const createAuth = (
  database: D1Database,
  baseURL: string,
  secret: string,
  githubClientId: string,
  githubClientSecret: string,
  oauthProxy: OAuthProxyConfiguration
) => {
  const drizzleDatabase = drizzle(database, { schema })
  const proxy = createOAuthProxyPlugin(baseURL, oauthProxy)

  return betterAuth({
    baseURL,
    secret,
    trustedOrigins: proxy.trustedOrigins,
    database: drizzleAdapter(drizzleDatabase, {
      provider: "sqlite",
      schema,
    }),
    databaseHooks: {
      user: {
        create: {
          before: async (user) =>
            canProvisionInstallationAccount(database, user.email),
        },
      },
    },
    socialProviders:
      githubClientId && githubClientSecret
        ? {
            github: {
              clientId: githubClientId,
              clientSecret: githubClientSecret,
              scope: ["user:email"],
            },
          }
        : {},
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await drizzleDatabase.insert(schema.magicLinkOutbox).values({
            id: crypto.randomUUID(),
            email,
            url,
          })
        },
        storeToken: "hashed",
      }),
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
      }),
      ...(proxy.plugin ? [proxy.plugin] : []),
    ],
  })
}

export const createRequestAuth = (request: Request, bindings: Cloudflare.Env) =>
  createAuth(
    bindings.DB,
    new URL(request.url).origin,
    bindings.BETTER_AUTH_SECRET,
    bindings.GITHUB_CLIENT_ID,
    bindings.GITHUB_CLIENT_SECRET,
    {
      productionURL: bindings.OAUTH_PROXY_URL,
      secret: bindings.OAUTH_PROXY_SECRET,
      trustedOrigins: bindings.OAUTH_PROXY_TRUSTED_ORIGINS,
    }
  )
