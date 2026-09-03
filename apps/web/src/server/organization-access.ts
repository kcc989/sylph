import { schema } from "@workspace/db"
import {
  AccessDenied,
  WorkspaceReadOnly,
  type ConnectionScope,
} from "@workspace/domain"
import { and, eq } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"

export type Database = DrizzleD1Database<typeof schema>

export const isOrganizationAdmin = (role: string) =>
  role === "owner" || role === "admin"

export const organizationMembership = (
  database: Database,
  organizationId: string,
  userId: string
) =>
  database
    .select({
      id: schema.member.id,
      role: schema.member.role,
      organizationId: schema.member.organizationId,
      organizationSlug: schema.organization.slug,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.member.organizationId)
    )
    .where(
      and(
        eq(schema.member.organizationId, organizationId),
        eq(schema.member.userId, userId)
      )
    )
    .get()

export const requireOrganizationMembership = async (
  database: Database,
  organizationId: string,
  userId: string
) => {
  const membership = await organizationMembership(
    database,
    organizationId,
    userId
  )
  if (!membership) {
    throw new AccessDenied({
      message: "You are not a member of this Organization",
      resource: "organization",
    })
  }
  return membership
}

export const requireConnectionAccess = async (
  database: Database,
  organizationId: string,
  userId: string,
  scope: ConnectionScope
) => {
  const membership = await requireOrganizationMembership(
    database,
    organizationId,
    userId
  )
  if (scope === "organization" && !isOrganizationAdmin(membership.role)) {
    throw new AccessDenied({
      message: "Only Organization admins can manage shared AI connections",
      resource: "organization",
    })
  }
  return membership
}

export const accessibleProject = (
  database: Database,
  projectId: string,
  userId: string
) =>
  database
    .select({
      id: schema.project.id,
      name: schema.project.name,
      slug: schema.project.slug,
      organizationId: schema.project.organizationId,
      organizationSlug: schema.organization.slug,
      ownerUserId: schema.project.ownerUserId,
      repositoryName: schema.project.artifactRepo,
      repositoryRemote: schema.project.artifactRemote,
      defaultBranch: schema.project.defaultBranch,
      importOriginUrl: schema.project.importOriginUrl,
      importOriginBranch: schema.project.importOriginBranch,
      upstreamHead: schema.project.upstreamHead,
      upstreamStatus: schema.project.upstreamStatus,
      upstreamSyncedAt: schema.project.upstreamSyncedAt,
      deliveryMode: schema.project.deliveryMode,
      deliveredCommit: schema.project.deliveredCommit,
      deliveryUrl: schema.project.deliveryUrl,
    })
    .from(schema.project)
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.organizationId, schema.project.organizationId),
        eq(schema.member.userId, userId)
      )
    )
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.project.organizationId)
    )
    .where(eq(schema.project.id, projectId))
    .get()

export type AccessibleProject = NonNullable<
  Awaited<ReturnType<typeof accessibleProject>>
>

export const requireProject = async (
  database: Database,
  projectId: string,
  userId: string
) => {
  const project = await accessibleProject(database, projectId, userId)
  if (!project) {
    throw new AccessDenied({
      message: "This Project does not exist or you cannot access it",
      resource: "project",
    })
  }
  return project
}

export const accessibleWorkspace = (
  database: Database,
  workspaceId: string,
  userId: string
) =>
  database
    .select({
      id: schema.workspace.id,
      projectId: schema.workspace.projectId,
      organizationId: schema.workspace.organizationId,
      ownerUserId: schema.workspace.ownerUserId,
      title: schema.workspace.title,
      status: schema.workspace.status,
      repositoryName: schema.workspace.workspaceArtifactRepo,
      baseRepositoryName: schema.workspace.baseArtifactRepo,
      baseCommit: schema.workspace.baseCommit,
      forkHead: schema.workspace.forkHead,
      acceptedCommit: schema.workspace.acceptedCommit,
      syncStatus: schema.workspace.syncStatus,
      mergeStatus: schema.workspace.mergeStatus,
      errorSummary: schema.workspace.errorSummary,
      archivedAt: schema.workspace.archivedAt,
    })
    .from(schema.workspace)
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.organizationId, schema.workspace.organizationId),
        eq(schema.member.userId, userId)
      )
    )
    .where(eq(schema.workspace.id, workspaceId))
    .get()

export type AccessibleWorkspace = NonNullable<
  Awaited<ReturnType<typeof accessibleWorkspace>>
>

export const requireWorkspace = async (
  database: Database,
  workspaceId: string,
  userId: string
) => {
  const workspace = await accessibleWorkspace(database, workspaceId, userId)
  if (!workspace) {
    throw new AccessDenied({
      message: "This Workspace does not exist or you cannot access it",
      resource: "workspace",
    })
  }
  return workspace
}

export const requireWorkspaceNotMerging = <
  Workspace extends { readonly status: string },
>(
  workspace: Workspace
) => {
  if (workspace.status === "merging") {
    throw new WorkspaceReadOnly({
      message: "Wait for Workspace acceptance to finish",
      status: "merging",
    })
  }
  return workspace
}

export const requireWritableWorkspace = <
  Workspace extends { readonly status: string },
>(
  workspace: Workspace
) => {
  if (workspace.status === "archived") {
    throw new WorkspaceReadOnly({
      message: "Archived Workspaces are read-only",
      status: "archived",
    })
  }
  return requireWorkspaceNotMerging(workspace)
}

export const workspaceProject = (database: Database, projectId: string) =>
  database
    .select({
      id: schema.project.id,
      name: schema.project.name,
      slug: schema.project.slug,
      organizationId: schema.project.organizationId,
      repositoryName: schema.project.artifactRepo,
      repositoryRemote: schema.project.artifactRemote,
      defaultBranch: schema.project.defaultBranch,
      importOriginUrl: schema.project.importOriginUrl,
      importOriginBranch: schema.project.importOriginBranch,
    })
    .from(schema.project)
    .where(eq(schema.project.id, projectId))
    .get()

export const requireWorkspaceProject = async (
  database: Database,
  projectId: string
) => {
  const project = await workspaceProject(database, projectId)
  if (!project) {
    throw new AccessDenied({
      message: "This Project does not exist or you cannot access it",
      resource: "project",
    })
  }
  return project
}
