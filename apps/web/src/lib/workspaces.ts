import {
  decodeCreateWorkspaceInputPromise,
  decodeCreateProjectInputPromise,
  decodeMagicLinkRequest,
  decodeOpenCodeCredentialPromise,
  decodeOpenCodeKeySetupInputPromise,
  decodeOpenCodeSubscriptionAttemptPromise,
  decodeOpenCodeSubscriptionRuntimeStatusPromise,
  decodeOpenCodeSubscriptionStartInputPromise,
  decodeOpenCodeSubscriptionStatusInputPromise,
  decodeOrganizationRequestInputPromise,
  decodeProjectRequestInputPromise,
  decodeWorkspacePromptInputPromise,
  decodeWorkspaceRequestInputPromise,
  decodeWorkspaceRuntimeHealth,
  encodeWorkspaceRuntimeHealth,
  InitializeWorkspaceRuntime,
  OpenCodeSubscriptionStatus,
  OrganizationId,
  ProjectId,
  WorkspaceId,
  WorkspaceRuntimeHealth,
} from "@workspace/domain"
import { schema } from "@workspace/db"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { env } from "cloudflare:workers"
import { and, desc, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"

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
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.userId, userId)
      )
    )
    .get()

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
      return { user: null, organizations: [], projects: [], workspaces: [] }
    }

    const organizations = await auth.api.listOrganizations({
      headers: request.headers,
    })
    const database = drizzle(env.DB, { schema })
    const projects = await database
      .select({
        id: schema.project.id,
        name: schema.project.name,
        organizationId: schema.project.organizationId,
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
      .orderBy(desc(schema.project.createdAt))
    const workspaces = await database
      .select({
        id: schema.workspace.id,
        projectId: schema.workspace.projectId,
        projectName: schema.project.name,
        title: schema.workspace.title,
        status: schema.workspace.status,
        repositoryName: schema.workspace.workspaceArtifactRepo,
        organizationId: schema.workspace.organizationId,
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
      .orderBy(desc(schema.workspace.createdAt))

    return {
      user: session.user,
      organizations,
      projects,
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
    const membership = await database
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, data.organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .get()

    if (!membership) return null

    const connection = await database
      .select({
        providerId: schema.openCodeConnection.providerId,
        modelId: schema.openCodeConnection.modelId,
        authMethod: schema.openCodeConnection.authMethod,
      })
      .from(schema.openCodeConnection)
      .where(eq(schema.openCodeConnection.organizationId, data.organizationId))
      .get()

    return connection ?? { providerId: null, modelId: null, authMethod: null }
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
        organizationId: schema.project.organizationId,
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
      .where(eq(schema.project.id, data.projectId))
      .get()

    if (!project) return null

    const setup = await database
      .select({
        providerId: schema.openCodeConnection.providerId,
        modelId: schema.openCodeConnection.modelId,
        authMethod: schema.openCodeConnection.authMethod,
      })
      .from(schema.openCodeConnection)
      .where(
        eq(schema.openCodeConnection.organizationId, project.organizationId)
      )
      .get()

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
    const membership = await organizationMembership(
      data.organizationId,
      session.user.id
    )

    if (!membership) {
      throw new Error("You cannot configure OpenCode for this Organization")
    }

    const validator = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(`opencode-setup-${data.organizationId}`)
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

    await database
      .insert(schema.openCodeConnection)
      .values({
        organizationId: data.organizationId,
        configuredByUserId: session.user.id,
        providerId: data.providerId,
        modelId: data.modelId,
        authMethod: "api-key",
        encryptedCredential: credential.encrypted,
        encryptionIv: credential.iv,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.openCodeConnection.organizationId,
        set: {
          configuredByUserId: session.user.id,
          providerId: data.providerId,
          modelId: data.modelId,
          authMethod: "api-key",
          encryptedCredential: credential.encrypted,
          encryptionIv: credential.iv,
          updatedAt: now,
        },
      })

    return { providerId: data.providerId, modelId: data.modelId }
  })

export const startOpenCodeSubscription = createServerFn({ method: "POST" })
  .validator((input) => decodeOpenCodeSubscriptionStartInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before connecting OpenCode")

    const membership = await organizationMembership(
      data.organizationId,
      session.user.id
    )

    if (!membership) {
      throw new Error("You cannot configure OpenCode for this Organization")
    }

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(`opencode-setup-${data.organizationId}`)
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

    const membership = await organizationMembership(
      data.organizationId,
      session.user.id
    )

    if (!membership) {
      throw new Error("You cannot configure OpenCode for this Organization")
    }

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(`opencode-setup-${data.organizationId}`)
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

    await drizzle(env.DB, { schema })
      .insert(schema.openCodeConnection)
      .values({
        organizationId: data.organizationId,
        configuredByUserId: session.user.id,
        providerId: subscriptionProviderId,
        modelId: data.modelId,
        authMethod: "chatgpt-subscription",
        encryptedCredential: encrypted.encrypted,
        encryptionIv: encrypted.iv,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.openCodeConnection.organizationId,
        set: {
          configuredByUserId: session.user.id,
          providerId: subscriptionProviderId,
          modelId: data.modelId,
          authMethod: "chatgpt-subscription",
          encryptedCredential: encrypted.encrypted,
          encryptionIv: encrypted.iv,
          updatedAt: now,
        },
      })

    return { status: "complete" as const, message: undefined }
  })

export const cancelOpenCodeSubscription = createServerFn({ method: "POST" })
  .validator((input) => decodeOpenCodeSubscriptionStatusInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before connecting OpenCode")

    const membership = await organizationMembership(
      data.organizationId,
      session.user.id
    )

    if (!membership) {
      throw new Error("You cannot configure OpenCode for this Organization")
    }

    const runtime = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(`opencode-setup-${data.organizationId}`)
    )
    const response = await runtime.fetch("https://workspace/oauth/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    })

    if (!response.ok) throw new Error(await response.text())
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

    const connection = await database
      .select()
      .from(schema.openCodeConnection)
      .where(eq(schema.openCodeConnection.organizationId, data.organizationId))
      .get()

    if (!connection) {
      throw new Error(
        "Connect OpenCode for this Organization before creating a Project"
      )
    }

    const credential = await connectionCredential(connection)

    const projectSlug = normalizeName(data.name)
    const requestedRepositoryName = projectSlug

    if (!projectSlug || !requestedRepositoryName) {
      throw new Error("Project name needs a letter or number")
    }

    const repositoryName = `${membership.organizationSlug}-${requestedRepositoryName}`
    const artifact = await env.REPOS.create(repositoryName, {
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

    const connection = await database
      .select()
      .from(schema.openCodeConnection)
      .where(
        eq(schema.openCodeConnection.organizationId, project.organizationId)
      )
      .get()

    if (!connection) {
      throw new Error(
        "Connect OpenCode for this Organization before creating a Workspace"
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
        organizationId: schema.workspace.organizationId,
        organizationName: schema.organization.name,
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

    const connection = await database
      .select()
      .from(schema.openCodeConnection)
      .where(
        eq(schema.openCodeConnection.organizationId, workspace.organizationId)
      )
      .get()

    if (!connection) {
      throw new Error(
        "Reconnect OpenCode for this Organization before restarting this Workspace"
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
