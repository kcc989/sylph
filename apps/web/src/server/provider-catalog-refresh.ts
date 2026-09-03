import { schema } from "@workspace/db"
import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"

import { fetchOpenCodeProviderModels } from "@/lib/provider-catalog"
import {
  replaceOrganizationProviderModels,
  replaceUserProviderModels,
} from "@/server/provider-connections"

export const refreshProviderCatalogs = async () => {
  const providerId = "openrouter"
  const database = drizzle(env.DB, { schema })
  const models = await fetchOpenCodeProviderModels(providerId)
  const [organizationConnections, userConnections] = await Promise.all([
    database
      .select({ organizationId: schema.openCodeConnection.organizationId })
      .from(schema.openCodeConnection)
      .where(eq(schema.openCodeConnection.providerId, providerId)),
    database
      .select({ userId: schema.userOpenCodeConnection.userId })
      .from(schema.userOpenCodeConnection)
      .where(eq(schema.userOpenCodeConnection.providerId, providerId)),
  ])

  for (const connection of organizationConnections) {
    await replaceOrganizationProviderModels({
      database,
      organizationId: connection.organizationId,
      providerId,
      models,
    })
  }
  for (const connection of userConnections) {
    await replaceUserProviderModels({
      database,
      userId: connection.userId,
      providerId,
      models,
    })
  }

  return {
    modelCount: models.length,
    connectionCount: organizationConnections.length + userConnections.length,
  }
}
