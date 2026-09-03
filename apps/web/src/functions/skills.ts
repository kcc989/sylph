import { createServerFn } from "@tanstack/react-start"
import { schema } from "@workspace/db"
import {
  AccessDenied,
  InvalidRequest,
  PreconditionFailed,
  SkillCatalogRequest,
  SkillDetailRequest,
  SkillInstallInput,
} from "@workspace/domain"
import { waitUntil } from "cloudflare:workers"
import { and, eq } from "drizzle-orm"

import { organizationMember, requestSession } from "@/functions/middleware"
import {
  isOrganizationAdmin,
  type Database,
} from "@/server/organization-access"
import { browseSkills, reviewSkill } from "@/server/skills-sh"
import { workspaceRuntime } from "@/server/workspace-runtime"
import { Schema } from "effect"

const decodeSkillCatalogRequestPromise =
  Schema.decodeUnknownPromise(SkillCatalogRequest)
const decodeSkillDetailRequestPromise =
  Schema.decodeUnknownPromise(SkillDetailRequest)
const decodeSkillInstallInputPromise =
  Schema.decodeUnknownPromise(SkillInstallInput)

const accessibleInstallations = (database: Database, userId: string) =>
  database
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

const reloadWorkspaceSkills = (workspaceIds: ReadonlyArray<string>) =>
  Promise.all(
    workspaceIds.map((workspaceId) =>
      workspaceRuntime(workspaceId).reloadSkills()
    )
  )

export const getSkillCatalog = createServerFn({ method: "GET" })
  .middleware([requestSession])
  .validator((input) => decodeSkillCatalogRequestPromise(input))
  .handler(async ({ data, context }) => {
    const { database, session } = context
    if (!session) return null
    const [entries, installed] = await Promise.all([
      browseSkills(data.query),
      accessibleInstallations(database, session.user.id),
    ])
    return { entries, installed }
  })

export const getSkillReview = createServerFn({ method: "GET" })
  .middleware([requestSession])
  .validator((input) => decodeSkillDetailRequestPromise(input))
  .handler(async ({ data, context }) => {
    const { database, session } = context
    if (!session) return null
    const [review, installed] = await Promise.all([
      reviewSkill(data.owner, data.repository, data.skill),
      accessibleInstallations(database, session.user.id),
    ])
    return {
      review,
      installed: installed.filter(
        (installation) => installation.catalogId === review.catalogId
      ),
    }
  })

export const installSkill = createServerFn({ method: "POST" })
  .middleware([organizationMember])
  .validator((input) => decodeSkillInstallInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, membership, user } = context

    const scope = data.projectId ? "project" : "installation"
    if (scope === "installation" && !isOrganizationAdmin(membership.role)) {
      throw new AccessDenied({
        message: "Only Installation admins can install shared Skills",
        resource: "installation",
      })
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
      if (!project) {
        throw new AccessDenied({
          message: "The Project does not belong to this Installation",
          resource: "project",
        })
      }
    }

    const parts = data.catalogId.split("/")
    if (parts.length !== 3) {
      throw new InvalidRequest({ message: "The Skill catalog ID is invalid" })
    }
    const review = await reviewSkill(parts[0], parts[1], parts[2])
    if (
      review.catalogId !== data.catalogId ||
      review.sourceHash !== data.sourceHash
    ) {
      throw new PreconditionFailed({
        message: "The Skill source changed during review",
      })
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
        installedByUserId: user.id,
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
          installedByUserId: user.id,
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
