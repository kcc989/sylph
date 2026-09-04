import { schema } from "@workspace/db"
import type { ConnectionScope } from "@workspace/domain"
import { and, eq } from "drizzle-orm"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
import {
  normalizeProviderModels,
  selectInitialProviderModel,
} from "@/lib/provider-models"
import { encryptCredential } from "./credentials.server"

type Database = BaseSQLiteDatabase<"async", unknown, typeof schema>

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

const saveProviderModels = async ({
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

export const saveProviderConnection = async (
  input: Parameters<typeof saveProviderModels>[0] & {
    authMethod: "api-key" | "chatgpt-subscription" | "cursor-subscription"
    credential: string
    encryptionSecret: string
  }
) => {
  const { database } = input
  const credential = await encryptCredential(
    input.credential,
    input.encryptionSecret
  )
  const now = new Date()
  if (input.scope === "organization") {
    await database
      .insert(schema.openCodeConnection)
      .values({
        organizationId: input.organizationId,
        configuredByUserId: input.userId,
        providerId: input.providerId,
        authMethod: input.authMethod,
        encryptedCredential: credential.encrypted,
        encryptionIv: credential.iv,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.openCodeConnection.organizationId,
          schema.openCodeConnection.providerId,
        ],
        set: {
          configuredByUserId: input.userId,
          authMethod: input.authMethod,
          encryptedCredential: credential.encrypted,
          encryptionIv: credential.iv,
          updatedAt: now,
        },
      })
  } else {
    await database
      .insert(schema.userOpenCodeConnection)
      .values({
        userId: input.userId,
        providerId: input.providerId,
        authMethod: input.authMethod,
        encryptedCredential: credential.encrypted,
        encryptionIv: credential.iv,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.userOpenCodeConnection.userId,
          schema.userOpenCodeConnection.providerId,
        ],
        set: {
          authMethod: input.authMethod,
          encryptedCredential: credential.encrypted,
          encryptionIv: credential.iv,
          updatedAt: now,
        },
      })
  }

  return saveProviderModels(input)
}
