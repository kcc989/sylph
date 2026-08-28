import {
  type ConnectionScope,
  decodeWorkspaceAcceptInputPromise,
  decodeCreateWorkspaceInputPromise,
  decodeCreateProjectInputPromise,
  decodeDisconnectOpenCodeConnectionInputPromise,
  decodeGitHubApiRepositoryJsonPromise,
  decodeGitHubRepositoryLookupInputPromise,
  decodeInstallationClaimInputPromise,
  decodeMagicLinkRequest,
  decodeOpenCodeConnectionResultPromise,
  decodeOpenCodeKeySetupInputPromise,
  decodeOpenCodeSubscriptionAttemptPromise,
  decodeOpenCodeSubscriptionRuntimeStatusPromise,
  decodeOpenCodeSubscriptionStartInputPromise,
  decodeOpenCodeSubscriptionStatusInputPromise,
  decodeOrganizationRequestInputPromise,
  decodePrepareProjectRepositoryResultPromise,
  decodeProjectRequestInputPromise,
  decodeRestartWorkspaceInputPromise,
  decodeSetDefaultModelInputPromise,
  decodeWorkspaceCheckpointInputPromise,
  decodeWorkspaceCheckpointList,
  decodeWorkspaceCheckpointResult,
  decodeWorkspacePromptInputPromise,
  decodeWorkspaceRequestInputPromise,
  decodeWorkspaceRuntimeHealth,
  decodeWorkspaceVersionControl,
  encodeWorkspaceCheckpointList,
  encodeWorkspaceRuntimeHealth,
  encodeWorkspaceVersionControl,
  InitializeWorkspaceRuntime,
  GitHubRepositoryInfo,
  OpenCodeSubscriptionStatus,
  OrganizationId,
  ProjectId,
  WorkspaceId,
  WorkspaceRuntimeHealth,
  parseGitHubRepositoryUrl,
} from "@workspace/domain"
import { Effect } from "effect"
import { schema } from "@workspace/db"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { env, waitUntil } from "cloudflare:workers"
import { and, count, desc, eq } from "drizzle-orm"
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1"

import { createRequestAuth } from "@/server/auth.server"
import { assertInstallationClaimIdentity } from "@/lib/installation-claim"
import { makeArtifactRepositoryService } from "@/server/artifact-repository-service"
import {
  decryptCredential,
  encryptCredential,
} from "@/server/credentials.server"
import {
  providerName,
  resolveModelSelection,
  type AvailableModel,
  type SelectedModel,
} from "@/lib/model-selection"
import {
  decodeStoredCredential,
  encodeKeyCredential,
} from "@/lib/provider-credential"
import {
  normalizeProviderModels,
  selectInitialProviderModel,
} from "@/lib/provider-models"

const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")

const subscriptionProviderId = "openai"
const installationId = "default"
const installationOrganizationId = "installation-organization"

const secretsMatch = async (provided: string, expected: string) => {
  const encoder = new TextEncoder()
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ])
  const left = new Uint8Array(providedDigest)
  const right = new Uint8Array(expectedDigest)
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

const organizationMembership = async (organizationId: string, userId: string) =>
  drizzle(env.DB, { schema })
    .select({ id: schema.member.id, role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.userId, userId)
      )
    )
    .get()

const isOrganizationAdmin = (role: string) =>
  role === "owner" || role === "admin"

const ensureInstallationOwner = async (
  database: DrizzleD1Database<typeof schema>,
  organizationId: string,
  userId: string,
  sessionId: string
) => {
  await database
    .insert(schema.member)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: "owner",
    })
    .onConflictDoUpdate({
      target: [schema.member.organizationId, schema.member.userId],
      set: { role: "owner" },
    })
  await env.DB.prepare(
    "UPDATE session SET active_organization_id = ? WHERE id = ?"
  )
    .bind(organizationId, sessionId)
    .run()
}

const connectionAccess = async (
  organizationId: string,
  userId: string,
  scope: ConnectionScope
) => {
  const membership = await organizationMembership(organizationId, userId)

  if (!membership) {
    throw new Error("You are not a member of this Organization")
  }

  if (scope === "organization" && !isOrganizationAdmin(membership.role)) {
    throw new Error("Only Organization admins can manage shared AI connections")
  }

  return membership
}

const connectionRuntimeName = (
  organizationId: string,
  userId: string,
  scope: ConnectionScope
) =>
  scope === "organization"
    ? `opencode-setup-organization-${organizationId}`
    : `opencode-setup-user-${userId}`

const effectiveConnection = async (
  database: DrizzleD1Database<typeof schema>,
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
      .map((model) => `${model.providerId}\u0000${model.modelId}`)
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
          !personalKeys.has(`${model.providerId}\u0000${model.modelId}`)
      )
      .map((model) => ({
        ...model,
        providerName: providerName(model.providerId),
        scope: "organization" as const,
      })),
  ].sort((left, right) =>
    `${left.providerName}\u0000${left.name}`.localeCompare(
      `${right.providerName}\u0000${right.name}`
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

const connectionCredential = async (connection: {
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

const initializeWorkspaceRuntime = async (
  workspaceId: string,
  input: InitializeWorkspaceRuntime
) => {
  const runtime = env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId))
  const response = await runtime.fetch("https://workspace/initialize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })

  if (!response.ok) throw new Error(await response.text())
}

const completeWorkspaceInitialization = async (
  database: DrizzleD1Database<typeof schema>,
  workspaceId: string,
  input: InitializeWorkspaceRuntime
) => {
  try {
    await initializeWorkspaceRuntime(workspaceId, input)
    await database
      .update(schema.workspace)
      .set({
        status: "ready",
        syncStatus: "ready",
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, workspaceId))
  } catch (error) {
    const errorSummary =
      error instanceof Error && error.message
        ? error.message
        : "Workspace runtime failed"
    await database
      .update(schema.workspace)
      .set({ status: "error", errorSummary, updatedAt: new Date() })
      .where(eq(schema.workspace.id, workspaceId))
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
  database: DrizzleD1Database<typeof schema>
  organizationId: string
  userId: string
  scope: ConnectionScope
  providerId: string
  models: ReadonlyArray<{ providerId: string; modelId: string; name: string }>
  recommendedModelId: string | null
}) => {
  const providerModels = normalizeProviderModels(models, providerId)
  const batches = Array.from(
    { length: Math.ceil(providerModels.length / 20) },
    (_, index) => providerModels.slice(index * 20, index * 20 + 20)
  )

  if (scope === "organization") {
    await database
      .delete(schema.organizationProviderModel)
      .where(
        and(
          eq(schema.organizationProviderModel.organizationId, organizationId),
          eq(schema.organizationProviderModel.providerId, providerId)
        )
      )
    for (const batch of batches) {
      await database.insert(schema.organizationProviderModel).values(
        batch.map((model) => ({
          organizationId,
          providerId: model.providerId,
          modelId: model.modelId,
          name: model.name,
        }))
      )
    }
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

  await database
    .delete(schema.userProviderModel)
    .where(
      and(
        eq(schema.userProviderModel.userId, userId),
        eq(schema.userProviderModel.providerId, providerId)
      )
    )
  for (const batch of batches) {
    await database.insert(schema.userProviderModel).values(
      batch.map((model) => ({
        userId,
        providerId: model.providerId,
        modelId: model.modelId,
        name: model.name,
      }))
    )
  }
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

const prepareProjectRepository = async (
  workspaceId: string,
  input: {
    repositoryName: string
    repositoryRemote: string
    defaultRef: string
    projectName: string
  }
) => {
  const runtime = env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId))
  const response = await runtime.fetch("https://workspace/prepare-project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await response.text())
  return decodePrepareProjectRepositoryResultPromise(await response.json())
}

const currentSession = async (request: Request) => {
  const auth = createRequestAuth(request, env)
  const session = await auth.api.getSession({ headers: request.headers })
  return { auth, session }
}

export const getLatestMagicLink = createServerFn({ method: "POST" })
  .validator((input) => decodeMagicLinkRequest(input))
  .handler(async ({ data }) => {
    if (env.ALLOW_TEST_MAGIC_LINKS !== "true") return null

    const latest = await drizzle(env.DB, { schema })
      .select({ url: schema.magicLinkOutbox.url })
      .from(schema.magicLinkOutbox)
      .where(eq(schema.magicLinkOutbox.email, data.email))
      .orderBy(desc(schema.magicLinkOutbox.createdAt))
      .get()

    return latest?.url ?? null
  })

export const claimInstallation = createServerFn({ method: "POST" })
  .validator((input) => decodeInstallationClaimInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before claiming this Installation")
    assertInstallationClaimIdentity(session.user, data.confirmedEmail)
    if (
      !(await secretsMatch(data.claimSecret, env.INSTALLATION_CLAIM_SECRET))
    ) {
      throw new Error("The Installation claim secret is invalid")
    }

    const existing = await env.DB.prepare(
      "SELECT organization_id, claimed_by_user_id FROM installation WHERE id = ?"
    )
      .bind(installationId)
      .first<{
        organization_id: string | null
        claimed_by_user_id: string | null
      }>()

    if (!existing) {
      throw new Error("Installation storage has not been initialized")
    }

    const database = drizzle(env.DB, { schema })

    if (existing.claimed_by_user_id) {
      if (existing.claimed_by_user_id === session.user.id) {
        const organizationId =
          existing.organization_id ?? installationOrganizationId
        await ensureInstallationOwner(
          database,
          organizationId,
          session.user.id,
          session.session.id
        )
        return {
          organizationId,
        }
      }
      throw new Error("This Installation has already been claimed")
    }

    await database
      .insert(schema.organization)
      .values({
        id: installationOrganizationId,
        name: data.organizationName.trim(),
        slug: "sylph",
      })
      .onConflictDoNothing()

    const claim = await env.DB.prepare(
      "UPDATE installation SET organization_id = ?, claimed_by_user_id = ?, claimed_at = unixepoch() WHERE id = ? AND claimed_by_user_id IS NULL"
    )
      .bind(installationOrganizationId, session.user.id, installationId)
      .run()

    if (claim.meta.changes !== 1) {
      throw new Error("This Installation was claimed by another user")
    }

    await ensureInstallationOwner(
      database,
      installationOrganizationId,
      session.user.id,
      session.session.id
    )

    return { organizationId: installationOrganizationId }
  })

export const getDashboard = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = getRequest()
    const { auth, session } = await currentSession(request)

    if (!session) {
      return {
        authentication: {
          github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
          testMagicLinks: env.ALLOW_TEST_MAGIC_LINKS === "true",
        },
        installation: {
          claimed: false,
          role: null,
          canAdminister: false,
        },
        user: null,
        organizations: [],
        projects: [],
        workspaces: [],
        providerOrganizationIds: [],
        hasPersonalProvider: false,
      }
    }

    const database = drizzle(env.DB, { schema })
    const [
      organizations,
      installation,
      installationMembership,
      projects,
      workspaces,
      organizationConnections,
      personalConnection,
    ] = await Promise.all([
      auth.api.listOrganizations({ headers: request.headers }),
      database
        .select({
          organizationId: schema.installation.organizationId,
          claimedByUserId: schema.installation.claimedByUserId,
        })
        .from(schema.installation)
        .where(eq(schema.installation.id, installationId))
        .get(),
      database
        .select({ role: schema.member.role })
        .from(schema.member)
        .innerJoin(
          schema.installation,
          eq(schema.installation.organizationId, schema.member.organizationId)
        )
        .where(
          and(
            eq(schema.installation.id, installationId),
            eq(schema.member.userId, session.user.id)
          )
        )
        .get(),
      database
        .select({
          id: schema.project.id,
          name: schema.project.name,
          slug: schema.project.slug,
          organizationId: schema.project.organizationId,
          organizationSlug: schema.organization.slug,
          repositoryName: schema.project.artifactRepo,
          defaultBranch: schema.project.defaultBranch,
          createdAt: schema.project.createdAt,
        })
        .from(schema.project)
        .innerJoin(
          schema.member,
          and(
            eq(schema.member.organizationId, schema.project.organizationId),
            eq(schema.member.userId, session.user.id)
          )
        )
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.project.organizationId)
        )
        .orderBy(desc(schema.project.createdAt)),
      database
        .select({
          id: schema.workspace.id,
          projectId: schema.workspace.projectId,
          projectName: schema.project.name,
          projectSlug: schema.project.slug,
          title: schema.workspace.title,
          status: schema.workspace.status,
          repositoryName: schema.workspace.workspaceArtifactRepo,
          organizationId: schema.workspace.organizationId,
          organizationSlug: schema.organization.slug,
          errorSummary: schema.workspace.errorSummary,
          createdAt: schema.workspace.createdAt,
        })
        .from(schema.workspace)
        .innerJoin(
          schema.project,
          eq(schema.workspace.projectId, schema.project.id)
        )
        .innerJoin(
          schema.member,
          and(
            eq(schema.member.organizationId, schema.workspace.organizationId),
            eq(schema.member.userId, session.user.id)
          )
        )
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.workspace.organizationId)
        )
        .orderBy(desc(schema.workspace.createdAt)),
      database
        .select({ organizationId: schema.openCodeConnection.organizationId })
        .from(schema.openCodeConnection)
        .innerJoin(
          schema.member,
          and(
            eq(
              schema.member.organizationId,
              schema.openCodeConnection.organizationId
            ),
            eq(schema.member.userId, session.user.id)
          )
        ),
      database
        .select({ providerId: schema.userOpenCodeConnection.providerId })
        .from(schema.userOpenCodeConnection)
        .where(eq(schema.userOpenCodeConnection.userId, session.user.id))
        .get(),
    ])

    return {
      authentication: {
        github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        testMagicLinks: env.ALLOW_TEST_MAGIC_LINKS === "true",
      },
      installation: {
        claimed: Boolean(installation?.claimedByUserId),
        role: installationMembership?.role ?? null,
        canAdminister: installationMembership
          ? isOrganizationAdmin(installationMembership.role)
          : false,
      },
      user: session.user,
      organizations,
      projects,
      providerOrganizationIds: [
        ...new Set(
          organizationConnections.map((connection) => connection.organizationId)
        ),
      ],
      hasPersonalProvider: Boolean(personalConnection),
      workspaces: workspaces.map((workspace) =>
        workspace.errorSummary && workspace.status === "provisioning"
          ? { ...workspace, status: "error" }
          : workspace
      ),
    }
  }
)

export const getOpenCodeSetup = createServerFn({ method: "GET" })
  .validator((input) => decodeOrganizationRequestInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) return null

    const database = drizzle(env.DB, { schema })
    const membership = await organizationMembership(
      data.organizationId,
      session.user.id
    )

    if (!membership) return null

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
      .where(eq(schema.userOpenCodeConnection.userId, session.user.id))
      .orderBy(schema.userOpenCodeConnection.providerId)

    const effective = await effectiveConnection(
      database,
      data.organizationId,
      session.user.id
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
      .where(eq(schema.userProviderModel.userId, session.user.id))
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
      .where(eq(schema.userModelPreference.userId, session.user.id))
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
  .validator((input) => decodeSetDefaultModelInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before choosing a default model")

    await connectionAccess(data.organizationId, session.user.id, data.scope)

    const database = drizzle(env.DB, { schema })
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
                eq(schema.userProviderModel.userId, session.user.id),
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

    if (!model && !organizationModel)
      throw new Error("This model is not available")

    if (data.scope === "organization") {
      await database
        .insert(schema.organizationModelPreference)
        .values({
          organizationId: data.organizationId,
          providerId: data.providerId,
          modelId: data.modelId,
          configuredByUserId: session.user.id,
        })
        .onConflictDoUpdate({
          target: schema.organizationModelPreference.organizationId,
          set: {
            providerId: data.providerId,
            modelId: data.modelId,
            configuredByUserId: session.user.id,
            updatedAt: new Date(),
          },
        })
    } else {
      await database
        .insert(schema.userModelPreference)
        .values({
          userId: session.user.id,
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
  .validator((input) => decodeDisconnectOpenCodeConnectionInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before disconnecting a provider")

    await connectionAccess(data.organizationId, session.user.id, data.scope)

    const database = drizzle(env.DB, { schema })
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
            eq(schema.userOpenCodeConnection.userId, session.user.id),
            eq(schema.userOpenCodeConnection.providerId, data.providerId)
          )
        )
      await database
        .delete(schema.userProviderModel)
        .where(
          and(
            eq(schema.userProviderModel.userId, session.user.id),
            eq(schema.userProviderModel.providerId, data.providerId)
          )
        )
      await database
        .delete(schema.userModelPreference)
        .where(
          and(
            eq(schema.userModelPreference.userId, session.user.id),
            eq(schema.userModelPreference.providerId, data.providerId)
          )
        )
    }

    return { providerId: data.providerId }
  })

export const getWorkspaceCreationContext = createServerFn({ method: "GET" })
  .validator((input) => decodeProjectRequestInputPromise(input))
  .handler(async ({ data }) => {
    const request = getRequest()
    const { session } = await currentSession(request)

    if (!session) return null

    const database = drizzle(env.DB, { schema })
    const project = await database
      .select({
        id: schema.project.id,
        name: schema.project.name,
        slug: schema.project.slug,
        organizationId: schema.project.organizationId,
        organizationSlug: schema.organization.slug,
        repositoryName: schema.project.artifactRepo,
        defaultBranch: schema.project.defaultBranch,
      })
      .from(schema.project)
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.project.organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .innerJoin(
        schema.organization,
        eq(schema.organization.id, schema.project.organizationId)
      )
      .where(eq(schema.project.id, data.projectId))
      .get()

    if (!project) return null

    const setup = await effectiveConnection(
      database,
      project.organizationId,
      session.user.id
    )

    return {
      project,
      setup: setup ?? { providerId: null, modelId: null, authMethod: null },
    }
  })

export const saveOpenCodeSetup = createServerFn({ method: "POST" })
  .validator((input) => decodeOpenCodeKeySetupInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before connecting OpenCode")

    const database = drizzle(env.DB, { schema })
    await connectionAccess(data.organizationId, session.user.id, data.scope)

    const validator = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(
        connectionRuntimeName(data.organizationId, session.user.id, data.scope)
      )
    )
    const validation = await validator.fetch("https://workspace/connect/key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    })

    if (!validation.ok) throw new Error(await validation.text())

    const connected = await decodeOpenCodeConnectionResultPromise(
      await validation.json()
    )

    const credential = await encryptCredential(
      encodeKeyCredential(data.apiKey, data.configuration),
      env.CREDENTIAL_ENCRYPTION_KEY
    )
    const now = new Date()
    if (data.scope === "organization") {
      await database
        .insert(schema.openCodeConnection)
        .values({
          organizationId: data.organizationId,
          configuredByUserId: session.user.id,
          providerId: data.providerId,
          authMethod: "api-key",
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
            configuredByUserId: session.user.id,
            authMethod: "api-key",
            encryptedCredential: credential.encrypted,
            encryptionIv: credential.iv,
            updatedAt: now,
          },
        })
    } else {
      await database
        .insert(schema.userOpenCodeConnection)
        .values({
          userId: session.user.id,
          providerId: data.providerId,
          authMethod: "api-key",
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
            authMethod: "api-key",
            encryptedCredential: credential.encrypted,
            encryptionIv: credential.iv,
            updatedAt: now,
          },
        })
    }

    const availableModelCount = await saveProviderModels({
      database,
      organizationId: data.organizationId,
      userId: session.user.id,
      scope: data.scope,
      providerId: data.providerId,
      models: connected.models,
      recommendedModelId: connected.recommendedModelId,
    })

    return {
      providerId: data.providerId,
      availableModelCount,
    }
  })

export const startOpenCodeSubscription = createServerFn({ method: "POST" })
  .validator((input) => decodeOpenCodeSubscriptionStartInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before connecting OpenCode")

    await connectionAccess(data.organizationId, session.user.id, data.scope)

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(
        connectionRuntimeName(data.organizationId, session.user.id, data.scope)
      )
    )
    const response = await runtime.fetch("https://workspace/oauth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    })

    if (!response.ok) throw new Error(await response.text())

    const attempt = await decodeOpenCodeSubscriptionAttemptPromise(
      await response.json()
    )

    return {
      attemptId: attempt.attemptId,
      url: attempt.url,
      instructions: attempt.instructions,
      expiresAt: attempt.expiresAt,
    }
  })

export const getOpenCodeSubscriptionStatus = createServerFn({ method: "POST" })
  .validator((input) => decodeOpenCodeSubscriptionStatusInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before connecting OpenCode")

    await connectionAccess(data.organizationId, session.user.id, data.scope)

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(
        connectionRuntimeName(data.organizationId, session.user.id, data.scope)
      )
    )
    const response = await runtime.fetch("https://workspace/oauth/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    })

    if (!response.ok) throw new Error(await response.text())

    const result = await decodeOpenCodeSubscriptionRuntimeStatusPromise(
      await response.json()
    )

    if (result.status !== "complete") {
      const status = new OpenCodeSubscriptionStatus({
        status: result.status,
        message: result.message,
      })

      return { status: status.status, message: status.message }
    }

    if (!result.credential || result.credential.type !== "oauth") {
      throw new Error("OpenCode completed sign-in without a subscription")
    }
    if (!result.models) {
      throw new Error("OpenCode completed sign-in without a model catalog")
    }

    const encrypted = await encryptCredential(
      JSON.stringify(result.credential),
      env.CREDENTIAL_ENCRYPTION_KEY
    )
    const now = new Date()
    const database = drizzle(env.DB, { schema })
    if (data.scope === "organization") {
      await database
        .insert(schema.openCodeConnection)
        .values({
          organizationId: data.organizationId,
          configuredByUserId: session.user.id,
          providerId: subscriptionProviderId,
          authMethod: "chatgpt-subscription",
          encryptedCredential: encrypted.encrypted,
          encryptionIv: encrypted.iv,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.openCodeConnection.organizationId,
            schema.openCodeConnection.providerId,
          ],
          set: {
            configuredByUserId: session.user.id,
            authMethod: "chatgpt-subscription",
            encryptedCredential: encrypted.encrypted,
            encryptionIv: encrypted.iv,
            updatedAt: now,
          },
        })
    } else {
      await database
        .insert(schema.userOpenCodeConnection)
        .values({
          userId: session.user.id,
          providerId: subscriptionProviderId,
          authMethod: "chatgpt-subscription",
          encryptedCredential: encrypted.encrypted,
          encryptionIv: encrypted.iv,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.userOpenCodeConnection.userId,
            schema.userOpenCodeConnection.providerId,
          ],
          set: {
            authMethod: "chatgpt-subscription",
            encryptedCredential: encrypted.encrypted,
            encryptionIv: encrypted.iv,
            updatedAt: now,
          },
        })
    }

    await saveProviderModels({
      database,
      organizationId: data.organizationId,
      userId: session.user.id,
      scope: data.scope,
      providerId: subscriptionProviderId,
      models: result.models,
      recommendedModelId: result.recommendedModelId ?? null,
    })

    return { status: "complete" as const, message: undefined }
  })

export const cancelOpenCodeSubscription = createServerFn({ method: "POST" })
  .validator((input) => decodeOpenCodeSubscriptionStatusInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before connecting OpenCode")

    await connectionAccess(data.organizationId, session.user.id, data.scope)

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(
        connectionRuntimeName(data.organizationId, session.user.id, data.scope)
      )
    )
    const response = await runtime.fetch("https://workspace/oauth/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    })

    if (!response.ok) throw new Error(await response.text())
  })

export const lookupGitHubRepository = createServerFn({ method: "POST" })
  .validator((input) => decodeGitHubRepositoryLookupInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before importing a repository")

    const membership = await organizationMembership(
      data.organizationId,
      session.user.id
    )

    if (!membership) {
      throw new Error("You are not a member of this Organization")
    }

    const location = await Effect.runPromise(parseGitHubRepositoryUrl(data.url))
    const response = await fetch(
      `https://api.github.com/repos/${location.owner}/${location.name}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Sylph",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    )

    if (response.status === 404) {
      throw new Error(
        "Repository not found. Private repositories need a GitHub connection."
      )
    }

    if (!response.ok) {
      throw new Error(
        "GitHub could not load this repository. Try again shortly."
      )
    }

    const repository = await decodeGitHubApiRepositoryJsonPromise(
      await response.text()
    )

    return new GitHubRepositoryInfo({
      owner: repository.owner.login,
      name: repository.name,
      fullName: repository.full_name,
      description: repository.description,
      visibility: repository.private ? "private" : "public",
      defaultBranch: repository.default_branch,
      stars: repository.stargazers_count,
      language: repository.language,
      updatedAt: repository.updated_at,
      url: repository.html_url,
      ownerAvatarUrl: repository.owner.avatar_url,
    })
  })

export const createProject = createServerFn({ method: "POST" })
  .validator((input) => decodeCreateProjectInputPromise(input))
  .handler(async ({ data }) => {
    const request = getRequest()
    const { session } = await currentSession(request)

    if (!session) {
      throw new Error("Sign in before creating a workspace")
    }

    const database = drizzle(env.DB, { schema })
    const membership = await database
      .select({ organizationSlug: schema.organization.slug })
      .from(schema.member)
      .innerJoin(
        schema.organization,
        eq(schema.member.organizationId, schema.organization.id)
      )
      .where(
        and(
          eq(schema.member.organizationId, data.organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .get()

    if (!membership) {
      throw new Error("You are not a member of this organization")
    }

    const connection = await effectiveConnection(
      database,
      data.organizationId,
      session.user.id
    )

    if (!connection) {
      throw new Error(
        "Add a personal or Organization AI connection before creating a Project"
      )
    }

    const credential = await connectionCredential(connection)

    if (!data.sourceRepositoryUrl && data.sourceBranch) {
      throw new Error("A source branch requires a GitHub Repository URL")
    }

    const sourceRepository = data.sourceRepositoryUrl
      ? await Effect.runPromise(
          parseGitHubRepositoryUrl(data.sourceRepositoryUrl)
        )
      : undefined
    const sourceRepositoryUrl = sourceRepository
      ? `https://github.com/${sourceRepository.owner}/${sourceRepository.name}`
      : undefined

    const projectSlug = normalizeName(data.name)
    const requestedRepositoryName = projectSlug

    if (!projectSlug || !requestedRepositoryName) {
      throw new Error("Project name needs a letter or number")
    }

    const projectId = ProjectId.make(crypto.randomUUID())
    const workspaceId = WorkspaceId.make(crypto.randomUUID())
    const repositoryName = `${membership.organizationSlug}-${requestedRepositoryName.slice(0, 28)}-${projectId.replaceAll("-", "").slice(0, 12)}`
    const artifacts = makeArtifactRepositoryService(env.REPOS)
    const createdArtifact = await Effect.runPromise(
      sourceRepositoryUrl
        ? artifacts.importProject({
            name: repositoryName,
            description: `${data.name} imported by Sylph`,
            sourceUrl: sourceRepositoryUrl,
            sourceBranch: data.sourceBranch,
          })
        : artifacts.createProject({
            name: repositoryName,
            description: `${data.name} created by Sylph`,
            defaultBranch: "main",
          })
    )
    const artifact = await Effect.runPromise(
      artifacts.inspect(createdArtifact.name)
    )
    const workspaceRepositoryName = `${repositoryName.slice(0, 44)}-${workspaceId.replaceAll("-", "").slice(0, 12)}`
    const prepared = await prepareProjectRepository(workspaceId, {
      repositoryName: artifact.name,
      repositoryRemote: artifact.remote,
      defaultRef: artifact.defaultBranch,
      projectName: data.name,
    })
    const workspaceArtifact = await Effect.runPromise(
      artifacts.forkWorkspace({
        sourceName: artifact.name,
        name: workspaceRepositoryName,
        description: `Workspace for ${data.name}`,
      })
    )
    const now = new Date()

    await database.insert(schema.project).values({
      id: projectId,
      organizationId: data.organizationId,
      ownerUserId: session.user.id,
      name: data.name,
      slug: projectSlug,
      artifactRepoId: artifact.id,
      artifactRepo: artifact.name,
      artifactRemote: artifact.remote,
      defaultBranch: artifact.defaultBranch,
      importOriginUrl: sourceRepositoryUrl,
      importOriginBranch: data.sourceBranch,
      createdAt: now,
      updatedAt: now,
    })

    try {
      await database.insert(schema.workspace).values({
        id: workspaceId,
        projectId,
        organizationId: data.organizationId,
        ownerUserId: session.user.id,
        title: data.name,
        status: "provisioning",
        repositoryMode: "fork",
        baseArtifactRepo: artifact.name,
        workspaceArtifactRepo: workspaceArtifact.name,
        baseCommit: prepared.head,
        forkHead: prepared.head,
        syncStatus: "hydrating",
        mergeStatus: "unreviewed",
        createdAt: now,
        updatedAt: now,
      })
    } catch (error) {
      await database
        .delete(schema.project)
        .where(eq(schema.project.id, projectId))
      throw error
    }

    try {
      await initializeWorkspaceRuntime(
        workspaceId,
        new InitializeWorkspaceRuntime({
          organizationId: data.organizationId,
          projectId,
          workspaceId,
          projectName: data.name,
          repositoryName: workspaceArtifact.name,
          repositoryRemote: workspaceArtifact.remote,
          projectRepositoryName: artifact.name,
          projectRepositoryRemote: artifact.remote,
          defaultRef: artifact.defaultBranch,
          baseCommit: prepared.head,
          providerId: connection.providerId,
          modelId: connection.modelId,
          credential,
        })
      )
    } catch (error) {
      console.error("Workspace runtime initialization failed", error)
      const summary =
        error instanceof Error && error.message
          ? error.message
          : "Workspace runtime failed"
      await database
        .update(schema.workspace)
        .set({
          status: "error",
          errorSummary: summary,
          updatedAt: new Date(),
        })
        .where(eq(schema.workspace.id, workspaceId))
      return {
        id: workspaceId,
        projectId,
        projectSlug,
        organizationSlug: membership.organizationSlug,
        repositoryName: artifact.name,
        status: "error" as const,
        errorSummary: summary,
      }
    }

    await database
      .update(schema.workspace)
      .set({
        status: "ready",
        syncStatus: "ready",
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, workspaceId))

    return {
      id: workspaceId,
      projectId,
      projectSlug,
      organizationSlug: membership.organizationSlug,
      repositoryName: artifact.name,
      status: "ready" as const,
      errorSummary: null,
    }
  })

export const createWorkspace = createServerFn({ method: "POST" })
  .validator((input) => decodeCreateWorkspaceInputPromise(input))
  .handler(async ({ data }) => {
    const request = getRequest()
    const { session } = await currentSession(request)

    if (!session) throw new Error("Sign in before creating a Workspace")

    const database = drizzle(env.DB, { schema })
    const project = await database
      .select({
        id: schema.project.id,
        name: schema.project.name,
        organizationId: schema.project.organizationId,
        repositoryName: schema.project.artifactRepo,
        repositoryRemote: schema.project.artifactRemote,
        defaultRef: schema.project.defaultBranch,
      })
      .from(schema.project)
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.project.organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .where(eq(schema.project.id, data.projectId))
      .get()

    if (!project) {
      throw new Error("This Project does not exist or you cannot access it")
    }

    const existingWorkspaceCount = await database
      .select({ value: count() })
      .from(schema.workspace)
      .where(eq(schema.workspace.projectId, project.id))
      .get()
    const workspaceNumber = (existingWorkspaceCount?.value ?? 0) + 1
    const title =
      workspaceNumber === 1 ? project.name : `Workspace ${workspaceNumber}`

    const connection = await effectiveConnection(
      database,
      project.organizationId,
      session.user.id
    )

    if (!connection) {
      throw new Error(
        "Add a personal or Organization AI connection before creating a Workspace"
      )
    }

    const credential = await connectionCredential(connection)
    const workspaceId = WorkspaceId.make(crypto.randomUUID())
    const workspaceRepositoryName = `${project.repositoryName.slice(0, 44)}-${workspaceId.replaceAll("-", "").slice(0, 12)}`
    const artifacts = makeArtifactRepositoryService(env.REPOS)
    const prepared = await prepareProjectRepository(workspaceId, {
      repositoryName: project.repositoryName,
      repositoryRemote: project.repositoryRemote,
      defaultRef: project.defaultRef,
      projectName: project.name,
    })
    const workspaceRepository = await Effect.runPromise(
      artifacts.forkWorkspace({
        sourceName: project.repositoryName,
        name: workspaceRepositoryName,
        description: `Workspace for ${project.name}: ${title}`,
      })
    )
    const now = new Date()

    await database.insert(schema.workspace).values({
      id: workspaceId,
      projectId: ProjectId.make(project.id),
      organizationId: OrganizationId.make(project.organizationId),
      ownerUserId: session.user.id,
      title,
      status: "provisioning",
      repositoryMode: "fork",
      baseArtifactRepo: project.repositoryName,
      workspaceArtifactRepo: workspaceRepository.name,
      baseCommit: prepared.head,
      forkHead: prepared.head,
      syncStatus: "hydrating",
      mergeStatus: "unreviewed",
      createdAt: now,
      updatedAt: now,
    })

    waitUntil(
      completeWorkspaceInitialization(
        database,
        workspaceId,
        new InitializeWorkspaceRuntime({
          organizationId: OrganizationId.make(project.organizationId),
          projectId: ProjectId.make(project.id),
          workspaceId,
          projectName: project.name,
          repositoryName: workspaceRepository.name,
          repositoryRemote: workspaceRepository.remote,
          projectRepositoryName: project.repositoryName,
          projectRepositoryRemote: project.repositoryRemote,
          defaultRef: project.defaultRef,
          baseCommit: prepared.head,
          providerId: connection.providerId,
          modelId: connection.modelId,
          credential,
        })
      )
    )

    return {
      id: workspaceId,
      status: "provisioning" as const,
      errorSummary: null,
    }
  })

export const getWorkspace = createServerFn({ method: "GET" })
  .validator((input) => decodeWorkspaceRequestInputPromise(input))
  .handler(async ({ data }) => {
    const request = getRequest()
    const { session } = await currentSession(request)

    if (!session) {
      return null
    }

    const workspace = await drizzle(env.DB, { schema })
      .select({
        id: schema.workspace.id,
        projectId: schema.workspace.projectId,
        projectName: schema.project.name,
        projectSlug: schema.project.slug,
        organizationId: schema.workspace.organizationId,
        organizationName: schema.organization.name,
        organizationSlug: schema.organization.slug,
        title: schema.workspace.title,
        status: schema.workspace.status,
        repositoryName: schema.project.artifactRepo,
        workspaceRepositoryName: schema.workspace.workspaceArtifactRepo,
        defaultBranch: schema.project.defaultBranch,
        errorSummary: schema.workspace.errorSummary,
      })
      .from(schema.workspace)
      .innerJoin(
        schema.project,
        eq(schema.workspace.projectId, schema.project.id)
      )
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.workspace.organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .innerJoin(
        schema.organization,
        eq(schema.organization.id, schema.workspace.organizationId)
      )
      .where(eq(schema.workspace.id, data.workspaceId))
      .get()

    if (!workspace) {
      return null
    }

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(data.workspaceId)
    )
    const [response, vcsResponse] = await Promise.all([
      runtime.fetch("https://workspace/snapshot"),
      runtime.fetch("https://workspace/vcs"),
    ])

    if (!response.ok) {
      throw new Error(await response.text())
    }
    if (!vcsResponse.ok) {
      throw new Error(await vcsResponse.text())
    }

    const runtimeSnapshot = await decodeWorkspaceRuntimeHealth(
      await response.json()
    )
    const separator = runtimeSnapshot.model?.indexOf("/") ?? -1
    const conversationModel =
      runtimeSnapshot.model && separator > 0
        ? {
            providerId: runtimeSnapshot.model.slice(0, separator),
            modelId: runtimeSnapshot.model.slice(separator + 1),
          }
        : null
    const connection = await effectiveConnection(
      drizzle(env.DB, { schema }),
      workspace.organizationId,
      session.user.id,
      conversationModel
    )
    const vcsPayload = await vcsResponse.json<{
      vcs: unknown
      checkpoints: unknown
    }>()
    const versionControl = await decodeWorkspaceVersionControl(vcsPayload.vcs)
    const checkpoints = await decodeWorkspaceCheckpointList(
      vcsPayload.checkpoints
    )
    const [encodedVersionControl, encodedCheckpoints] = await Promise.all([
      encodeWorkspaceVersionControl(versionControl),
      encodeWorkspaceCheckpointList(checkpoints),
    ])

    const runtimeStatus =
      (workspace.status === "error" || workspace.errorSummary) &&
      runtimeSnapshot.status === "provisioning"
        ? "error"
        : runtimeSnapshot.status
    const status =
      workspace.status === "merging" || workspace.status === "archived"
        ? workspace.status
        : runtimeStatus

    if (
      workspace.status !== status &&
      workspace.status !== "merging" &&
      workspace.status !== "archived"
    ) {
      await drizzle(env.DB, { schema })
        .update(schema.workspace)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.workspace.id, data.workspaceId))
    }

    return {
      workspace: { ...workspace, status },
      runtime: await encodeWorkspaceRuntimeHealth(
        new WorkspaceRuntimeHealth({
          ...runtimeSnapshot,
          status: runtimeStatus,
        })
      ),
      versionControl: encodedVersionControl,
      checkpoints: encodedCheckpoints,
      models: connection?.models ?? [],
      selectedModel: connection
        ? { providerId: connection.providerId, modelId: connection.modelId }
        : null,
      modelNotice: connection?.notice ?? null,
    }
  })

export const restartWorkspace = createServerFn({ method: "POST" })
  .validator((input) => decodeRestartWorkspaceInputPromise(input))
  .handler(async ({ data }) => {
    const request = getRequest()
    const { session } = await currentSession(request)

    if (!session) throw new Error("Sign in before restarting a Workspace")

    const database = drizzle(env.DB, { schema })
    const workspace = await database
      .select({
        id: schema.workspace.id,
        projectId: schema.workspace.projectId,
        projectName: schema.project.name,
        organizationId: schema.workspace.organizationId,
        ownerUserId: schema.workspace.ownerUserId,
        repositoryName: schema.workspace.workspaceArtifactRepo,
        projectRepositoryName: schema.project.artifactRepo,
        projectRepositoryRemote: schema.project.artifactRemote,
        defaultRef: schema.project.defaultBranch,
        baseCommit: schema.workspace.baseCommit,
      })
      .from(schema.workspace)
      .innerJoin(
        schema.project,
        eq(schema.workspace.projectId, schema.project.id)
      )
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.workspace.organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .where(eq(schema.workspace.id, data.workspaceId))
      .get()

    if (!workspace) {
      throw new Error("This Workspace does not exist or you cannot access it")
    }

    const connection = await effectiveConnection(
      database,
      workspace.organizationId,
      workspace.ownerUserId,
      data.model
    )

    if (!connection) {
      throw new Error(
        "The Workspace owner needs a personal or Organization AI connection before this Workspace can restart"
      )
    }

    const credential = await connectionCredential(connection)
    const repository = await Effect.runPromise(
      makeArtifactRepositoryService(env.REPOS).inspect(workspace.repositoryName)
    )

    if (!workspace.baseCommit) {
      throw new Error("This Workspace predates Artifact-backed version control")
    }

    await database
      .update(schema.workspace)
      .set({
        status: "provisioning",
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, workspace.id))

    try {
      await initializeWorkspaceRuntime(
        workspace.id,
        new InitializeWorkspaceRuntime({
          organizationId: OrganizationId.make(workspace.organizationId),
          projectId: ProjectId.make(workspace.projectId),
          workspaceId: WorkspaceId.make(workspace.id),
          projectName: workspace.projectName,
          repositoryName: workspace.repositoryName,
          repositoryRemote: repository.remote,
          projectRepositoryName: workspace.projectRepositoryName,
          projectRepositoryRemote: workspace.projectRepositoryRemote,
          defaultRef: workspace.defaultRef,
          baseCommit: workspace.baseCommit,
          providerId: connection.providerId,
          modelId: connection.modelId,
          credential,
        })
      )
    } catch (error) {
      const summary =
        error instanceof Error && error.message
          ? error.message
          : "Workspace runtime failed"
      await database
        .update(schema.workspace)
        .set({ status: "error", errorSummary: summary, updatedAt: new Date() })
        .where(eq(schema.workspace.id, workspace.id))
      throw new Error(summary)
    }

    await database
      .update(schema.workspace)
      .set({ status: "ready", errorSummary: null, updatedAt: new Date() })
      .where(eq(schema.workspace.id, workspace.id))

    return { id: workspace.id, status: "ready" as const }
  })

export const promptWorkspace = createServerFn({ method: "POST" })
  .validator((input) => decodeWorkspacePromptInputPromise(input))
  .handler(async ({ data }) => {
    const request = getRequest()
    const { session } = await currentSession(request)

    if (!session) {
      throw new Error("Sign in before messaging OpenCode")
    }

    const database = drizzle(env.DB, { schema })
    const workspace = await database
      .select({
        id: schema.workspace.id,
        organizationId: schema.workspace.organizationId,
      })
      .from(schema.workspace)
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.workspace.organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .where(eq(schema.workspace.id, data.workspaceId))
      .get()

    if (!workspace) {
      throw new Error("This workspace does not exist or you cannot access it")
    }

    const connection = await effectiveConnection(
      database,
      workspace.organizationId,
      session.user.id,
      data.model
    )

    if (!connection) {
      throw new Error("Connect an AI provider before sending a message")
    }

    const credential = await connectionCredential(connection)

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(data.workspaceId)
    )
    const response = await runtime.fetch("https://workspace/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: data.workspaceId,
        text: data.text,
        model: {
          providerId: connection.providerId,
          modelId: connection.modelId,
        },
        credential,
      }),
    })

    if (!response.ok) {
      throw new Error(await response.text())
    }

    await database
      .update(schema.workspace)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(schema.workspace.id, data.workspaceId))

    return {
      health: await encodeWorkspaceRuntimeHealth(
        await decodeWorkspaceRuntimeHealth(await response.json())
      ),
      models: connection.models,
      selectedModel: {
        providerId: connection.providerId,
        modelId: connection.modelId,
      },
      modelNotice: connection.notice,
    }
  })

export const checkpointWorkspace = createServerFn({ method: "POST" })
  .validator((input) => decodeWorkspaceCheckpointInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())
    if (!session) throw new Error("Sign in before creating a Checkpoint")

    const database = drizzle(env.DB, { schema })
    const workspace = await database
      .select({ id: schema.workspace.id })
      .from(schema.workspace)
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.workspace.organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .where(eq(schema.workspace.id, data.workspaceId))
      .get()
    if (!workspace) {
      throw new Error("This Workspace does not exist or you cannot access it")
    }

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(data.workspaceId)
    )
    const snapshotResponse = await runtime.fetch("https://workspace/snapshot")
    if (!snapshotResponse.ok) throw new Error(await snapshotResponse.text())
    const snapshot = await decodeWorkspaceRuntimeHealth(
      await snapshotResponse.json()
    )
    if (!snapshot.opencode.healthy || snapshot.status === "running") {
      throw new Error(
        "Wait for the Workspace checks to pass before checkpointing"
      )
    }
    const response = await runtime.fetch("https://workspace/checkpoint", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error(await response.text())
    const result = await decodeWorkspaceCheckpointResult(await response.json())
    await database
      .update(schema.workspace)
      .set({
        forkHead: result.checkpoint.commit,
        syncStatus: "ready",
        mergeStatus: "ready",
        latestCheckpointAt: new Date(result.checkpoint.createdAt),
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, data.workspaceId))
    return result
  })

export const acceptWorkspace = createServerFn({ method: "POST" })
  .validator((input) => decodeWorkspaceAcceptInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())
    if (!session) throw new Error("Sign in before accepting Workspace work")

    const database = drizzle(env.DB, { schema })
    const workspace = await database
      .select({
        id: schema.workspace.id,
        status: schema.workspace.status,
        mergeStatus: schema.workspace.mergeStatus,
        projectRepositoryName: schema.project.artifactRepo,
        projectRepositoryRemote: schema.project.artifactRemote,
        workspaceRepositoryName: schema.workspace.workspaceArtifactRepo,
        defaultRef: schema.project.defaultBranch,
        baseCommit: schema.workspace.baseCommit,
        forkHead: schema.workspace.forkHead,
      })
      .from(schema.workspace)
      .innerJoin(
        schema.project,
        eq(schema.workspace.projectId, schema.project.id)
      )
      .innerJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.workspace.organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .where(eq(schema.workspace.id, data.workspaceId))
      .get()
    if (!workspace) {
      throw new Error("This Workspace does not exist or you cannot access it")
    }
    if (!workspace.baseCommit || !workspace.forkHead) {
      throw new Error("Create a Checkpoint before accepting this Workspace")
    }
    if (workspace.mergeStatus !== "ready") {
      throw new Error("This Workspace is not ready to merge")
    }

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(data.workspaceId)
    )
    const [snapshotResponse, vcsResponse] = await Promise.all([
      runtime.fetch("https://workspace/snapshot"),
      runtime.fetch("https://workspace/vcs?refresh=1"),
    ])
    if (!snapshotResponse.ok) throw new Error(await snapshotResponse.text())
    if (!vcsResponse.ok) throw new Error(await vcsResponse.text())
    const snapshot = await decodeWorkspaceRuntimeHealth(
      await snapshotResponse.json()
    )
    const vcsPayload = await vcsResponse.json<{ vcs: unknown }>()
    const versionControl = await decodeWorkspaceVersionControl(vcsPayload.vcs)
    if (
      !snapshot.opencode.healthy ||
      snapshot.status === "running" ||
      versionControl.working.length
    ) {
      throw new Error("Checkpoint all changes and pass checks before accepting")
    }

    const operationId = `${data.workspaceId}-${data.idempotencyKey}`
    const existing = await database
      .select({ status: schema.repositoryOperation.status })
      .from(schema.repositoryOperation)
      .where(eq(schema.repositoryOperation.id, operationId))
      .get()
    if (!existing) {
      await database.insert(schema.repositoryOperation).values({
        id: operationId,
        workspaceId: data.workspaceId,
        kind: "merge",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }
    const params = {
      operationId,
      workspaceId: data.workspaceId,
      projectRepositoryName: workspace.projectRepositoryName,
      projectRepositoryRemote: workspace.projectRepositoryRemote,
      workspaceRepositoryName: workspace.workspaceRepositoryName,
      workspaceRepositoryRemote: (
        await Effect.runPromise(
          makeArtifactRepositoryService(env.REPOS).inspect(
            workspace.workspaceRepositoryName
          )
        )
      ).remote,
      defaultRef: workspace.defaultRef,
      baseCommit: workspace.baseCommit,
      forkHead: workspace.forkHead,
    }
    const instance = existing
      ? await env.MERGES.get(operationId)
      : await env.MERGES.create({ id: operationId, params })
    await database
      .update(schema.workspace)
      .set({
        status: "merging",
        mergeStatus: "merging",
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, data.workspaceId))
    return { operationId: instance.id, status: "merging" as const }
  })
