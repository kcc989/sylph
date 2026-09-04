import { schema } from "@workspace/db"
import {
  SyncProjectRepositoryInput,
  ProjectSynchronizationInput,
  ProjectId,
  type SyncProjectRepositoryResult,
} from "@workspace/domain"
import { env } from "cloudflare:workers"
import { Effect, Schema } from "effect"
import { and, eq } from "drizzle-orm"

import {
  GitHubRepositoryLive,
  GitHubRepositoryService,
} from "@/server/github-repository-service"
import type { Database } from "@/server/organization-access"
import { syncProjectRepository } from "@/server/project-repository-git"

export const githubUserAccessToken = async (
  database: Database,
  userId: string
) => {
  const account = await database
    .select({
      id: schema.account.id,
      accessToken: schema.account.accessToken,
      refreshToken: schema.account.refreshToken,
      accessTokenExpiresAt: schema.account.accessTokenExpiresAt,
    })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, "github")
      )
    )
    .get()
  if (!account?.accessToken) return undefined
  if (
    !account.accessTokenExpiresAt ||
    account.accessTokenExpiresAt.getTime() > Date.now() + 60_000
  ) {
    return account.accessToken
  }
  if (
    !account.refreshToken ||
    !env.GITHUB_CLIENT_ID ||
    !env.GITHUB_CLIENT_SECRET
  ) {
    return undefined
  }
  const refreshToken = account.refreshToken
  const refreshed = await Effect.runPromise(
    Effect.gen(function* () {
      const github = yield* GitHubRepositoryService
      return yield* github.refreshUserAccessToken({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        refreshToken,
      })
    }).pipe(Effect.provide(GitHubRepositoryLive))
  ).catch(() => null)
  if (!refreshed) return undefined
  const now = Date.now()
  await database
    .update(schema.account)
    .set({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accessTokenExpiresAt: new Date(now + refreshed.expiresIn * 1000),
      refreshTokenExpiresAt: new Date(
        now + refreshed.refreshTokenExpiresIn * 1000
      ),
      updatedAt: new Date(),
    })
    .where(eq(schema.account.id, account.id))
  return refreshed.accessToken
}

export const synchronizeProjectRepositoryDirect = async (
  database: Database,
  userId: string,
  project: {
    id: string
    repositoryName: string
    repositoryRemote: string
    defaultRef: string
    sourceUrl: string | null
    sourceRef: string | null
  },
  previous?: SyncProjectRepositoryResult
) => {
  if (!project.sourceUrl) return null
  const accessToken = await githubUserAccessToken(database, userId)
  const input = new SyncProjectRepositoryInput({
    repositoryName: project.repositoryName,
    repositoryRemote: project.repositoryRemote,
    defaultRef: project.defaultRef,
    sourceRemote: `${project.sourceUrl}.git`,
    sourceRef: project.sourceRef ?? project.defaultRef,
    sourceAccessToken: accessToken,
  })
  const result = await syncProjectRepository(
    env.REPOS,
    input,
    undefined,
    previous
  ).catch(() => null)
  if (!result) {
    await database
      .update(schema.project)
      .set({
        upstreamStatus: accessToken
          ? "synchronization_error"
          : "authorization_required",
        upstreamSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.project.id, project.id))
    return null
  }
  await database
    .update(schema.project)
    .set({
      upstreamHead: result.upstreamHead,
      upstreamStatus: result.status,
      upstreamSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.project.id, project.id))
  return result
}

const encodeSynchronizationInput = Schema.encodeSync(
  ProjectSynchronizationInput
)

export const synchronizeProjectRepository = (
  _database: Database,
  userId: string,
  project: Parameters<typeof synchronizeProjectRepositoryDirect>[2]
) => {
  if (!project.sourceUrl) return Promise.resolve(null)
  return env.PROJECT_SYNCS.get(
    env.PROJECT_SYNCS.idFromName(project.id)
  ).synchronize(
    encodeSynchronizationInput(
      new ProjectSynchronizationInput({
        ...project,
        id: ProjectId.make(project.id),
        userId,
      })
    )
  )
}
