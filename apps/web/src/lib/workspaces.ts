import {
  decodeCreateProjectInputPromise,
  decodeMagicLinkRequest,
  decodeOpenCodeSetupInputPromise,
  decodeWorkspacePromptInputPromise,
  decodeWorkspaceRequestInputPromise,
  decodeWorkspaceRuntimeHealth,
  encodeWorkspaceRuntimeHealth,
  ProjectId,
  WorkspaceId,
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

    return { user: session.user, organizations, projects, workspaces }
  }
)

export const getOpenCodeSetup = createServerFn({ method: "GET" }).handler(
  async () => {
    const { session } = await currentSession(getRequest())

    if (!session) return null

    const connection = await drizzle(env.DB, { schema })
      .select({
        providerId: schema.openCodeConnection.providerId,
        modelId: schema.openCodeConnection.modelId,
      })
      .from(schema.openCodeConnection)
      .where(eq(schema.openCodeConnection.userId, session.user.id))
      .get()

    return connection ?? { providerId: null, modelId: null }
  }
)

export const saveOpenCodeSetup = createServerFn({ method: "POST" })
  .validator((input) => decodeOpenCodeSetupInputPromise(input))
  .handler(async ({ data }) => {
    const { session } = await currentSession(getRequest())

    if (!session) throw new Error("Sign in before connecting OpenCode")

    const validator = env.WORKSPACES.get(
      env.WORKSPACES.idFromName(`opencode-setup-${session.user.id}`)
    )
    const validation = await validator.fetch("https://workspace/connect", {
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

    await drizzle(env.DB, { schema })
      .insert(schema.openCodeConnection)
      .values({
        userId: session.user.id,
        providerId: data.providerId,
        modelId: data.modelId,
        encryptedApiKey: credential.encrypted,
        encryptionIv: credential.iv,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.openCodeConnection.userId,
        set: {
          providerId: data.providerId,
          modelId: data.modelId,
          encryptedApiKey: credential.encrypted,
          encryptionIv: credential.iv,
          updatedAt: now,
        },
      })

    return { providerId: data.providerId, modelId: data.modelId }
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
    const connection = await database
      .select()
      .from(schema.openCodeConnection)
      .where(eq(schema.openCodeConnection.userId, session.user.id))
      .get()

    if (!connection) {
      throw new Error("Connect OpenCode before creating a Project")
    }

    const apiKey = await decryptCredential(
      connection.encryptedApiKey,
      connection.encryptionIv,
      env.CREDENTIAL_ENCRYPTION_KEY
    )
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

    await database.batch([
      database.insert(schema.project).values({
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
      }),
      database.insert(schema.workspace).values({
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
      }),
    ])

    const runtime = env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId))
    let response: Response

    try {
      response = await runtime.fetch("https://workspace/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: data.organizationId,
          projectId,
          workspaceId,
          projectName: data.name,
          repositoryName: workspaceArtifact.name,
          repositoryRemote: workspaceArtifact.remote,
          providerId: connection.providerId,
          modelId: connection.modelId,
          apiKey,
        }),
      })
    } catch (error) {
      console.error("Workspace runtime initialization failed", error)
      await database
        .update(schema.workspace)
        .set({
          status: "error",
          errorSummary: "Runtime initialization failed",
        })
        .where(eq(schema.workspace.id, workspaceId))
      throw error
    }

    if (!response.ok) {
      const errorSummary = await response.text()
      await database
        .update(schema.workspace)
        .set({ status: "error", errorSummary })
        .where(eq(schema.workspace.id, workspaceId))
      throw new Error(errorSummary)
    }

    await database
      .update(schema.workspace)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(schema.workspace.id, workspaceId))

    return {
      id: workspaceId,
      projectId,
      repositoryName: artifact.name,
      status: "ready" as const,
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
        organizationId: schema.workspace.organizationId,
        organizationName: schema.organization.name,
        title: schema.workspace.title,
        status: schema.workspace.status,
        repositoryName: schema.project.artifactRepo,
        workspaceRepositoryName: schema.workspace.workspaceArtifactRepo,
        defaultBranch: schema.project.defaultBranch,
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

    if (workspace.status !== runtimeSnapshot.status) {
      await drizzle(env.DB, { schema })
        .update(schema.workspace)
        .set({ status: runtimeSnapshot.status, updatedAt: new Date() })
        .where(eq(schema.workspace.id, data.workspaceId))
    }

    return {
      workspace: { ...workspace, status: runtimeSnapshot.status },
      runtime: await encodeWorkspaceRuntimeHealth(runtimeSnapshot),
    }
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
