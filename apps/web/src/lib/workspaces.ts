import {
  decodeCreateRepositoryInputPromise,
  decodeMagicLinkRequest,
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
      return { user: null, organizations: [], workspaces: [] }
    }

    const organizations = await auth.api.listOrganizations({
      headers: request.headers,
    })
    const database = drizzle(env.DB, { schema })
    const workspaces = await database
      .select({
        id: schema.workspace.id,
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

    return { user: session.user, organizations, workspaces }
  }
)

export const createRepository = createServerFn({ method: "POST" })
  .validator((input) => decodeCreateRepositoryInputPromise(input))
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

    const projectSlug = normalizeName(data.name)
    const requestedRepositoryName = projectSlug

    if (!projectSlug || !requestedRepositoryName) {
      throw new Error("Repository name needs a letter or number")
    }

    const repositoryName = `${membership.organizationSlug}-${requestedRepositoryName}`
    const artifact = await env.REPOS.create(repositoryName, {
      description: `${data.name} created by Sylph`,
      setDefaultBranch: "main",
    })
    const projectId = ProjectId.make(crypto.randomUUID())
    const workspaceId = WorkspaceId.make(crypto.randomUUID())
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
        repositoryMode: "base",
        baseArtifactRepo: artifact.name,
        workspaceArtifactRepo: artifact.name,
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
          repositoryName: artifact.name,
          repositoryRemote: artifact.remote,
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
      await database
        .update(schema.workspace)
        .set({ status: "error", errorSummary: await response.text() })
        .where(eq(schema.workspace.id, workspaceId))
      throw new Error(
        "The repository was created, but OpenCode failed to start"
      )
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
