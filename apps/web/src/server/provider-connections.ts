import { schema } from "@workspace/db"
import type { ConnectionScope } from "@workspace/domain"
import { env } from "cloudflare:workers"
import { and, eq } from "drizzle-orm"

import {
  providerName,
  resolveModelSelection,
  type AvailableModel,
  type SelectedModel,
} from "@/lib/model-selection"
import { decodeStoredCredential } from "@/lib/provider-credential"
import {
  normalizeProviderModels,
  selectInitialProviderModel,
} from "@/lib/provider-models"
import { decryptCredential } from "@/server/credentials.server"
import type { Database } from "@/server/organization-access"

export const subscriptionProviderId = "openai"

const modelKey = (model: { providerId: string; modelId: string }) =>
  `${model.providerId} ${model.modelId}`

export const connectionRuntimeName = (
  organizationId: string,
  userId: string,
  scope: ConnectionScope
) =>
  scope === "organization"
    ? `opencode-setup-organization-${organizationId}`
    : `opencode-setup-user-${userId}`

export const effectiveConnection = async (
  database: Database,
  organizationId: string,
  userId: string,
  conversation?: SelectedModel | null
) => {
  const [
    personalModels,
    organizationModels,
    personalPreference,
    organizationPreference,
    personalConnections,
    organizationConnections,
  ] = await Promise.all([
    database
      .select({
        providerId: schema.userProviderModel.providerId,
        modelId: schema.userProviderModel.modelId,
        name: schema.userProviderModel.name,
      })
      .from(schema.userProviderModel)
      .where(eq(schema.userProviderModel.userId, userId)),
    database
      .select({
        providerId: schema.organizationProviderModel.providerId,
        modelId: schema.organizationProviderModel.modelId,
        name: schema.organizationProviderModel.name,
      })
      .from(schema.organizationProviderModel)
      .where(
        eq(schema.organizationProviderModel.organizationId, organizationId)
      ),
    database
      .select({
        providerId: schema.userModelPreference.providerId,
        modelId: schema.userModelPreference.modelId,
      })
      .from(schema.userModelPreference)
      .where(eq(schema.userModelPreference.userId, userId))
      .get(),
    database
      .select({
        providerId: schema.organizationModelPreference.providerId,
        modelId: schema.organizationModelPreference.modelId,
      })
      .from(schema.organizationModelPreference)
      .where(
        eq(schema.organizationModelPreference.organizationId, organizationId)
      )
      .get(),
    database
      .select({
        providerId: schema.userOpenCodeConnection.providerId,
        authMethod: schema.userOpenCodeConnection.authMethod,
      })
      .from(schema.userOpenCodeConnection)
      .where(eq(schema.userOpenCodeConnection.userId, userId)),
    database
      .select({
        providerId: schema.openCodeConnection.providerId,
        authMethod: schema.openCodeConnection.authMethod,
      })
      .from(schema.openCodeConnection)
      .where(eq(schema.openCodeConnection.organizationId, organizationId)),
  ])

  const personalRuntimeProviders = new Set(
    personalConnections
      .filter((connection) => connection.authMethod !== "chatgpt-subscription")
      .map((connection) => connection.providerId)
  )
  const organizationRuntimeProviders = new Set(
    organizationConnections
      .filter((connection) => connection.authMethod !== "chatgpt-subscription")
      .map((connection) => connection.providerId)
  )
  const personalKeys = new Set(
    personalModels
      .filter((model) => personalRuntimeProviders.has(model.providerId))
      .map(modelKey)
  )
  const models: AvailableModel[] = [
    ...personalModels
      .filter((model) => personalRuntimeProviders.has(model.providerId))
      .map((model) => ({
        ...model,
        providerName: providerName(model.providerId),
        scope: "personal" as const,
      })),
    ...organizationModels
      .filter(
        (model) =>
          organizationRuntimeProviders.has(model.providerId) &&
          !personalKeys.has(modelKey(model))
      )
      .map((model) => ({
        ...model,
        providerName: providerName(model.providerId),
        scope: "organization" as const,
      })),
  ].sort((left, right) =>
    `${left.providerName} ${left.name}`.localeCompare(
      `${right.providerName} ${right.name}`
    )
  )
  const resolution = resolveModelSelection({
    models,
    conversation,
    personal: personalPreference,
    organization: organizationPreference,
  })

  if (!resolution.model) return null

  const personal =
    resolution.model.scope === "personal"
      ? await database
          .select()
          .from(schema.userOpenCodeConnection)
          .where(
            and(
              eq(schema.userOpenCodeConnection.userId, userId),
              eq(
                schema.userOpenCodeConnection.providerId,
                resolution.model.providerId
              )
            )
          )
          .get()
      : null

  if (personal) {
    return {
      ...personal,
      modelId: resolution.model.modelId,
      modelName: resolution.model.name,
      models,
      notice: resolution.notice,
    }
  }

  const organization = await database
    .select()
    .from(schema.openCodeConnection)
    .where(
      and(
        eq(schema.openCodeConnection.organizationId, organizationId),
        eq(schema.openCodeConnection.providerId, resolution.model.providerId)
      )
    )
    .get()

  return organization
    ? {
        ...organization,
        modelId: resolution.model.modelId,
        modelName: resolution.model.name,
        models,
        notice: resolution.notice,
      }
    : null
}

export type EffectiveConnection = NonNullable<
  Awaited<ReturnType<typeof effectiveConnection>>
>

const providerModelBatches = (
  models: ReadonlyArray<{ providerId: string; modelId: string; name: string }>
) =>
  Array.from({ length: Math.ceil(models.length / 20) }, (_, index) =>
    models.slice(index * 20, index * 20 + 20)
  )

export const replaceOrganizationProviderModels = async ({
  database,
  organizationId,
  providerId,
  models,
}: {
  database: Database
  organizationId: string
  providerId: string
  models: ReadonlyArray<{ providerId: string; modelId: string; name: string }>
}) => {
  await database
    .delete(schema.organizationProviderModel)
    .where(
      and(
        eq(schema.organizationProviderModel.organizationId, organizationId),
        eq(schema.organizationProviderModel.providerId, providerId)
      )
    )
  for (const batch of providerModelBatches(models)) {
    await database.insert(schema.organizationProviderModel).values(
      batch.map((model) => ({
        organizationId,
        providerId: model.providerId,
        modelId: model.modelId,
        name: model.name,
      }))
    )
  }
}

export const replaceUserProviderModels = async ({
  database,
  userId,
  providerId,
  models,
}: {
  database: Database
  userId: string
  providerId: string
  models: ReadonlyArray<{ providerId: string; modelId: string; name: string }>
}) => {
  await database
    .delete(schema.userProviderModel)
    .where(
      and(
        eq(schema.userProviderModel.userId, userId),
        eq(schema.userProviderModel.providerId, providerId)
      )
    )
  for (const batch of providerModelBatches(models)) {
    await database.insert(schema.userProviderModel).values(
      batch.map((model) => ({
        userId,
        providerId: model.providerId,
        modelId: model.modelId,
        name: model.name,
      }))
    )
  }
}

export const connectionCredential = async (connection: {
  authMethod: string
  encryptedCredential: string
  encryptionIv: string
}) => {
  const plaintext = await decryptCredential(
    connection.encryptedCredential,
    connection.encryptionIv,
    env.CREDENTIAL_ENCRYPTION_KEY
  )

  return decodeStoredCredential(connection.authMethod, plaintext)
}

export const saveProviderModels = async ({
  database,
  organizationId,
  userId,
  scope,
  providerId,
  models,
  recommendedModelId,
}: {
  database: Database
  organizationId: string
  userId: string
  scope: ConnectionScope
  providerId: string
  models: ReadonlyArray<{ providerId: string; modelId: string; name: string }>
  recommendedModelId: string | null
}) => {
  const providerModels = normalizeProviderModels(models, providerId)

  if (scope === "organization") {
    await replaceOrganizationProviderModels({
      database,
      organizationId,
      providerId,
      models: providerModels,
    })
    const initial = selectInitialProviderModel(
      providerModels,
      providerId,
      recommendedModelId
    )
    if (initial) {
      await database
        .insert(schema.organizationModelPreference)
        .values({
          organizationId,
          providerId: initial.providerId,
          modelId: initial.modelId,
          configuredByUserId: userId,
        })
        .onConflictDoUpdate({
          target: schema.organizationModelPreference.organizationId,
          set: {
            providerId: initial.providerId,
            modelId: initial.modelId,
            configuredByUserId: userId,
            updatedAt: new Date(),
          },
        })
    }
    return providerModels.length
  }

  await replaceUserProviderModels({
    database,
    userId,
    providerId,
    models: providerModels,
  })
  const initial = selectInitialProviderModel(
    providerModels,
    providerId,
    recommendedModelId
  )
  if (initial) {
    await database
      .insert(schema.userModelPreference)
      .values({
        userId,
        providerId: initial.providerId,
        modelId: initial.modelId,
      })
      .onConflictDoUpdate({
        target: schema.userModelPreference.userId,
        set: {
          providerId: initial.providerId,
          modelId: initial.modelId,
          updatedAt: new Date(),
        },
      })
  }
  return providerModels.length
}
