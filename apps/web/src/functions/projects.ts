import { createServerFn } from "@tanstack/react-start"
import { schema } from "@workspace/db"
import {
  AccessDenied,
  decodeCiRunRecordList,
  decodeCiRunSummary,
  decodeCreateProjectInputPromise,
  decodeGitHubRepositoryLookupInputPromise,
  decodeOrganizationRequestInputPromise,
  decodeProjectDeliveryModeInputPromise,
  decodeProjectDeployInputPromise,
  decodeProjectRequestInputPromise,
  encodeCiRunRecordList,
  encodeGitHubRepositoryInfo,
  encodeProjectTemplateCatalog,
  failureMessage,
  GitCommitId,
  InitializeWorkspaceRuntime,
  InvalidRequest,
  parseGitHubRepositoryUrl,
  PreconditionFailed,
  productionDeployConfirmed,
  PrepareProjectRepositoryInput,
  ProjectId,
  type ProjectSource,
  WorkspaceId,
  type WorkspaceCiInput,
} from "@workspace/domain"
import { env } from "cloudflare:workers"
import { and, desc, eq, isNull } from "drizzle-orm"
import { Effect } from "effect"

import { organizationMember, projectMember } from "@/functions/middleware"
import { deploymentWorkflowAlreadyStarted } from "@/server/deployment-records"
import {
  GitHubRepositoryLive,
  GitHubRepositoryService,
} from "@/server/github-repository-service"
import {
  githubUserAccessToken,
  prepareProjectRepository,
} from "@/server/project-repository-sync"
import {
  isOrganizationAdmin,
  requireOrganizationMembership,
} from "@/server/organization-access"
import { requireProjectProviderConnection } from "@/server/project-provider-guard"
import {
  ensureTemplateRepository,
  projectTemplateCatalog,
  resolveProjectTemplate,
} from "@/server/project-templates"
import {
  connectionCredential,
  effectiveConnection,
} from "@/server/provider-connections"
import { recoveryRepositoryEntry } from "@/server/recovery-export"
import {
  makeCloudflareArtifactsRepositoryStore,
  type RepositoryStore,
} from "@/server/repository-store"
import { initializeWorkspaceRuntime } from "@/server/workspace-runtime"

const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")

export const getWorkspaceCreationContext = createServerFn({ method: "GET" })
  .middleware([projectMember])
  .validator((input) => decodeProjectRequestInputPromise(input))
  .handler(async ({ context }) => {
    const { database, project, user } = context
    const setup = await effectiveConnection(
      database,
      project.organizationId,
      user.id
    )

    return {
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        organizationId: project.organizationId,
        organizationSlug: project.organizationSlug,
        repositoryName: project.repositoryName,
        defaultBranch: project.defaultBranch,
        importOriginUrl: project.importOriginUrl,
        importOriginBranch: project.importOriginBranch,
        upstreamHead: project.upstreamHead,
        upstreamStatus: project.upstreamStatus,
        upstreamSyncedAt: project.upstreamSyncedAt,
        deliveryMode: project.deliveryMode,
        deliveredCommit: project.deliveredCommit,
        deliveryUrl: project.deliveryUrl,
        templateKey: project.templateKey,
        templateRepo: project.templateRepo,
        templateCommit: project.templateCommit,
      },
      setup: setup ?? { providerId: null, modelId: null, authMethod: null },
    }
  })

export const getProjectDeployments = createServerFn({ method: "GET" })
  .middleware([projectMember])
  .validator((input) => decodeProjectRequestInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database } = context
    const [acceptedRows, deployments, checkRows] = await Promise.all([
      database
        .select({
          commit: schema.workspace.acceptedCommit,
          acceptedAt: schema.workspace.archivedAt,
        })
        .from(schema.workspace)
        .where(eq(schema.workspace.projectId, data.projectId))
        .orderBy(desc(schema.workspace.archivedAt)),
      database
        .select({
          id: schema.deployment.id,
          commit: schema.deployment.commit,
          status: schema.deployment.status,
          productionUrl: schema.deployment.productionUrl,
          actorName: schema.user.name,
          failureDetails: schema.deployment.failureDetails,
          startedAt: schema.deployment.startedAt,
          completedAt: schema.deployment.completedAt,
          createdAt: schema.deployment.createdAt,
        })
        .from(schema.deployment)
        .innerJoin(
          schema.user,
          eq(schema.user.id, schema.deployment.actorUserId)
        )
        .where(eq(schema.deployment.projectId, data.projectId))
        .orderBy(desc(schema.deployment.createdAt)),
      database
        .select({
          id: schema.ciRun.id,
          projectId: schema.ciRun.projectId,
          workspaceId: schema.ciRun.workspaceId,
          workspaceTitle: schema.workspace.title,
          commit: schema.ciRun.commitSha,
          kind: schema.ciRun.kind,
          status: schema.ciRun.status,
          summaryJson: schema.ciRun.summaryJson,
          startedAt: schema.ciRun.startedAt,
          finishedAt: schema.ciRun.finishedAt,
          createdAt: schema.ciRun.createdAt,
        })
        .from(schema.ciRun)
        .innerJoin(
          schema.workspace,
          eq(schema.workspace.id, schema.ciRun.workspaceId)
        )
        .where(eq(schema.ciRun.projectId, data.projectId))
        .orderBy(desc(schema.ciRun.createdAt))
        .limit(20),
    ])
    const checks = await encodeCiRunRecordList(
      await decodeCiRunRecordList(
        checkRows.map((row) => ({
          id: row.id,
          projectId: row.projectId,
          workspaceId: row.workspaceId,
          workspaceTitle: row.workspaceTitle,
          commit: row.commit,
          kind: row.kind,
          status: row.status,
          summary: row.summaryJson
            ? decodeCiRunSummary(JSON.parse(row.summaryJson))
            : null,
          startedAt: row.startedAt?.getTime() ?? null,
          finishedAt: row.finishedAt?.getTime() ?? null,
          createdAt: row.createdAt.getTime(),
        }))
      )
    )
    const acceptedCommits = Array.from(
      new Map(
        acceptedRows
          .filter((row): row is { commit: string; acceptedAt: Date | null } =>
            Boolean(row.commit)
          )
          .map((row) => [row.commit, row])
      ).values()
    )
    return { acceptedCommits, deployments, checks }
  })

export const deployProjectCommit = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator((input) => decodeProjectDeployInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, project, user } = context
    if (!productionDeployConfirmed(data)) {
      throw new PreconditionFailed({
        message:
          "Confirm the exact Accepted commit before deploying to production",
      })
    }
    const membership = await requireOrganizationMembership(
      database,
      project.organizationId,
      user.id
    )
    if (!isOrganizationAdmin(membership.role)) {
      throw new AccessDenied({
        message: "Only Organization Admins can deploy or roll back production",
        resource: "project",
      })
    }
    const accepted = await database
      .select({ workspaceId: schema.workspace.id })
      .from(schema.workspace)
      .where(
        and(
          eq(schema.workspace.projectId, data.projectId),
          eq(schema.workspace.acceptedCommit, data.commit)
        )
      )
      .get()
    if (!accepted) {
      throw new PreconditionFailed({
        message: "Only an Accepted commit can be deployed",
      })
    }
    const deploymentId = `${data.projectId}-${data.idempotencyKey}`
    const existing = await database
      .select({ status: schema.deployment.status })
      .from(schema.deployment)
      .where(eq(schema.deployment.id, deploymentId))
      .get()
    if (existing) return { id: deploymentId, status: existing.status }
    const createdAt = Date.now()
    await database.insert(schema.deployment).values({
      id: deploymentId,
      projectId: data.projectId,
      commit: data.commit,
      status: "queued",
      actorUserId: user.id,
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    })
    const params: WorkspaceCiInput = {
      provider: "cloudflare-artifacts",
      providerData: { namespace: env.REPOSITORY_NAMESPACE },
      event: { type: "push" },
      owner: env.REPOSITORY_NAMESPACE,
      repo: project.repositoryName,
      sha: GitCommitId.make(data.commit),
      remote: "cloudflare",
      trigger: "push",
      ref: `refs/heads/${project.defaultBranch}`,
      branch: project.defaultBranch,
      checkRunId: deploymentId,
      projectId: data.projectId,
      workspaceId: WorkspaceId.make(accepted.workspaceId),
      agentSessionId: null,
      checkpointId: null,
      kind: "production",
      attempt: 1,
      repairOnFailure: false,
      deploymentId,
      createdAt,
    }
    try {
      await env.CI_WORKFLOW.create({
        id: `${deploymentId}-attempt-1`,
        params,
      })
    } catch (cause) {
      if (!deploymentWorkflowAlreadyStarted(cause)) {
        await database
          .update(schema.deployment)
          .set({
            status: "failed",
            failureDetails: failureMessage(cause, "Deployment could not start"),
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.deployment.id, deploymentId))
        throw cause
      }
    }
    return { id: deploymentId, status: "queued" as const }
  })

export const setProjectDeliveryMode = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator((input) => decodeProjectDeliveryModeInputPromise(input))
  .handler(async ({ data, context }) => {
    await context.database
      .update(schema.project)
      .set({ deliveryMode: data.mode, updatedAt: new Date() })
      .where(eq(schema.project.id, data.projectId))
    return { mode: data.mode }
  })

export const exportProjectRecovery = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator((input) => decodeProjectRequestInputPromise(input))
  .handler(async ({ context }) => {
    const { database, project } = context
    const workspaces = await database
      .select({
        id: schema.workspace.id,
        title: schema.workspace.title,
        repositoryName: schema.workspace.workspaceArtifactRepo,
        baseCommit: schema.workspace.baseCommit,
        forkHead: schema.workspace.forkHead,
        acceptedCommit: schema.workspace.acceptedCommit,
      })
      .from(schema.workspace)
      .where(
        and(
          eq(schema.workspace.projectId, project.id),
          isNull(schema.workspace.forkDeletedAt)
        )
      )
    const repositories = makeCloudflareArtifactsRepositoryStore(env.REPOS)
    const entries = await Promise.all(
      [
        {
          kind: "project" as const,
          id: project.id,
          title: project.name,
          repositoryName: project.repositoryName,
          baseCommit: null,
          forkHead: null,
          acceptedCommit: null,
        },
        ...workspaces.map((workspace) => ({
          kind: "workspace" as const,
          ...workspace,
        })),
      ].map(async (entry) => {
        const [repository, access, headCommit] = await Promise.all([
          Effect.runPromise(repositories.inspect(entry.repositoryName)),
          Effect.runPromise(
            repositories.access(entry.repositoryName, "read", 15 * 60)
          ),
          Effect.runPromise(repositories.head(entry.repositoryName)),
        ])
        return recoveryRepositoryEntry(entry, repository, access, headCommit)
      })
    )
    return {
      version: 1 as const,
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        defaultBranch: project.defaultBranch,
        upstream: project.importOriginUrl,
      },
      repositories: entries,
    }
  })

export const lookupGitHubRepository = createServerFn({ method: "POST" })
  .middleware([organizationMember])
  .validator((input) => decodeGitHubRepositoryLookupInputPromise(input))
  .handler(async ({ data, context }) => {
    const location = await Effect.runPromise(parseGitHubRepositoryUrl(data.url))
    const accessToken = await githubUserAccessToken(
      context.database,
      context.user.id
    )
    const repository = await Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* GitHubRepositoryService
        return yield* github.inspect({ ...location, accessToken })
      }).pipe(Effect.provide(GitHubRepositoryLive))
    )
    return encodeGitHubRepositoryInfo(repository)
  })

export const getProjectTemplates = createServerFn({ method: "GET" })
  .middleware([organizationMember])
  .validator((input) => decodeOrganizationRequestInputPromise(input))
  .handler(async () => encodeProjectTemplateCatalog(projectTemplateCatalog()))

interface ProjectRepositoryOrigin {
  readonly artifact: {
    readonly id: string
    readonly name: string
    readonly remote: string
    readonly defaultBranch: string
  }
  readonly head: string
  readonly importOriginUrl: string | undefined
  readonly importOriginBranch: string | undefined
  readonly template:
    | { readonly key: string; readonly repo: string; readonly commit: string }
    | undefined
}

const createProjectRepository = async (input: {
  database: Parameters<typeof ensureTemplateRepository>[0]
  repositories: RepositoryStore["Service"]
  organization: { id: string; slug: string }
  userId: string
  projectName: string
  repositoryName: string
  workspaceId: string
  source: ProjectSource
}): Promise<ProjectRepositoryOrigin> => {
  const { repositories, source } = input

  if (source.kind === "template") {
    const template = resolveProjectTemplate(source.template)
    if (!template) {
      throw new InvalidRequest({
        message: `Unknown Project template ${source.template}`,
      })
    }
    const templateRepository = await ensureTemplateRepository(
      input.database,
      repositories,
      input.organization,
      template
    )
    const forked = await Effect.runPromise(
      repositories.fork({
        sourceName: templateRepository.artifactRepo,
        name: input.repositoryName,
        description: `${input.projectName} forked from the ${template.name} template by Sylph`,
      })
    )
    const artifact = await Effect.runPromise(repositories.inspect(forked.name))
    return {
      artifact,
      head: templateRepository.headCommit,
      importOriginUrl: undefined,
      importOriginBranch: undefined,
      template: {
        key: template.key,
        repo: templateRepository.artifactRepo,
        commit: templateRepository.headCommit,
      },
    }
  }

  const sourceRepository =
    source.kind === "github"
      ? await Effect.runPromise(parseGitHubRepositoryUrl(source.url))
      : undefined
  const sourceRepositoryUrl = sourceRepository
    ? `https://github.com/${sourceRepository.owner}/${sourceRepository.name}`
    : undefined
  const sourceBranch = source.kind === "github" ? source.branch : undefined
  const sourceAccessToken = sourceRepository
    ? await githubUserAccessToken(input.database, input.userId)
    : undefined
  const created = await Effect.runPromise(
    repositories.create({
      name: input.repositoryName,
      description: sourceRepositoryUrl
        ? `${input.projectName} imported by Sylph`
        : `${input.projectName} created by Sylph`,
      defaultBranch: sourceBranch ?? "main",
    })
  )
  const artifact = await Effect.runPromise(repositories.inspect(created.name))
  const prepared = await prepareProjectRepository(
    input.workspaceId,
    new PrepareProjectRepositoryInput({
      repositoryName: artifact.name,
      repositoryRemote: artifact.remote,
      defaultRef: artifact.defaultBranch,
      projectName: input.projectName,
      source: sourceRepositoryUrl
        ? {
            remote: `${sourceRepositoryUrl}.git`,
            ref: sourceBranch ?? artifact.defaultBranch,
            accessToken: sourceAccessToken,
          }
        : undefined,
    })
  )
  const connected = source.kind === "github" && source.mode === "connected"
  return {
    artifact,
    head: prepared.head,
    importOriginUrl: connected ? sourceRepositoryUrl : undefined,
    importOriginBranch: connected ? sourceBranch : undefined,
    template: undefined,
  }
}

export const createProject = createServerFn({ method: "POST" })
  .middleware([organizationMember])
  .validator((input) => decodeCreateProjectInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, membership, user } = context

    const connection = requireProjectProviderConnection(
      await effectiveConnection(database, data.organizationId, user.id)
    )
    const credential = await connectionCredential(connection)

    const projectSlug = normalizeName(data.name)

    if (!projectSlug) {
      throw new InvalidRequest({
        message: "Project name needs a letter or number",
      })
    }

    const projectId = ProjectId.make(crypto.randomUUID())
    const workspaceId = WorkspaceId.make(crypto.randomUUID())
    const repositoryName = `${membership.organizationSlug}-${projectSlug.slice(0, 28)}-${projectId.replaceAll("-", "").slice(0, 12)}`
    const repositories = makeCloudflareArtifactsRepositoryStore(env.REPOS)
    const origin = await createProjectRepository({
      database,
      repositories,
      organization: {
        id: data.organizationId,
        slug: membership.organizationSlug,
      },
      userId: user.id,
      projectName: data.name,
      repositoryName,
      workspaceId,
      source: data.source,
    })
    const artifact = origin.artifact
    const workspaceRepositoryName = `${repositoryName.slice(0, 44)}-${workspaceId.replaceAll("-", "").slice(0, 12)}`
    const workspaceArtifact = await Effect.runPromise(
      repositories.fork({
        sourceName: artifact.name,
        name: workspaceRepositoryName,
        description: `Workspace for ${data.name}`,
      })
    )
    const now = new Date()

    await database.insert(schema.project).values({
      id: projectId,
      organizationId: data.organizationId,
      ownerUserId: user.id,
      name: data.name,
      slug: projectSlug,
      artifactRepoId: artifact.id,
      artifactRepo: artifact.name,
      artifactRemote: artifact.remote,
      defaultBranch: artifact.defaultBranch,
      importOriginUrl: origin.importOriginUrl,
      importOriginBranch: origin.importOriginBranch,
      templateKey: origin.template?.key,
      templateRepo: origin.template?.repo,
      templateCommit: origin.template?.commit,
      createdAt: now,
      updatedAt: now,
    })

    try {
      await database.insert(schema.workspace).values({
        id: workspaceId,
        projectId,
        organizationId: data.organizationId,
        ownerUserId: user.id,
        title: data.name,
        status: "provisioning",
        repositoryMode: "fork",
        baseArtifactRepo: artifact.name,
        workspaceArtifactRepo: workspaceArtifact.name,
        baseCommit: origin.head,
        forkHead: origin.head,
        syncStatus: "hydrating",
        mergeStatus: "unreviewed",
        errorSummary: null,
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
          projectRepositoryName: artifact.name,
          projectRepositoryRemote: artifact.remote,
          defaultRef: artifact.defaultBranch,
          baseCommit: origin.head,
          providerId: connection.providerId,
          modelId: connection.modelId,
          credential,
        })
      )
    } catch (cause) {
      console.error("Workspace runtime initialization failed", cause)
      const summary = failureMessage(cause, "Workspace runtime failed")
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
        projectSlug,
        organizationSlug: membership.organizationSlug,
        repositoryName: artifact.name,
        status: "error" as const,
        errorSummary: summary,
      }
    }

    await database
      .update(schema.workspace)
      .set({
        status: "ready",
        syncStatus: "ready",
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, workspaceId))

    return {
      id: workspaceId,
      projectId,
      projectSlug,
      organizationSlug: membership.organizationSlug,
      repositoryName: artifact.name,
      status: "ready" as const,
      errorSummary: null,
    }
  })
