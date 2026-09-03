import { schema } from "@workspace/db"
import {
  SyncProjectRepositoryInput,
  SyncProjectRepositoryResult,
} from "@workspace/domain"
import { env } from "cloudflare:workers"
import { Effect, Schema } from "effect"
import { and, eq } from "drizzle-orm"

import {
  GitHubRepositoryLive,
  GitHubRepositoryService,
} from "@/server/github-repository-service"
import type { Database } from "@/server/organization-access"
import { workspaceRuntime } from "@/server/workspace-runtime"

const decodeSyncProjectRepositoryResultPromise = Schema.decodeUnknownPromise(
  SyncProjectRepositoryResult
)

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

export const synchronizeProjectRepository = async (
  database: Database,
  userId: string,
  project: {
    id: string
    repositoryName: string
    repositoryRemote: string
    defaultRef: string
    sourceUrl: string | null
    sourceRef: string | null
  }
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
  const synchronized = await workspaceRuntime(`repository-sync-${project.id}`)
    .synchronizeProject(input)
    .catch(() => null)
  if (!synchronized) {
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
  const result = await decodeSyncProjectRepositoryResultPromise(synchronized)
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
