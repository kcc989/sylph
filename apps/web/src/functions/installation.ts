import { createServerFn } from "@tanstack/react-start"
import { schema } from "@workspace/db"
import {
  InstallationClaimRejected,
  InstallationClaimInput,
  MagicLinkRequest,
} from "@workspace/domain"
import { env } from "cloudflare:workers"
import { and, desc, eq } from "drizzle-orm"

import { authenticated, requestSession } from "@/functions/middleware"
import { assertInstallationClaimIdentity } from "@/lib/installation-claim"
import {
  ensureInstallationOwner,
  installationId,
  installationOrganizationId,
  secretsMatch,
} from "@/server/installation"
import { isOrganizationAdmin } from "@/server/organization-access"
import { Schema } from "effect"

const decodeInstallationClaimInputPromise = Schema.decodeUnknownPromise(
  InstallationClaimInput
)
const decodeMagicLinkRequest = Schema.decodeUnknownPromise(MagicLinkRequest)

export const getLatestMagicLink = createServerFn({ method: "POST" })
  .middleware([requestSession])
  .validator((input) => decodeMagicLinkRequest(input))
  .handler(async ({ data, context }) => {
    if (env.ALLOW_TEST_MAGIC_LINKS !== "true") return null

    const latest = await context.database
      .select({ url: schema.magicLinkOutbox.url })
      .from(schema.magicLinkOutbox)
      .where(eq(schema.magicLinkOutbox.email, data.email))
      .orderBy(desc(schema.magicLinkOutbox.createdAt))
      .get()

    return latest?.url ?? null
  })

export const claimInstallation = createServerFn({ method: "POST" })
  .middleware([authenticated])
  .validator((input) => decodeInstallationClaimInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, session, user } = context

    assertInstallationClaimIdentity(user, data.confirmedEmail)
    if (
      !(await secretsMatch(data.claimSecret, env.INSTALLATION_CLAIM_SECRET))
    ) {
      throw new InstallationClaimRejected({
        message: "The Installation claim secret is invalid",
      })
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
      throw new InstallationClaimRejected({
        message: "Installation storage has not been initialized",
      })
    }

    if (existing.claimed_by_user_id) {
      if (existing.claimed_by_user_id === user.id) {
        const organizationId =
          existing.organization_id ?? installationOrganizationId
        await ensureInstallationOwner(
          database,
          organizationId,
          user.id,
          session.session.id
        )
        return { organizationId }
      }
      throw new InstallationClaimRejected({
        message: "This Installation has already been claimed",
      })
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
      .bind(installationOrganizationId, user.id, installationId)
      .run()

    if (claim.meta.changes !== 1) {
      throw new InstallationClaimRejected({
        message: "This Installation was claimed by another user",
      })
    }

    await ensureInstallationOwner(
      database,
      installationOrganizationId,
      user.id,
      session.session.id
    )

    return { organizationId: installationOrganizationId }
  })

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requestSession])
  .handler(async ({ context }) => {
    const { auth, database, request, session } = context
    const authentication = {
      github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      testMagicLinks: env.ALLOW_TEST_MAGIC_LINKS === "true",
    }

    if (!session) {
      return {
        authentication,
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
        providerConnected: false,
        hasPersonalProvider: false,
      }
    }

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
      authentication,
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
      providerConnected: Boolean(
        personalConnection || organizationConnections.length
      ),
      hasPersonalProvider: Boolean(personalConnection),
      workspaces: workspaces.map((workspace) =>
        workspace.errorSummary && workspace.status === "provisioning"
          ? { ...workspace, status: "error" }
          : workspace
      ),
    }
  })
