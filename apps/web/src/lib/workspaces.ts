import {
  type ConnectionScope,
  decodeCreateWorkspaceInputPromise,
  decodeCreateProjectInputPromise,
  decodeGitHubApiRepositoryJsonPromise,
  decodeGitHubRepositoryLookupInputPromise,
  decodeMagicLinkRequest,
  decodeOpenCodeCredentialPromise,
  decodeOpenCodeKeySetupInputPromise,
  decodeOpenCodeSubscriptionAttemptPromise,
  decodeOpenCodeSubscriptionRuntimeStatusPromise,
  decodeOpenCodeSubscriptionStartInputPromise,
  decodeOpenCodeSubscriptionStatusInputPromise,
  decodeOrganizationRequestInputPromise,
  decodeProjectRequestInputPromise,
  decodeSetDefaultOpenCodeConnectionInputPromise,
  decodeWorkspacePromptInputPromise,
  decodeWorkspaceRequestInputPromise,
  decodeWorkspaceRuntimeHealth,
  encodeWorkspaceRuntimeHealth,
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
import { env } from "cloudflare:workers"
import { and, desc, eq } from "drizzle-orm"
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1"

import { createRequestAuth } from "@/server/auth.server"
import {
  decryptCredential,
  encryptCredential,
} from "@/server/credentials.server"

const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")

const subscriptionProviderId = "openai"

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
  userId: string
) => {
  const personal = await database
    .select()
    .from(schema.userOpenCodeConnection)
    .where(eq(schema.userOpenCodeConnection.userId, userId))
    .orderBy(
      desc(schema.userOpenCodeConnection.isDefault),
      desc(schema.userOpenCodeConnection.updatedAt)
    )
    .get()

  if (personal) return personal

  return database
    .select()
    .from(schema.openCodeConnection)
    .where(eq(schema.openCodeConnection.organizationId, organizationId))
    .orderBy(
      desc(schema.openCodeConnection.isDefault),
      desc(schema.openCodeConnection.updatedAt)
    )
    .get()
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

  return connection.authMethod === "chatgpt-subscription"
    ? decodeOpenCodeCredentialPromise(JSON.parse(plaintext))
    : decodeOpenCodeCredentialPromise({ type: "key", key: plaintext })
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

const currentSession = async (request: Request) => {
  const auth = createRequestAuth(request, env)
  const session = await auth.api.getSession({ headers: request.headers })
  return { auth, session }
}

export const getLatestMagicLink = createServerFn({ method: "POST" })
  .validator((input) => decodeMagicLinkRequest(input))
  .handler(async ({ data }) => {
    const latest = await drizzle(env.DB, { schema })
      .select({ url: schema.magicLinkOutbox.url })
      .from(schema.magicLinkOutbox)
      .where(eq(schema.magicLinkOutbox.email, data.email))
      .orderBy(desc(schema.magicLinkOutbox.createdAt))
      .get()

    return latest?.url ?? null
  })

export const getDashboard = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = getRequest()
    const { auth, session } = await currentSession(request)

    if (!session) {
      return {
        user: null,
        organizations: [],
        projects: [],
        workspaces: [],
        providerOrganizationIds: [],
        hasPersonalProvider: false,
      }
    }

    const organizations = await auth.api.listOrganizations({
      headers: request.headers,
    })
    const database = drizzle(env.DB, { schema })
    const projects = await database
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
      .orderBy(desc(schema.project.createdAt))
    const workspaces = await database
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
      .orderBy(desc(schema.workspace.createdAt))
    const organizationConnections = await database
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
      )
    const personalConnection = await database
      .select({ providerId: schema.userOpenCodeConnection.providerId })
      .from(schema.userOpenCodeConnection)
      .where(eq(schema.userOpenCodeConnection.userId, session.user.id))
      .get()

    return {
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
        modelId: schema.openCodeConnection.modelId,
        authMethod: schema.openCodeConnection.authMethod,
        isDefault: schema.openCodeConnection.isDefault,
      })
      .from(schema.openCodeConnection)
      .where(eq(schema.openCodeConnection.organizationId, data.organizationId))
      .orderBy(
        desc(schema.openCodeConnection.isDefault),
        desc(schema.openCodeConnection.updatedAt)
      )

    const personalConnections = await database
      .select({
        providerId: schema.userOpenCodeConnection.providerId,
        modelId: schema.userOpenCodeConnection.modelId,
        authMethod: schema.userOpenCodeConnection.authMethod,
        isDefault: schema.userOpenCodeConnection.isDefault,
      })
      .from(schema.userOpenCodeConnection)
      .where(eq(schema.userOpenCodeConnection.userId, session.user.id))
      .orderBy(
        desc(schema.userOpenCodeConnection.isDefault),
        desc(schema.userOpenCodeConnection.updatedAt)
      )

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

    const defaultConnection =
      personalConnections[0] ?? organizationConnections[0]

    return {
      providerId: defaultConnection?.providerId ?? null,
      modelId: defaultConnection?.modelId ?? null,
      authMethod: defaultConnection?.authMethod ?? null,
      role: membership.role,
      canManageOrganization: isOrganizationAdmin(membership.role),
      organizationConnections,
      personalConnections,
      members,
    }
  })

export const setDefaultOpenCodeConnection = createServerFn({ method: "POST" })
  .validator((input) => decodeSetDefaultOpenCodeConnectionInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before choosing a default provider")

    await connectionAccess(data.organizationId, session.user.id, data.scope)

    const database = drizzle(env.DB, { schema })
    const connection =
      data.scope === "organization"
        ? await database
            .select({ providerId: schema.openCodeConnection.providerId })
            .from(schema.openCodeConnection)
            .where(
              and(
                eq(
                  schema.openCodeConnection.organizationId,
                  data.organizationId
                ),
                eq(schema.openCodeConnection.providerId, data.providerId)
              )
            )
            .get()
        : await database
            .select({ providerId: schema.userOpenCodeConnection.providerId })
            .from(schema.userOpenCodeConnection)
            .where(
              and(
                eq(schema.userOpenCodeConnection.userId, session.user.id),
                eq(schema.userOpenCodeConnection.providerId, data.providerId)
              )
            )
            .get()

    if (!connection) throw new Error("This Provider connection does not exist")

    if (data.scope === "organization") {
      await env.DB.prepare(
        "UPDATE open_code_connection SET is_default = CASE WHEN provider_id = ? THEN 1 ELSE 0 END, updated_at = CASE WHEN provider_id = ? THEN unixepoch() ELSE updated_at END WHERE organization_id = ?"
      )
        .bind(data.providerId, data.providerId, data.organizationId)
        .run()
    } else {
      await env.DB.prepare(
        "UPDATE user_open_code_connection SET is_default = CASE WHEN provider_id = ? THEN 1 ELSE 0 END, updated_at = CASE WHEN provider_id = ? THEN unixepoch() ELSE updated_at END WHERE user_id = ?"
      )
        .bind(data.providerId, data.providerId, session.user.id)
        .run()
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

    const credential = await encryptCredential(
      data.apiKey,
      env.CREDENTIAL_ENCRYPTION_KEY
    )
    const now = new Date()
    if (data.scope === "organization") {
      const existingConnection = await database
        .select({ providerId: schema.openCodeConnection.providerId })
        .from(schema.openCodeConnection)
        .where(
          eq(schema.openCodeConnection.organizationId, data.organizationId)
        )
        .get()

      await database
        .insert(schema.openCodeConnection)
        .values({
          organizationId: data.organizationId,
          configuredByUserId: session.user.id,
          providerId: data.providerId,
          modelId: data.modelId,
          authMethod: "api-key",
          isDefault: !existingConnection,
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
            modelId: data.modelId,
            authMethod: "api-key",
            encryptedCredential: credential.encrypted,
            encryptionIv: credential.iv,
            updatedAt: now,
          },
        })
    } else {
      const existingConnection = await database
        .select({ providerId: schema.userOpenCodeConnection.providerId })
        .from(schema.userOpenCodeConnection)
        .where(eq(schema.userOpenCodeConnection.userId, session.user.id))
        .get()

      await database
        .insert(schema.userOpenCodeConnection)
        .values({
          userId: session.user.id,
          providerId: data.providerId,
          modelId: data.modelId,
          authMethod: "api-key",
          isDefault: !existingConnection,
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
            modelId: data.modelId,
            authMethod: "api-key",
            encryptedCredential: credential.encrypted,
            encryptionIv: credential.iv,
            updatedAt: now,
          },
        })
    }

    return { providerId: data.providerId, modelId: data.modelId }
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

    const encrypted = await encryptCredential(
      JSON.stringify(result.credential),
      env.CREDENTIAL_ENCRYPTION_KEY
    )
    const now = new Date()
    const database = drizzle(env.DB, { schema })
    if (data.scope === "organization") {
      const existingConnection = await database
        .select({ providerId: schema.openCodeConnection.providerId })
        .from(schema.openCodeConnection)
        .where(
          eq(schema.openCodeConnection.organizationId, data.organizationId)
        )
        .get()

      await database
        .insert(schema.openCodeConnection)
        .values({
          organizationId: data.organizationId,
          configuredByUserId: session.user.id,
          providerId: subscriptionProviderId,
          modelId: data.modelId,
          authMethod: "chatgpt-subscription",
          isDefault: !existingConnection,
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
            modelId: data.modelId,
            authMethod: "chatgpt-subscription",
            encryptedCredential: encrypted.encrypted,
            encryptionIv: encrypted.iv,
            updatedAt: now,
          },
        })
    } else {
      const existingConnection = await database
        .select({ providerId: schema.userOpenCodeConnection.providerId })
        .from(schema.userOpenCodeConnection)
        .where(eq(schema.userOpenCodeConnection.userId, session.user.id))
        .get()

      await database
        .insert(schema.userOpenCodeConnection)
        .values({
          userId: session.user.id,
          providerId: subscriptionProviderId,
          modelId: data.modelId,
          authMethod: "chatgpt-subscription",
          isDefault: !existingConnection,
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
            modelId: data.modelId,
            authMethod: "chatgpt-subscription",
            encryptedCredential: encrypted.encrypted,
            encryptionIv: encrypted.iv,
            updatedAt: now,
          },
        })
    }

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

    const repositoryName = `${membership.organizationSlug}-${requestedRepositoryName}`
    const artifact = sourceRepositoryUrl
      ? await env.REPOS.import({
          source: {
            url: sourceRepositoryUrl,
            branch: data.sourceBranch,
          },
          target: {
            name: repositoryName,
            opts: { description: `${data.name} imported by Sylph` },
          },
        })
      : await env.REPOS.create(repositoryName, {
          description: `${data.name} created by Sylph`,
          setDefaultBranch: "main",
        })
    const projectId = ProjectId.make(crypto.randomUUID())
    const workspaceId = WorkspaceId.make(crypto.randomUUID())
    const workspaceRepositoryName = `${repositoryName.slice(0, 44)}-${workspaceId.replaceAll("-", "").slice(0, 12)}`
    const baseRepository = await env.REPOS.get(artifact.name)
    const workspaceArtifact = await baseRepository.fork(
      workspaceRepositoryName,
      {
        description: `Workspace for ${data.name}`,
        defaultBranchOnly: true,
      }
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
      .set({ status: "ready", errorSummary: null, updatedAt: new Date() })
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

    const title = data.title.trim()

    if (!title) throw new Error("Workspace name needs a letter or number")

    const database = drizzle(env.DB, { schema })
    const project = await database
      .select({
        id: schema.project.id,
        name: schema.project.name,
        organizationId: schema.project.organizationId,
        repositoryName: schema.project.artifactRepo,
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
    const baseRepository = await env.REPOS.get(project.repositoryName)
    const workspaceRepository = await baseRepository.fork(
      workspaceRepositoryName,
      {
        description: `Workspace for ${project.name}: ${title}`,
        defaultBranchOnly: true,
      }
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
      createdAt: now,
      updatedAt: now,
    })

    try {
      await initializeWorkspaceRuntime(
        workspaceId,
        new InitializeWorkspaceRuntime({
          organizationId: OrganizationId.make(project.organizationId),
          projectId: ProjectId.make(project.id),
          workspaceId,
          projectName: project.name,
          repositoryName: workspaceRepository.name,
          repositoryRemote: workspaceRepository.remote,
          providerId: connection.providerId,
          modelId: connection.modelId,
          credential,
        })
      )
    } catch (error) {
      const errorSummary =
        error instanceof Error && error.message
          ? error.message
          : "Workspace runtime failed"
      await database
        .update(schema.workspace)
        .set({ status: "error", errorSummary, updatedAt: new Date() })
        .where(eq(schema.workspace.id, workspaceId))
      return { id: workspaceId, status: "error" as const, errorSummary }
    }

    await database
      .update(schema.workspace)
      .set({ status: "ready", errorSummary: null, updatedAt: new Date() })
      .where(eq(schema.workspace.id, workspaceId))

    return { id: workspaceId, status: "ready" as const, errorSummary: null }
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
    const response = await runtime.fetch("https://workspace/snapshot")

    if (!response.ok) {
      throw new Error(await response.text())
    }

    const runtimeSnapshot = await decodeWorkspaceRuntimeHealth(
      await response.json()
    )

    const status =
      (workspace.status === "error" || workspace.errorSummary) &&
      runtimeSnapshot.status === "provisioning"
        ? "error"
        : runtimeSnapshot.status

    if (workspace.status !== status) {
      await drizzle(env.DB, { schema })
        .update(schema.workspace)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.workspace.id, data.workspaceId))
    }

    return {
      workspace: { ...workspace, status },
      runtime: await encodeWorkspaceRuntimeHealth(
        new WorkspaceRuntimeHealth({ ...runtimeSnapshot, status })
      ),
    }
  })

export const restartWorkspace = createServerFn({ method: "POST" })
  .validator((input) => decodeWorkspaceRequestInputPromise(input))
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
      workspace.ownerUserId
    )

    if (!connection) {
      throw new Error(
        "The Workspace owner needs a personal or Organization AI connection before this Workspace can restart"
      )
    }

    const credential = await connectionCredential(connection)
    const repository = await env.REPOS.get(workspace.repositoryName)

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
      throw new Error("This workspace does not exist or you cannot access it")
    }

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(data.workspaceId)
    )
    const response = await runtime.fetch("https://workspace/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      throw new Error(await response.text())
    }

    await database
      .update(schema.workspace)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(schema.workspace.id, data.workspaceId))

    return encodeWorkspaceRuntimeHealth(
      await decodeWorkspaceRuntimeHealth(await response.json())
    )
  })
