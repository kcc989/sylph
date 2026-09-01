import {
  decodeSkillCatalogRequestPromise,
  decodeSkillDetailRequestPromise,
  decodeSkillInstallInputPromise,
} from "@workspace/domain"
import { schema } from "@workspace/db"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { env, waitUntil } from "cloudflare:workers"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"

import { createRequestAuth } from "@/server/auth.server"
import { browseSkills, reviewSkill } from "@/server/skills-sh"

const currentSession = async () => {
  const request = getRequest()
  const auth = createRequestAuth(request, env)
  return auth.api.getSession({ headers: request.headers })
}

const isAdmin = (role: string) => role === "owner" || role === "admin"

const accessibleInstallations = async (userId: string) =>
  drizzle(env.DB, { schema })
    .select({
      id: schema.skillInstallation.id,
      catalogId: schema.skillInstallation.catalogId,
      name: schema.skillInstallation.name,
      scope: schema.skillInstallation.scope,
      projectId: schema.skillInstallation.projectId,
      sourceHash: schema.skillInstallation.sourceHash,
    })
    .from(schema.skillInstallation)
    .innerJoin(
      schema.member,
      and(
        eq(
          schema.member.organizationId,
          schema.skillInstallation.organizationId
        ),
        eq(schema.member.userId, userId)
      )
    )
    .orderBy(schema.skillInstallation.name)

export const getSkillCatalog = createServerFn({ method: "GET" })
  .validator((input) => decodeSkillCatalogRequestPromise(input))
  .handler(async ({ data }) => {
    const session = await currentSession()
    if (!session) return null
    const [entries, installed] = await Promise.all([
      browseSkills(data.query),
      accessibleInstallations(session.user.id),
    ])
    return { entries, installed }
  })

export const getSkillReview = createServerFn({ method: "GET" })
  .validator((input) => decodeSkillDetailRequestPromise(input))
  .handler(async ({ data }) => {
    const session = await currentSession()
    if (!session) return null
    const [review, installed] = await Promise.all([
      reviewSkill(data.owner, data.repository, data.skill),
      accessibleInstallations(session.user.id),
    ])
    return {
      review,
      installed: installed.filter(
        (installation) => installation.catalogId === review.catalogId
      ),
    }
  })

const reloadWorkspaceSkills = async (workspaceIds: ReadonlyArray<string>) => {
  await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      const runtime = env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId))
      await runtime.fetch("https://workspace/skills/reload", {
        method: "POST",
      })
    })
  )
}

export const installSkill = createServerFn({ method: "POST" })
  .validator((input) => decodeSkillInstallInputPromise(input))
  .handler(async ({ data }) => {
    const session = await currentSession()
    if (!session) throw new Error("Sign in before installing a Skill")
    const database = drizzle(env.DB, { schema })
    const membership = await database
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, data.organizationId),
          eq(schema.member.userId, session.user.id)
        )
      )
      .get()
    if (!membership) throw new Error("You cannot access this Installation")

    const scope = data.projectId ? "project" : "installation"
    if (scope === "installation" && !isAdmin(membership.role)) {
      throw new Error("Only Installation admins can install shared Skills")
    }
    if (data.projectId) {
      const project = await database
        .select({ id: schema.project.id })
        .from(schema.project)
        .where(
          and(
            eq(schema.project.id, data.projectId),
            eq(schema.project.organizationId, data.organizationId)
          )
        )
        .get()
      if (!project)
        throw new Error("The Project does not belong to this Installation")
    }

    const parts = data.catalogId.split("/")
    if (parts.length !== 3) throw new Error("The Skill catalog ID is invalid")
    const review = await reviewSkill(parts[0], parts[1], parts[2])
    if (
      review.catalogId !== data.catalogId ||
      review.sourceHash !== data.sourceHash
    ) {
      throw new Error("The Skill source changed during review")
    }

    const targetId = data.projectId ?? data.organizationId
    const id = crypto.randomUUID()
    const now = new Date()
    const installedSkill = await database
      .insert(schema.skillInstallation)
      .values({
        id,
        organizationId: data.organizationId,
        projectId: data.projectId,
        scope,
        targetId,
        catalogId: review.catalogId,
        source: review.source,
        sourceUrl: review.sourcePageUrl,
        sourceHash: review.sourceHash,
        name: review.metadata.name,
        description: review.metadata.description,
        disableModelInvocation: review.metadata.disableModelInvocation,
        userInvokable: review.metadata.userInvokable,
        files: review.files,
        installedByUserId: session.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.skillInstallation.scope,
          schema.skillInstallation.targetId,
          schema.skillInstallation.name,
        ],
        set: {
          catalogId: review.catalogId,
          source: review.source,
          sourceUrl: review.sourcePageUrl,
          sourceHash: review.sourceHash,
          description: review.metadata.description,
          disableModelInvocation: review.metadata.disableModelInvocation,
          userInvokable: review.metadata.userInvokable,
          files: review.files,
          installedByUserId: session.user.id,
          updatedAt: now,
        },
      })
      .returning({ id: schema.skillInstallation.id })
      .get()

    const workspaces = await database
      .select({ id: schema.workspace.id })
      .from(schema.workspace)
      .where(
        data.projectId
          ? eq(schema.workspace.projectId, data.projectId)
          : eq(schema.workspace.organizationId, data.organizationId)
      )
    waitUntil(
      reloadWorkspaceSkills(workspaces.map((workspace) => workspace.id)).catch(
        () => undefined
      )
    )

    return {
      id: installedSkill.id,
      name: review.metadata.name,
      scope,
      projectId: data.projectId ?? null,
    }
  })
