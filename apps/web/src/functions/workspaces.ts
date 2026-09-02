import { createServerFn } from "@tanstack/react-start"
import { schema } from "@workspace/db"
import {
  decodeCreateWorkspaceInputPromise,
  decodeRestartWorkspaceInputPromise,
  decodeWorkspaceAcceptInputPromise,
  decodeWorkspaceCheckpointInputPromise,
  decodeWorkspaceCheckpointResult,
  decodeWorkspaceCheckRun,
  decodeWorkspaceCheckRunList,
  decodeWorkspacePromptInputPromise,
  decodeWorkspaceQuestionReplyInputPromise,
  decodeWorkspaceRebaseResultPromise,
  decodeWorkspaceRepairCheckInputPromise,
  decodeWorkspaceRepairResultPromise,
  decodeWorkspaceRequestInputPromise,
  decodeWorkspaceRetryCheckInputPromise,
  decodeWorkspaceRuntimeHealth,
  decodeWorkspaceSyncInputPromise,
  decodeWorkspaceSyncResultPromise,
  decodeWorkspaceTurnCancelResultPromise,
  decodeWorkspaceVersionControlSnapshot,
  encodeWorkspaceCheckpointInputSync,
  encodeWorkspaceCheckpointList,
  encodeWorkspaceCheckRunList,
  encodeWorkspaceQuestionReplyInputSync,
  encodeWorkspaceRepairCheckInputSync,
  encodeWorkspaceRetryCheckInputSync,
  encodeWorkspaceReview,
  encodeWorkspaceRuntimeHealth,
  encodeWorkspaceRuntimePromptInputSync,
  encodeWorkspaceTurnCancelInputSync,
  encodeWorkspaceVersionControl,
  failureMessage,
  InitializeWorkspaceRuntime,
  OrganizationId,
  PreconditionFailed,
  PrepareProjectRepositoryInput,
  ProjectId,
  ProviderConnectionRequired,
  WorkspaceId,
  WorkspaceReadOnly,
  WorkspaceRuntimeFailure,
  WorkspaceRuntimeHealth,
  WorkspaceRuntimePromptInput,
  WorkspaceTurnCancelInput,
} from "@workspace/domain"
import { env, waitUntil } from "cloudflare:workers"
import { and, count, eq } from "drizzle-orm"
import { Effect } from "effect"

import { deploymentWorkflowAlreadyStarted } from "@/server/deployment-records"
import {
  workspaceRetentionInstanceId,
  type WorkspaceRetentionInput,
} from "@/server/workspace-fork-retention"

import {
  projectMember,
  requestSession,
  workspaceMember,
  writableWorkspace,
} from "@/functions/middleware"
import {
  loadInstalledSkills,
  serializeInstalledSkill,
} from "@/server/installed-skills"
import { requireWorkspaceProject } from "@/server/organization-access"
import {
  prepareProjectRepository,
  synchronizeProjectRepository,
} from "@/server/project-repository-sync"
import {
  connectionCredential,
  effectiveConnection,
} from "@/server/provider-connections"
import { makeCloudflareArtifactsRepositoryStore } from "@/server/repository-store"
import { serializableWorkspaceCheckpointResult } from "@/server/workspace-checkpoint-result"
import {
  acceptanceCanStart,
  acceptanceWorkflowRevision,
} from "@/server/workspace-merge-heads"
import { serializableWorkspaceRebaseResult } from "@/server/workspace-rebase-result"
import {
  readWorkspaceVersionControlSnapshot,
  waitForWorkspaceVersionControl,
} from "@/server/workspace-repository-refresh"
import { reviewAllowsAcceptance } from "@/server/workspace-review"
import { loadWorkspaceReview } from "@/server/workspace-review-store"
import {
  completeWorkspaceInitialization,
  initializeWorkspaceRuntime,
  runtimeCall,
  workspaceRuntime,
} from "@/server/workspace-runtime"
import { restartDurableWorkspace } from "@/server/workspace-runtime-lifecycle"

const workspaceRepositoryNameFor = (
  projectRepositoryName: string,
  workspaceId: string
) =>
  `${projectRepositoryName.slice(0, 44)}-${workspaceId.replaceAll("-", "").slice(0, 12)}`

const requireVersionControlSnapshot = async (
  workspaceId: string,
  refreshProjectHead: boolean
) => {
  const snapshot = await runtimeCall(() =>
    workspaceRuntime(workspaceId).versionControl(refreshProjectHead)
  )
  if (!snapshot) {
    throw new WorkspaceRuntimeFailure({
      message: "Workspace version control is not initialized",
    })
  }
  return decodeWorkspaceVersionControlSnapshot(snapshot)
}

export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator((input) => decodeCreateWorkspaceInputPromise(input))
  .handler(async ({ context }) => {
    const { database, project, user } = context

    await synchronizeProjectRepository(database, user.id, {
      id: project.id,
      repositoryName: project.repositoryName,
      repositoryRemote: project.repositoryRemote,
      defaultRef: project.defaultBranch,
      sourceUrl: project.importOriginUrl,
      sourceRef: project.importOriginBranch,
    })

    const existingWorkspaceCount = await database
      .select({ value: count() })
      .from(schema.workspace)
      .where(eq(schema.workspace.projectId, project.id))
      .get()
    const workspaceNumber = (existingWorkspaceCount?.value ?? 0) + 1
    const title =
      workspaceNumber === 1 ? project.name : `Workspace ${workspaceNumber}`

    const connection = await effectiveConnection(
      database,
      project.organizationId,
      user.id
    )

    if (!connection) {
      throw new ProviderConnectionRequired({
        message:
          "Add a personal or Organization AI connection before creating a Workspace",
      })
    }

    const credential = await connectionCredential(connection)
    const workspaceId = WorkspaceId.make(crypto.randomUUID())
    const repositories = makeCloudflareArtifactsRepositoryStore(env.REPOS)
    const prepared = await prepareProjectRepository(
      workspaceId,
      new PrepareProjectRepositoryInput({
        repositoryName: project.repositoryName,
        repositoryRemote: project.repositoryRemote,
        defaultRef: project.defaultBranch,
        projectName: project.name,
      })
    )
    const workspaceRepository = await Effect.runPromise(
      repositories.fork({
        sourceName: project.repositoryName,
        name: workspaceRepositoryNameFor(project.repositoryName, workspaceId),
        description: `Workspace for ${project.name}: ${title}`,
      })
    )
    const now = new Date()

    await database.insert(schema.workspace).values({
      id: workspaceId,
      projectId: ProjectId.make(project.id),
      organizationId: OrganizationId.make(project.organizationId),
      ownerUserId: user.id,
      title,
      status: "provisioning",
      repositoryMode: "fork",
      baseArtifactRepo: project.repositoryName,
      workspaceArtifactRepo: workspaceRepository.name,
      baseCommit: prepared.head,
      forkHead: prepared.head,
      syncStatus: "hydrating",
      mergeStatus: "unreviewed",
      createdAt: now,
      updatedAt: now,
    })

    waitUntil(
      completeWorkspaceInitialization(
        database,
        workspaceId,
        new InitializeWorkspaceRuntime({
          organizationId: OrganizationId.make(project.organizationId),
          projectId: ProjectId.make(project.id),
          workspaceId,
          projectName: project.name,
          repositoryName: workspaceRepository.name,
          repositoryRemote: workspaceRepository.remote,
          projectRepositoryName: project.repositoryName,
          projectRepositoryRemote: project.repositoryRemote,
          defaultRef: project.defaultBranch,
          baseCommit: prepared.head,
          providerId: connection.providerId,
          modelId: connection.modelId,
          credential,
        })
      )
    )

    return {
      id: workspaceId,
      status: "provisioning" as const,
      errorSummary: null,
    }
  })

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requestSession])
  .validator((input) => decodeWorkspaceRequestInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, session } = context

    if (!session) return null

    const workspace = await database
      .select({
        id: schema.workspace.id,
        projectId: schema.workspace.projectId,
        projectName: schema.project.name,
        projectSlug: schema.project.slug,
        organizationId: schema.workspace.organizationId,
        organizationName: schema.organization.name,
        organizationSlug: schema.organization.slug,
        title: schema.workspace.title,
        status: schema.workspace.status,
        repositoryName: schema.project.artifactRepo,
        workspaceRepositoryName: schema.workspace.workspaceArtifactRepo,
        defaultBranch: schema.project.defaultBranch,
        importOriginUrl: schema.project.importOriginUrl,
        importOriginBranch: schema.project.importOriginBranch,
        upstreamHead: schema.project.upstreamHead,
        upstreamStatus: schema.project.upstreamStatus,
        upstreamSyncedAt: schema.project.upstreamSyncedAt,
        deliveryMode: schema.project.deliveryMode,
        deliveredCommit: schema.project.deliveredCommit,
        deliveryUrl: schema.project.deliveryUrl,
        baseCommit: schema.workspace.baseCommit,
        forkHead: schema.workspace.forkHead,
        syncStatus: schema.workspace.syncStatus,
        mergeStatus: schema.workspace.mergeStatus,
        errorSummary: schema.workspace.errorSummary,
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

    if (!workspace) return null

    const shouldSynchronize =
      workspace.importOriginUrl &&
      (!workspace.upstreamSyncedAt ||
        Date.now() - workspace.upstreamSyncedAt.getTime() > 5 * 60 * 1000)
    if (shouldSynchronize) {
      await synchronizeProjectRepository(database, session.user.id, {
        id: workspace.projectId,
        repositoryName: workspace.repositoryName,
        repositoryRemote: (
          await Effect.runPromise(
            makeCloudflareArtifactsRepositoryStore(env.REPOS).inspect(
              workspace.repositoryName
            )
          )
        ).remote,
        defaultRef: workspace.defaultBranch,
        sourceUrl: workspace.importOriginUrl,
        sourceRef: workspace.importOriginBranch,
      })
    }

    const runtime = workspaceRuntime(data.workspaceId)
    const readVersionControl = () =>
      runtimeCall(() => runtime.versionControl(true))
    const [runtimeSnapshot, versionControlSnapshot, checks, skills] =
      await Promise.all([
        runtimeCall(() => runtime.snapshot()).then(
          decodeWorkspaceRuntimeHealth
        ),
        workspace.status === "error" || workspace.errorSummary
          ? readVersionControl()
          : waitForWorkspaceVersionControl(readVersionControl),
        runtimeCall(() => runtime.listChecks()).then(
          decodeWorkspaceCheckRunList
        ),
        loadInstalledSkills(
          env.DB,
          workspace.organizationId,
          workspace.projectId
        ),
      ])

    const separator = runtimeSnapshot.model?.indexOf("/") ?? -1
    const conversationModel =
      runtimeSnapshot.model && separator > 0
        ? {
            providerId: runtimeSnapshot.model.slice(0, separator),
            modelId: runtimeSnapshot.model.slice(separator + 1),
          }
        : null
    const connection = await effectiveConnection(
      database,
      workspace.organizationId,
      session.user.id,
      conversationModel
    )
    const { versionControl, checkpoints } =
      await readWorkspaceVersionControlSnapshot(versionControlSnapshot, {
        defaultRef: workspace.defaultBranch,
        baseCommit: workspace.baseCommit,
        forkHead: workspace.forkHead,
        syncStatus: workspace.syncStatus,
        mergeStatus: workspace.mergeStatus,
      })
    const review = await loadWorkspaceReview(
      database,
      data.workspaceId,
      versionControl.forkHead
    )
    const [
      encodedVersionControl,
      encodedCheckpoints,
      encodedChecks,
      encodedReview,
    ] = await Promise.all([
      encodeWorkspaceVersionControl(versionControl),
      encodeWorkspaceCheckpointList(checkpoints),
      encodeWorkspaceCheckRunList(checks),
      encodeWorkspaceReview(review),
    ])

    const runtimeStatus =
      (workspace.status === "error" || workspace.errorSummary) &&
      runtimeSnapshot.status === "provisioning"
        ? "error"
        : runtimeSnapshot.status
    const status =
      workspace.status === "merging" || workspace.status === "archived"
        ? workspace.status
        : runtimeStatus

    if (
      workspace.status !== status &&
      workspace.status !== "merging" &&
      workspace.status !== "archived"
    ) {
      await database
        .update(schema.workspace)
        .set({ status, updatedAt: new Date() })
        .where(eq(schema.workspace.id, data.workspaceId))
    }

    return {
      workspace: { ...workspace, status },
      runtime: await encodeWorkspaceRuntimeHealth(
        new WorkspaceRuntimeHealth({
          ...runtimeSnapshot,
          status: runtimeStatus,
        })
      ),
      versionControl: encodedVersionControl,
      checkpoints: encodedCheckpoints,
      checks: encodedChecks,
      review: encodedReview,
      currentReviewer: {
        id: session.user.id,
        name: session.user.name,
        image: session.user.image ?? null,
      },
      models: connection?.models ?? [],
      selectedModel: connection
        ? { providerId: connection.providerId, modelId: connection.modelId }
        : null,
      modelNotice: connection?.notice ?? null,
      skills: skills.map(serializeInstalledSkill),
    }
  })

export const restartWorkspace = createServerFn({ method: "POST" })
  .middleware([workspaceMember])
  .validator((input) => decodeRestartWorkspaceInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, workspace } = context
    const project = await requireWorkspaceProject(database, workspace.projectId)

    const connection = await effectiveConnection(
      database,
      workspace.organizationId,
      workspace.ownerUserId,
      data.model
    )

    if (!connection) {
      throw new ProviderConnectionRequired({
        message:
          "The Workspace owner needs a personal or Organization AI connection before this Workspace can restart",
      })
    }

    const credential = await connectionCredential(connection)
    const repository = await Effect.runPromise(
      makeCloudflareArtifactsRepositoryStore(env.REPOS).inspect(
        workspace.repositoryName
      )
    )

    if (!workspace.baseCommit) {
      throw new PreconditionFailed({
        message: "This Workspace predates Artifact-backed version control",
      })
    }

    const runtimeInput = new InitializeWorkspaceRuntime({
      organizationId: OrganizationId.make(workspace.organizationId),
      projectId: ProjectId.make(workspace.projectId),
      workspaceId: WorkspaceId.make(workspace.id),
      projectName: project.name,
      repositoryName: workspace.repositoryName,
      repositoryRemote: repository.remote,
      projectRepositoryName: project.repositoryName,
      projectRepositoryRemote: project.repositoryRemote,
      defaultRef: project.defaultBranch,
      baseCommit: workspace.baseCommit,
      providerId: connection.providerId,
      modelId: connection.modelId,
      credential,
      archivedAt:
        workspace.status === "archived"
          ? (workspace.archivedAt?.getTime() ?? Date.now())
          : null,
    })

    await database
      .update(schema.workspace)
      .set({
        status: "provisioning",
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, workspace.id))

    try {
      await restartDurableWorkspace({
        evict: () => workspaceRuntime(workspace.id).evict(),
        initialize: () =>
          initializeWorkspaceRuntime(workspace.id, runtimeInput).then(
            () => undefined
          ),
      })
    } catch (cause) {
      const summary = failureMessage(cause, "Workspace runtime failed")
      await database
        .update(schema.workspace)
        .set({ status: "error", errorSummary: summary, updatedAt: new Date() })
        .where(eq(schema.workspace.id, workspace.id))
      throw new WorkspaceRuntimeFailure({ message: summary })
    }

    const status = workspace.status === "archived" ? "archived" : "ready"
    await database
      .update(schema.workspace)
      .set({ status, errorSummary: null, updatedAt: new Date() })
      .where(eq(schema.workspace.id, workspace.id))

    return { id: workspace.id, status } as const
  })

export const promptWorkspace = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspacePromptInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, user, workspace } = context

    const connection = await effectiveConnection(
      database,
      workspace.organizationId,
      user.id,
      data.model
    )

    if (!connection) {
      throw new ProviderConnectionRequired({
        message: "Connect an AI provider before sending a message",
      })
    }

    const credential = await connectionCredential(connection)
    const health = await runtimeCall(() =>
      workspaceRuntime(data.workspaceId).prompt(
        encodeWorkspaceRuntimePromptInputSync(
          new WorkspaceRuntimePromptInput({
            workspaceId: data.workspaceId,
            text: data.text,
            model: {
              providerId: connection.providerId,
              modelId: connection.modelId,
            },
            credential,
            delivery: data.delivery,
          })
        )
      )
    ).then(decodeWorkspaceRuntimeHealth)

    await database
      .update(schema.workspace)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(schema.workspace.id, data.workspaceId))

    return {
      health: await encodeWorkspaceRuntimeHealth(health),
      models: connection.models,
      selectedModel: {
        providerId: connection.providerId,
        modelId: connection.modelId,
      },
      modelNotice: connection.notice,
    }
  })

export const cancelWorkspaceTurn = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceRequestInputPromise(input))
  .handler(async ({ data }) => {
    const result = await runtimeCall(() =>
      workspaceRuntime(data.workspaceId).cancelTurn(
        encodeWorkspaceTurnCancelInputSync(
          new WorkspaceTurnCancelInput({
            workspaceId: data.workspaceId,
            continueQueued: true,
          })
        )
      )
    ).then(decodeWorkspaceTurnCancelResultPromise)
    return { interrupted: result.interrupted }
  })

export const answerWorkspaceQuestion = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceQuestionReplyInputPromise(input))
  .handler(async ({ data }) => {
    await runtimeCall(() =>
      workspaceRuntime(data.workspaceId).answerQuestion(
        encodeWorkspaceQuestionReplyInputSync(data)
      )
    )
  })

export const archiveWorkspace = createServerFn({ method: "POST" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspaceRequestInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, workspace } = context
    if (workspace.status === "merging") {
      throw new WorkspaceReadOnly({
        message: "Wait for Workspace acceptance to finish before archiving",
        status: "merging",
      })
    }
    if (workspace.status === "archived") return { status: "archived" as const }

    await runtimeCall(() =>
      workspaceRuntime(data.workspaceId).archive({
        workspaceId: data.workspaceId,
      })
    )

    const archivedAt = new Date()
    await database
      .update(schema.workspace)
      .set({
        status: "archived",
        archivedAt,
        updatedAt: archivedAt,
      })
      .where(eq(schema.workspace.id, data.workspaceId))
    const retention: WorkspaceRetentionInput = {
      workspaceId: data.workspaceId,
      workspaceRepositoryName: workspace.repositoryName,
      archivedAt: Math.floor(archivedAt.getTime() / 1000),
    }
    try {
      await env.RETENTION.create({
        id: workspaceRetentionInstanceId(retention),
        params: retention,
      })
    } catch (cause) {
      if (!deploymentWorkflowAlreadyStarted(cause)) throw cause
    }
    return { status: "archived" as const }
  })

export const discardWorkspace = createServerFn({ method: "POST" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspaceRequestInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, workspace } = context
    if (workspace.status === "merging") {
      throw new WorkspaceReadOnly({
        message: "Wait for Workspace acceptance to finish before discarding",
        status: "merging",
      })
    }

    await database
      .update(schema.workspace)
      .set({
        status: "archived",
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, data.workspaceId))
    await Effect.runPromise(
      makeCloudflareArtifactsRepositoryStore(env.REPOS).remove(
        workspace.repositoryName
      )
    )
    await runtimeCall(() => workspaceRuntime(data.workspaceId).discard())
    await database
      .delete(schema.workspace)
      .where(eq(schema.workspace.id, data.workspaceId))
    return { discarded: true as const }
  })

export const checkpointWorkspace = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceCheckpointInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database } = context
    const runtime = workspaceRuntime(data.workspaceId)
    const snapshot = await runtimeCall(() => runtime.snapshot()).then(
      decodeWorkspaceRuntimeHealth
    )
    if (!snapshot.opencode.healthy || snapshot.status === "running") {
      throw new PreconditionFailed({
        message: "Wait for the Workspace checks to pass before checkpointing",
      })
    }
    const result = await runtimeCall(() =>
      runtime.checkpoint(encodeWorkspaceCheckpointInputSync(data))
    ).then(decodeWorkspaceCheckpointResult)
    try {
      const { versionControl } = await requireVersionControlSnapshot(
        data.workspaceId,
        false
      ).then((snapshot) => ({ versionControl: snapshot.vcs }))
      await database
        .update(schema.workspace)
        .set({
          forkHead: result.checkpoint.commit,
          baseCommit: versionControl.baseCommit,
          syncStatus: "ready",
          mergeStatus: "ready",
          latestCheckpointAt: new Date(result.checkpoint.createdAt),
          errorSummary: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.workspace.id, data.workspaceId))
      return serializableWorkspaceCheckpointResult(result)
    } catch (error) {
      console.error(
        "Workspace checkpoint persistence failed",
        error instanceof Error ? error.stack : error
      )
      throw error
    }
  })

export const rebaseWorkspace = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceRequestInputPromise(input))
  .handler(async ({ data, context }) => {
    const result = await runtimeCall(() =>
      workspaceRuntime(data.workspaceId).rebase()
    ).then(decodeWorkspaceRebaseResultPromise)
    await context.database
      .update(schema.workspace)
      .set({
        baseCommit: result.baseCommit,
        forkHead: result.forkHead,
        syncStatus: "ready",
        mergeStatus: "ready",
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, data.workspaceId))
    return serializableWorkspaceRebaseResult(result)
  })

export const retryWorkspaceCheck = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceRetryCheckInputPromise(input))
  .handler(async ({ data }) => {
    const run = decodeWorkspaceCheckRun(
      await runtimeCall(() =>
        workspaceRuntime(data.workspaceId).retryCheck(
          encodeWorkspaceRetryCheckInputSync(data)
        )
      )
    )
    return { id: run.id, status: run.status, attempt: run.attempt }
  })

export const repairWorkspaceCheck = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceRepairCheckInputPromise(input))
  .handler(async ({ data }) => {
    const result = await runtimeCall(() =>
      workspaceRuntime(data.workspaceId).repairCheck(
        encodeWorkspaceRepairCheckInputSync(data)
      )
    ).then(decodeWorkspaceRepairResultPromise)
    return { started: result.started }
  })

export const syncWorkspaceProject = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceSyncInputPromise(input))
  .handler(async ({ data, context }) => {
    const result = await runtimeCall(() =>
      workspaceRuntime(data.workspaceId).updateProject()
    ).then(decodeWorkspaceSyncResultPromise)
    const { vcs } = await requireVersionControlSnapshot(data.workspaceId, false)
    await context.database
      .update(schema.workspace)
      .set({
        baseCommit: vcs.baseCommit,
        forkHead: vcs.forkHead,
        syncStatus: vcs.syncStatus,
        mergeStatus: vcs.mergeStatus,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, data.workspaceId))
    return {
      status: result.status,
      projectCommit: result.projectCommit,
      conflictedFiles: [...result.conflictedFiles],
    }
  })

export const acceptWorkspace = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceAcceptInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, user, workspace } = context
    const project = await requireWorkspaceProject(database, workspace.projectId)
    if (!workspace.baseCommit || !workspace.forkHead) {
      throw new PreconditionFailed({
        message: "Create a Checkpoint before accepting this Workspace",
      })
    }
    if (!acceptanceCanStart(workspace.mergeStatus)) {
      throw new PreconditionFailed({
        message: "This Workspace is not ready to merge",
      })
    }

    await synchronizeProjectRepository(database, user.id, {
      id: project.id,
      repositoryName: project.repositoryName,
      repositoryRemote: project.repositoryRemote,
      defaultRef: project.defaultBranch,
      sourceUrl: project.importOriginUrl,
      sourceRef: project.importOriginBranch,
    })

    const runtime = workspaceRuntime(data.workspaceId)
    const [snapshot, { vcs: versionControl }, checks] = await Promise.all([
      runtimeCall(() => runtime.snapshot()).then(decodeWorkspaceRuntimeHealth),
      requireVersionControlSnapshot(data.workspaceId, true),
      runtimeCall(() => runtime.listChecks()).then(decodeWorkspaceCheckRunList),
    ])
    if (
      !snapshot.opencode.healthy ||
      snapshot.status === "running" ||
      versionControl.working.length
    ) {
      throw new PreconditionFailed({
        message: "Checkpoint all changes and pass checks before accepting",
      })
    }
    const passingCheck = checks.find(
      (run) =>
        run.kind === "checkpoint" &&
        run.commit === versionControl.forkHead &&
        run.status === "passed"
    )
    if (!passingCheck) {
      throw new PreconditionFailed({
        message:
          "The latest Checkpoint must pass its Check, Preview, and browser verification before acceptance",
      })
    }
    if (versionControl.projectChanged) {
      throw new PreconditionFailed({
        message:
          "Update this Workspace from the Project Repository, resolve any conflicts, and run a new Check before acceptance",
      })
    }
    const revision = acceptanceWorkflowRevision({
      persisted: {
        baseCommit: workspace.baseCommit,
        forkHead: workspace.forkHead,
      },
      reviewed: {
        baseCommit: versionControl.baseCommit,
        forkHead: versionControl.forkHead,
      },
    })
    const review = await loadWorkspaceReview(
      database,
      data.workspaceId,
      versionControl.forkHead
    )
    if (
      !reviewAllowsAcceptance({
        decision: review.decision,
        reviewCommit: review.commit,
        forkHead: versionControl.forkHead,
        unresolvedComments: review.comments.filter(
          (comment) => comment.resolvedAt === null
        ).length,
      })
    ) {
      throw new PreconditionFailed({
        message: "Approve the current Workspace review before accepting",
      })
    }

    const operationId = `${data.workspaceId}-${data.idempotencyKey}`
    const existing = await database
      .select({ status: schema.repositoryOperation.status })
      .from(schema.repositoryOperation)
      .where(eq(schema.repositoryOperation.id, operationId))
      .get()
    if (!existing) {
      await database.insert(schema.repositoryOperation).values({
        id: operationId,
        workspaceId: data.workspaceId,
        kind: "merge",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }
    const params = {
      operationId,
      workspaceId: data.workspaceId,
      projectRepositoryName: project.repositoryName,
      projectRepositoryRemote: project.repositoryRemote,
      workspaceRepositoryName: workspace.repositoryName,
      workspaceRepositoryRemote: (
        await Effect.runPromise(
          makeCloudflareArtifactsRepositoryStore(env.REPOS).inspect(
            workspace.repositoryName
          )
        )
      ).remote,
      defaultRef: project.defaultBranch,
      baseCommit: revision.baseCommit,
      forkHead: revision.forkHead,
      projectId: workspace.projectId,
      actorUserId: user.id,
    }
    const instance = existing
      ? await env.MERGES.get(operationId)
      : await env.MERGES.create({ id: operationId, params })
    await database
      .update(schema.workspace)
      .set({
        status: "merging",
        mergeStatus: "merging",
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, data.workspaceId))
    return { operationId: instance.id, status: "merging" as const }
  })
