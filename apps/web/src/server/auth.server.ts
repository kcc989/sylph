import { schema } from "@workspace/db"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { betterAuth } from "better-auth/minimal"
import { magicLink, organization } from "better-auth/plugins"
import { drizzle } from "drizzle-orm/d1"

import { canProvisionInstallationAccount } from "@/server/auth-access"

export const createAuth = (
  database: D1Database,
  baseURL: string,
  secret: string,
  githubClientId: string,
  githubClientSecret: string
) => {
  const drizzleDatabase = drizzle(database, { schema })

  return betterAuth({
    baseURL,
    secret,
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
    ],
  })
}

export const createRequestAuth = (request: Request, bindings: Cloudflare.Env) =>
  createAuth(
    bindings.DB,
    new URL(request.url).origin,
    bindings.BETTER_AUTH_SECRET,
    bindings.GITHUB_CLIENT_ID,
    bindings.GITHUB_CLIENT_SECRET
  )
