import { createServerFn } from "@tanstack/react-start"
import { env } from "cloudflare:workers"
import { Schema } from "effect"
import {
  InvalidRequest,
  OpenCodeSubscriptionStartInput,
  OpenCodeSubscriptionStatusInput,
} from "@workspace/domain"
import { connectionManager } from "./middleware"
import { saveProviderConnection } from "@/server/provider-connection-store"

const decodeStart = Schema.decodeUnknownPromise(OpenCodeSubscriptionStartInput)
const decodeStatus = Schema.decodeUnknownPromise(
  OpenCodeSubscriptionStatusInput
)
const personalScope = (scope: string) => {
  if (scope !== "user")
    throw new InvalidRequest({
      message: "Cursor subscriptions are personal connections",
    })
}
export const startCursorSubscription = createServerFn({ method: "POST" })
  .middleware([connectionManager])
  .validator(decodeStart)
  .handler(async ({ data, context }) => {
    personalScope(data.scope)
    const attempt = await env.CURSOR.get(
      env.CURSOR.idFromName(context.user.id)
    ).startLogin()
    return {
      attemptId: attempt.attemptId,
      url: attempt.url,
      expiresAt: attempt.expiresAt,
      instructions: attempt.instructions,
    }
  })
export const getCursorSubscriptionStatus = createServerFn({ method: "POST" })
  .middleware([connectionManager])
  .validator(decodeStatus)
  .handler(async ({ data, context }) => {
    personalScope(data.scope)
    const result = await env.CURSOR.get(
      env.CURSOR.idFromName(context.user.id)
    ).pollLogin(data.attemptId)
    if (result.status === "complete") {
      await saveProviderConnection({
        database: context.database,
        organizationId: data.organizationId,
        userId: context.user.id,
        scope: "user",
        providerId: "cursor",
        authMethod: "cursor-subscription",
        credential: JSON.stringify({
          type: "key",
          key: JSON.stringify({ userId: context.user.id, key: result.key }),
        }),
        encryptionSecret: env.CREDENTIAL_ENCRYPTION_KEY,
        models: result.models.map((model) => ({
          providerId: "cursor",
          modelId: model.id,
          name: model.name,
        })),
        recommendedModelId: null,
      })
    }
    return { status: result.status, message: undefined }
  })
export const cancelCursorSubscription = createServerFn({ method: "POST" })
  .middleware([connectionManager])
  .validator(decodeStatus)
  .handler(async ({ data, context }) => {
    personalScope(data.scope)
    await env.CURSOR.get(env.CURSOR.idFromName(context.user.id)).cancelLogin(
      data.attemptId
    )
  })
