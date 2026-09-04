import { env } from "cloudflare:workers"
import { saveProviderConnection } from "@/server/provider-connection-store"
import { createServerFn } from "@tanstack/react-start"
import { schema } from "@workspace/db"
import {
  InvalidRequest,
  OpenCodeSubscriptionStatus,
  WorkspaceRuntimeFailure,
  DisconnectOpenCodeConnectionInput,
  OpenCodeKeySetupInput,
  OpenCodeSubscriptionStartInput,
  OpenCodeSubscriptionStatusInput,
  OrganizationRequestInput,
  SetDefaultModelInput,
} from "@workspace/domain"
import { and, desc, eq } from "drizzle-orm"

import { connectionManager, organizationMember } from "@/functions/middleware"
import { providerName } from "@/lib/model-selection"
import {
  encodeKeyCredential,
  normalizeProviderApiKey,
} from "@/lib/provider-credential"
import { isOrganizationAdmin } from "@/server/organization-access"
import {
  ProviderApiKeyValidationError,
  validateProviderApiKey,
} from "@/server/provider-key-validation"
import {
  connectionRuntimeName,
  effectiveConnection,
  subscriptionProviderId,
} from "@/server/provider-connections"
import { workspaceRuntime } from "@/server/workspace-runtime"
import { Schema } from "effect"

const decodeDisconnectOpenCodeConnectionInputPromise =
  Schema.decodeUnknownPromise(DisconnectOpenCodeConnectionInput)
const decodeOpenCodeKeySetupInputPromise = Schema.decodeUnknownPromise(
  OpenCodeKeySetupInput
)
const decodeOpenCodeSubscriptionStartInputPromise = Schema.decodeUnknownPromise(
  OpenCodeSubscriptionStartInput
)
const decodeOpenCodeSubscriptionStatusInputPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionStatusInput)
const decodeOrganizationRequestInputPromise = Schema.decodeUnknownPromise(
  OrganizationRequestInput
)
const decodeSetDefaultModelInputPromise =
  Schema.decodeUnknownPromise(SetDefaultModelInput)

export const getOpenCodeSetup = createServerFn({ method: "GET" })
  .middleware([organizationMember])
  .validator((input) => decodeOrganizationRequestInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, membership, user } = context

    const organizationConnections = await database
      .select({
        providerId: schema.openCodeConnection.providerId,
        authMethod: schema.openCodeConnection.authMethod,
      })
      .from(schema.openCodeConnection)
      .where(eq(schema.openCodeConnection.organizationId, data.organizationId))
      .orderBy(schema.openCodeConnection.providerId)

    const personalConnections = await database
      .select({
        providerId: schema.userOpenCodeConnection.providerId,
        authMethod: schema.userOpenCodeConnection.authMethod,
      })
      .from(schema.userOpenCodeConnection)
      .where(eq(schema.userOpenCodeConnection.userId, user.id))
      .orderBy(schema.userOpenCodeConnection.providerId)

    const effective = await effectiveConnection(
      database,
      data.organizationId,
      user.id
    )

    const organizationModelCounts = await database
      .select({
        providerId: schema.organizationProviderModel.providerId,
        modelId: schema.organizationProviderModel.modelId,
        name: schema.organizationProviderModel.name,
      })
      .from(schema.organizationProviderModel)
      .where(
        eq(schema.organizationProviderModel.organizationId, data.organizationId)
      )
    const personalModelCounts = await database
      .select({
        providerId: schema.userProviderModel.providerId,
        modelId: schema.userProviderModel.modelId,
        name: schema.userProviderModel.name,
      })
      .from(schema.userProviderModel)
      .where(eq(schema.userProviderModel.userId, user.id))
    const organizationDefault = await database
      .select({
        providerId: schema.organizationModelPreference.providerId,
        modelId: schema.organizationModelPreference.modelId,
      })
      .from(schema.organizationModelPreference)
      .where(
        eq(
          schema.organizationModelPreference.organizationId,
          data.organizationId
        )
      )
      .get()
    const personalDefault = await database
      .select({
        providerId: schema.userModelPreference.providerId,
        modelId: schema.userModelPreference.modelId,
      })
      .from(schema.userModelPreference)
      .where(eq(schema.userModelPreference.userId, user.id))
      .get()

    const members = await database
      .select({
        id: schema.member.id,
        name: schema.user.name,
        email: schema.user.email,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(eq(schema.member.organizationId, data.organizationId))
      .orderBy(schema.user.name)

    const invitations = isOrganizationAdmin(membership.role)
      ? await database
          .select({
            id: schema.invitation.id,
            email: schema.invitation.email,
            role: schema.invitation.role,
            status: schema.invitation.status,
          })
          .from(schema.invitation)
          .where(eq(schema.invitation.organizationId, data.organizationId))
          .orderBy(desc(schema.invitation.createdAt))
      : []

    return {
      providerId: effective?.providerId ?? null,
      modelId: effective?.modelId ?? null,
      modelName: effective?.modelName ?? null,
      models: effective?.models ?? [],
      modelNotice: effective?.notice ?? null,
      organizationDefault: organizationDefault ?? null,
      personalDefault: personalDefault ?? null,
      organizationModels: organizationModelCounts.map((model) => ({
        ...model,
        providerName: providerName(model.providerId),
        scope: "organization" as const,
      })),
      authMethod: effective?.authMethod ?? null,
      role: membership.role,
      canManageOrganization: isOrganizationAdmin(membership.role),
      organizationConnections: organizationConnections.map((connection) => ({
        ...connection,
        availableModelCount: organizationModelCounts.filter(
          (model) => model.providerId === connection.providerId
        ).length,
      })),
      personalConnections: personalConnections.map((connection) => ({
        ...connection,
        availableModelCount: personalModelCounts.filter(
          (model) => model.providerId === connection.providerId
        ).length,
      })),
      members,
      invitations,
    }
  })

export const setDefaultModel = createServerFn({ method: "POST" })
  .middleware([connectionManager])
  .validator((input) => decodeSetDefaultModelInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, user } = context
    const model =
      data.scope === "organization"
        ? await database
            .select({ modelId: schema.organizationProviderModel.modelId })
            .from(schema.organizationProviderModel)
            .where(
              and(
                eq(
                  schema.organizationProviderModel.organizationId,
                  data.organizationId
                ),
                eq(
                  schema.organizationProviderModel.providerId,
                  data.providerId
                ),
                eq(schema.organizationProviderModel.modelId, data.modelId)
              )
            )
            .get()
        : await database
            .select({ modelId: schema.userProviderModel.modelId })
            .from(schema.userProviderModel)
            .where(
              and(
                eq(schema.userProviderModel.userId, user.id),
                eq(schema.userProviderModel.providerId, data.providerId),
                eq(schema.userProviderModel.modelId, data.modelId)
              )
            )
            .get()

    const organizationModel =
      data.scope === "user" && !model
        ? await database
            .select({ modelId: schema.organizationProviderModel.modelId })
            .from(schema.organizationProviderModel)
            .where(
              and(
                eq(
                  schema.organizationProviderModel.organizationId,
                  data.organizationId
                ),
                eq(
                  schema.organizationProviderModel.providerId,
                  data.providerId
                ),
                eq(schema.organizationProviderModel.modelId, data.modelId)
              )
            )
            .get()
        : null

    if (!model && !organizationModel) {
      throw new InvalidRequest({ message: "This model is not available" })
    }

    if (data.scope === "organization") {
      await database
        .insert(schema.organizationModelPreference)
        .values({
          organizationId: data.organizationId,
          providerId: data.providerId,
          modelId: data.modelId,
          configuredByUserId: user.id,
        })
        .onConflictDoUpdate({
          target: schema.organizationModelPreference.organizationId,
          set: {
            providerId: data.providerId,
            modelId: data.modelId,
            configuredByUserId: user.id,
            updatedAt: new Date(),
          },
        })
    } else {
      await database
        .insert(schema.userModelPreference)
        .values({
          userId: user.id,
          providerId: data.providerId,
          modelId: data.modelId,
        })
        .onConflictDoUpdate({
          target: schema.userModelPreference.userId,
          set: {
            providerId: data.providerId,
            modelId: data.modelId,
            updatedAt: new Date(),
          },
        })
    }

    return { providerId: data.providerId, modelId: data.modelId }
  })

export const disconnectOpenCodeConnection = createServerFn({ method: "POST" })
  .middleware([connectionManager])
  .validator((input) => decodeDisconnectOpenCodeConnectionInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, user } = context
    if (data.providerId === "cursor") {
      if (data.scope !== "user")
        throw new InvalidRequest({
          message: "Cursor subscriptions are personal connections",
        })
      await env.CURSOR.get(env.CURSOR.idFromName(user.id)).disconnect()
    }
    if (data.scope === "organization") {
      await database
        .delete(schema.openCodeConnection)
        .where(
          and(
            eq(schema.openCodeConnection.organizationId, data.organizationId),
            eq(schema.openCodeConnection.providerId, data.providerId)
          )
        )
      await database
        .delete(schema.organizationProviderModel)
        .where(
          and(
            eq(
              schema.organizationProviderModel.organizationId,
              data.organizationId
            ),
            eq(schema.organizationProviderModel.providerId, data.providerId)
          )
        )
      await database
        .delete(schema.organizationModelPreference)
        .where(
          and(
            eq(
              schema.organizationModelPreference.organizationId,
              data.organizationId
            ),
            eq(schema.organizationModelPreference.providerId, data.providerId)
          )
        )
    } else {
      await database
        .delete(schema.userOpenCodeConnection)
        .where(
          and(
            eq(schema.userOpenCodeConnection.userId, user.id),
            eq(schema.userOpenCodeConnection.providerId, data.providerId)
          )
        )
      await database
        .delete(schema.userProviderModel)
        .where(
          and(
            eq(schema.userProviderModel.userId, user.id),
            eq(schema.userProviderModel.providerId, data.providerId)
          )
        )
      await database
        .delete(schema.userModelPreference)
        .where(
          and(
            eq(schema.userModelPreference.userId, user.id),
            eq(schema.userModelPreference.providerId, data.providerId)
          )
        )
    }

    return { providerId: data.providerId }
  })

export const saveOpenCodeSetup = createServerFn({ method: "POST" })
  .middleware([connectionManager])
  .validator((input) => decodeOpenCodeKeySetupInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, user } = context
    const apiKey = normalizeProviderApiKey(data.apiKey)
    if (!apiKey) {
      throw new InvalidRequest({ message: "Enter a provider API key" })
    }

    try {
      await validateProviderApiKey({ providerId: data.providerId, apiKey })
    } catch (error) {
      if (!(error instanceof ProviderApiKeyValidationError)) throw error
      throw new InvalidRequest({
        message:
          error.failure === "rejected"
            ? "OpenRouter rejected this API key. Check it and try again."
            : "Sylph could not validate this API key with OpenRouter. Try again.",
      })
    }

    const runtime = workspaceRuntime(
      connectionRuntimeName(data.organizationId, user.id, data.scope)
    )
    const result = await runtime.connectKey({ ...data, apiKey })

    const availableModelCount = await saveProviderConnection({
      database,
      organizationId: data.organizationId,
      userId: user.id,
      scope: data.scope,
      providerId: data.providerId,
      authMethod: "api-key",
      credential: encodeKeyCredential(apiKey, data.configuration),
      encryptionSecret: env.CREDENTIAL_ENCRYPTION_KEY,
      models: result.models,
      recommendedModelId: result.recommendedModelId,
    })

    return { providerId: data.providerId, availableModelCount }
  })

export const startOpenCodeSubscription = createServerFn({ method: "POST" })
  .middleware([connectionManager])
  .validator((input) => decodeOpenCodeSubscriptionStartInputPromise(input))
  .handler(async ({ data, context }) => {
    const runtime = workspaceRuntime(
      connectionRuntimeName(data.organizationId, context.user.id, data.scope)
    )
    const attempt = await runtime.startSubscriptionSignIn(data)

    return {
      attemptId: attempt.attemptId,
      url: attempt.url,
      instructions: attempt.instructions,
      expiresAt: attempt.expiresAt,
    }
  })

export const getOpenCodeSubscriptionStatus = createServerFn({ method: "POST" })
  .middleware([connectionManager])
  .validator((input) => decodeOpenCodeSubscriptionStatusInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, user } = context
    const runtime = workspaceRuntime(
      connectionRuntimeName(data.organizationId, user.id, data.scope)
    )
    const result = await runtime.subscriptionSignInStatus(data)

    if (result.status !== "complete") {
      const status = new OpenCodeSubscriptionStatus({
        status: result.status,
        message: result.message,
      })

      return { status: status.status, message: status.message }
    }

    if (!result.credential || result.credential.type !== "oauth") {
      throw new WorkspaceRuntimeFailure({
        message: "OpenCode completed sign-in without a subscription",
      })
    }
    if (!result.models) {
      throw new WorkspaceRuntimeFailure({
        message: "OpenCode completed sign-in without a model catalog",
      })
    }

    await saveProviderConnection({
      database,
      organizationId: data.organizationId,
      userId: user.id,
      scope: data.scope,
      providerId: subscriptionProviderId,
      authMethod: "chatgpt-subscription",
      credential: JSON.stringify(result.credential),
      encryptionSecret: env.CREDENTIAL_ENCRYPTION_KEY,
      models: result.models,
      recommendedModelId: result.recommendedModelId ?? null,
    })

    return { status: "complete" as const, message: undefined }
  })

export const cancelOpenCodeSubscription = createServerFn({ method: "POST" })
  .middleware([connectionManager])
  .validator((input) => decodeOpenCodeSubscriptionStatusInputPromise(input))
  .handler(async ({ data, context }) => {
    const runtime = workspaceRuntime(
      connectionRuntimeName(data.organizationId, context.user.id, data.scope)
    )
    await runtime.cancelSubscriptionSignIn(data)
  })
