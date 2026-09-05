import { createServerFn } from "@tanstack/react-start"
import { schema } from "@workspace/db"
import {
  AccessDenied,
  InstanceModelPolicy,
  validateInstanceModelPolicy,
  instanceModelKey,
} from "@workspace/domain"
import { eq } from "drizzle-orm"
import { Schema } from "effect"
import { authenticated } from "./middleware"
import { installationId } from "@/server/installation"
import {
  isOrganizationAdmin,
  requireOrganizationMembership,
  type Database,
} from "@/server/organization-access"
import { readInstanceModelPolicy } from "@/server/instance-model-policy"
import { providerName } from "@/lib/model-selection"

const decodePolicy = Schema.decodeUnknownPromise(InstanceModelPolicy)

const requireInstanceAdmin = async (database: Database, userId: string) => {
  const installation = await database
    .select()
    .from(schema.installation)
    .where(eq(schema.installation.id, installationId))
    .get()
  if (!installation?.organizationId)
    throw new AccessDenied({
      resource: "installation",
      message: "Claim this Sylph instance first",
    })
  const membership = await requireOrganizationMembership(
    database,
    installation.organizationId,
    userId
  )
  if (!isOrganizationAdmin(membership.role))
    throw new AccessDenied({
      resource: "installation",
      message: "Only instance admins can configure available models",
    })
  return installation.organizationId
}

const instanceCatalog = async (database: Database, organizationId: string) => {
  const [shared, personal] = await Promise.all([
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
        providerId: schema.userProviderModel.providerId,
        modelId: schema.userProviderModel.modelId,
        name: schema.userProviderModel.name,
      })
      .from(schema.userProviderModel)
      .innerJoin(
        schema.member,
        eq(schema.member.userId, schema.userProviderModel.userId)
      )
      .where(eq(schema.member.organizationId, organizationId)),
  ])
  return [
    ...new Map(
      [...shared, ...personal].map((model) => [
        instanceModelKey(model),
        { ...model, providerName: providerName(model.providerId) },
      ])
    ).values(),
  ].sort((a, b) =>
    `${a.providerName} ${a.name}`.localeCompare(`${b.providerName} ${b.name}`)
  )
}

export const getInstanceModels = createServerFn({ method: "GET" })
  .middleware([authenticated])
  .handler(async ({ context }) => {
    const organizationId = await requireInstanceAdmin(
      context.database,
      context.user.id
    )
    const [policy, catalog] = await Promise.all([
      readInstanceModelPolicy(context.database),
      instanceCatalog(context.database, organizationId),
    ])
    return { policy, catalog }
  })

export const saveInstanceModels = createServerFn({ method: "POST" })
  .middleware([authenticated])
  .validator((input) => decodePolicy(input))
  .handler(async ({ data, context }) => {
    const organizationId = await requireInstanceAdmin(
      context.database,
      context.user.id
    )
    const [catalog, previous] = await Promise.all([
      instanceCatalog(context.database, organizationId),
      readInstanceModelPolicy(context.database),
    ])
    validateInstanceModelPolicy(data, [...catalog, ...previous.models])
    await context.database
      .update(schema.installation)
      .set({ modelPolicy: data })
      .where(eq(schema.installation.id, installationId))
    return { saved: true }
  })
