import { createMiddleware } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import {
  AuthenticationRequired,
  ConnectionScope,
  IssueId,
  OrganizationId,
  ProjectId,
  WorkspaceId,
} from "@workspace/domain"
import { Schema } from "effect"

import {
  requireConnectionAccess,
  requireIssue,
  requireOrganizationMembership,
  requireProject,
  requireWorkspace,
  requireWritableWorkspace,
} from "@/server/organization-access"
import { createRequestSession } from "@/server/request-session"

const decodeOrganizationScope = Schema.decodeUnknownPromise(
  Schema.Struct({ organizationId: OrganizationId }),
  { onExcessProperty: "preserve" }
)
const decodeConnectionScope = Schema.decodeUnknownPromise(
  Schema.Struct({ organizationId: OrganizationId, scope: ConnectionScope }),
  { onExcessProperty: "preserve" }
)
const decodeProjectScope = Schema.decodeUnknownPromise(
  Schema.Struct({ projectId: ProjectId }),
  { onExcessProperty: "preserve" }
)
const decodeWorkspaceScope = Schema.decodeUnknownPromise(
  Schema.Struct({ workspaceId: WorkspaceId }),
  { onExcessProperty: "preserve" }
)
const decodeIssueScope = Schema.decodeUnknownPromise(
  Schema.Struct({ issueId: IssueId }),
  { onExcessProperty: "preserve" }
)

export const requestSession = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest()
    const { auth, session, database } = await createRequestSession(request)
    return next({ context: { request, auth, session, database } })
  }
)

export const authenticated = createMiddleware({ type: "function" })
  .middleware([requestSession])
  .server(async ({ context, next }) => {
    if (!context.session) {
      throw new AuthenticationRequired({ message: "Sign in to continue" })
    }
    return next({
      context: { session: context.session, user: context.session.user },
    })
  })

export const organizationMember = createMiddleware({ type: "function" })
  .middleware([authenticated])
  .validator((input) => decodeOrganizationScope(input))
  .server(async ({ data, context, next }) => {
    const membership = await requireOrganizationMembership(
      context.database,
      data.organizationId,
      context.user.id
    )
    return next({ context: { membership } })
  })

export const connectionManager = createMiddleware({ type: "function" })
  .middleware([authenticated])
  .validator((input) => decodeConnectionScope(input))
  .server(async ({ data, context, next }) => {
    const membership = await requireConnectionAccess(
      context.database,
      data.organizationId,
      context.user.id,
      data.scope
    )
    return next({ context: { membership } })
  })

export const projectMember = createMiddleware({ type: "function" })
  .middleware([authenticated])
  .validator((input) => decodeProjectScope(input))
  .server(async ({ data, context, next }) => {
    const project = await requireProject(
      context.database,
      data.projectId,
      context.user.id
    )
    return next({ context: { project } })
  })

export const workspaceMember = createMiddleware({ type: "function" })
  .middleware([authenticated])
  .validator((input) => decodeWorkspaceScope(input))
  .server(async ({ data, context, next }) => {
    const workspace = await requireWorkspace(
      context.database,
      data.workspaceId,
      context.user.id
    )
    return next({ context: { workspace } })
  })

export const issueMember = createMiddleware({ type: "function" })
  .middleware([authenticated])
  .validator((input) => decodeIssueScope(input))
  .server(async ({ data, context, next }) => {
    const issue = await requireIssue(
      context.database,
      data.issueId,
      context.user.id
    )
    return next({ context: { issue } })
  })

export const writableWorkspace = createMiddleware({ type: "function" })
  .middleware([workspaceMember])
  .server(async ({ context, next }) => {
    requireWritableWorkspace(context.workspace)
    return next()
  })
