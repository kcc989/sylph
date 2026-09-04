import { provisioningRuntimeHealth } from "@/server/workspace-provisioning-state"
import { createServerFn } from "@tanstack/react-start"
import { schema } from "@workspace/db"
import {
  AccessDenied,
  workspaceAcceptance,
  failureMessage,
  InitializeWorkspaceRuntime,
  OrganizationId,
  PreconditionFailed,
  ProjectId,
  ProviderConnectionRequired,
  WorkspaceReadInput,
  WorkspacePatchReadInput,
  WorkspaceArchiveInput,
  WorkspaceId,
  WorkspaceRuntimeFailure,
  WorkspaceRuntimeHealth,
  WorkspaceRuntimePromptInput,
  WorkspaceTurnCancelInput,
  CreateWorkspaceInput,
  RestartWorkspaceInput,
  WorkspaceAcceptInput,
  WorkspaceCheckRunList,
  WorkspaceCheckpointInput,
  WorkspaceCheckpointList,
  WorkspaceCheckpointResult,
  WorkspacePromptInput,
  WorkspaceQuestionReplyInput,
  WorkspaceRebaseResult,
  randomWorkspaceName,
  WorkspaceRepairCheckInput,
  WorkspaceRequestInput,
  WorkspaceRetryCheckInput,
  WorkspaceReview,
  WorkspaceSyncInput,
  WorkspaceVersionControl,
  WorkspaceReadFileInput,
} from "@workspace/domain"
import { env, waitUntil } from "cloudflare:workers"
import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"

import { deploymentWorkflowAlreadyStarted } from "@/server/deployment-records"
import {
  workspaceRetentionInstanceId,
  type WorkspaceRetentionInput,
} from "@/server/workspace-fork-retention"

import {
  projectMember,
  workspaceMember,
  writableWorkspace,
} from "@/functions/middleware"
import {
  loadInstalledSkills,
  serializeInstalledSkill,
} from "@/server/installed-skills"
import {
  requireWorkspaceNotMerging,
  requireWorkspaceProject,
} from "@/server/organization-access"
import { synchronizeProjectRepository } from "@/server/project-repository-sync"
import {
  connectionCredential,
  effectiveConnection,
} from "@/server/provider-connections"
import { repositoryStore } from "@/server/repositories"
import { acceptanceCanStart } from "@/server/workspace-merge-heads"
import { readWorkspaceVersionControlSnapshot } from "@/server/workspace-repository-refresh"
import { loadWorkspaceReview } from "@/server/workspace-review-store"
import {
  scheduleWorkspaceProvisioning,
  workspaceRuntime,
} from "@/server/workspace-runtime"
import { restartDurableWorkspace } from "@/server/workspace-runtime-lifecycle"

const decodeWorkspacePatchReadInput = Schema.decodeUnknownPromise(
  WorkspacePatchReadInput
)

const decodeWorkspaceReadInput = Schema.decodeUnknownPromise(WorkspaceReadInput)

const decodeCreateWorkspaceInputPromise =
  Schema.decodeUnknownPromise(CreateWorkspaceInput)
const decodeRestartWorkspaceInputPromise = Schema.decodeUnknownPromise(
  RestartWorkspaceInput
)
const decodeWorkspaceAcceptInputPromise =
  Schema.decodeUnknownPromise(WorkspaceAcceptInput)
const decodeWorkspaceCheckpointInputPromise = Schema.decodeUnknownPromise(
  WorkspaceCheckpointInput
)
const decodeWorkspacePromptInputPromise =
  Schema.decodeUnknownPromise(WorkspacePromptInput)
const decodeWorkspaceQuestionReplyInputPromise = Schema.decodeUnknownPromise(
  WorkspaceQuestionReplyInput
)
const decodeWorkspaceRepairCheckInputPromise = Schema.decodeUnknownPromise(
  WorkspaceRepairCheckInput
)
const decodeWorkspaceRequestInputPromise = Schema.decodeUnknownPromise(
  WorkspaceRequestInput
)
const decodeWorkspaceRetryCheckInputPromise = Schema.decodeUnknownPromise(
  WorkspaceRetryCheckInput
)
const decodeWorkspaceReadFileInputPromise = Schema.decodeUnknownPromise(
  WorkspaceReadFileInput
)
const decodeWorkspaceSyncInputPromise =
  Schema.decodeUnknownPromise(WorkspaceSyncInput)
const encodeWorkspaceCheckRunList = Schema.encodePromise(WorkspaceCheckRunList)
const encodeWorkspaceCheckpointList = Schema.encodePromise(
  WorkspaceCheckpointList
)
const encodeWorkspaceCheckpointResultSync = Schema.encodeSync(
  WorkspaceCheckpointResult
)
const encodeWorkspaceRebaseResultSync = Schema.encodeSync(WorkspaceRebaseResult)
const encodeWorkspaceReview = Schema.encodePromise(WorkspaceReview)
const encodeWorkspaceRuntimeHealth = Schema.encodePromise(
  WorkspaceRuntimeHealth
)
const encodeWorkspaceVersionControl = Schema.encodePromise(
  WorkspaceVersionControl
)

const workspaceRepositoryNameFor = (
  projectRepositoryName: string,
  workspaceId: string
) =>
  `${projectRepositoryName.slice(0, 44)}-${workspaceId.replaceAll("-", "").slice(0, 12)}`

const requireVersionControlSnapshot = async (
  workspaceId: string,
  refreshProjectHead: boolean
) => {
  const snapshot =
    await workspaceRuntime(workspaceId).versionControl(refreshProjectHead)
  if (!snapshot) {
    throw new WorkspaceRuntimeFailure({
      message: "Workspace version control is not initialized",
      reason: "not_initialized",
    })
  }
  return snapshot
}

export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator((input) => decodeCreateWorkspaceInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, project, user } = context

    const existingWorkspace = await database
      .select({
        errorSummary: schema.workspace.errorSummary,
        id: schema.workspace.id,
        status: schema.workspace.status,
      })
      .from(schema.workspace)
      .where(
        and(
          eq(schema.workspace.projectId, project.id),
          eq(schema.workspace.creationKey, data.idempotencyKey)
        )
      )
      .get()

    if (existingWorkspace) {
      if (existingWorkspace.status === "provisioning")
        await scheduleWorkspaceProvisioning(existingWorkspace.id)
      return existingWorkspace
    }

    const synchronized = await synchronizeProjectRepository(database, user.id, {
      id: project.id,
      repositoryName: project.repositoryName,
      repositoryRemote: project.repositoryRemote,
      defaultRef: project.defaultBranch,
      sourceUrl: project.importOriginUrl,
      sourceRef: project.importOriginBranch,
    })

    let title = randomWorkspaceName()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const collision = await database
        .select({ id: schema.workspace.id })
        .from(schema.workspace)
        .where(
          and(
            eq(schema.workspace.projectId, project.id),
            eq(schema.workspace.title, title)
          )
        )
        .get()
      if (!collision) break
      title = randomWorkspaceName()
    }

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

    const workspaceId = WorkspaceId.make(crypto.randomUUID())
    const repositories = repositoryStore()
    const head =
      synchronized?.projectHead ??
      (await Effect.runPromise(repositories.head(project.repositoryName)))
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
      creationKey: data.idempotencyKey,
      branchName: title,
      title,
      status: "provisioning",
      repositoryMode: "fork",
      baseArtifactRepo: project.repositoryName,
      workspaceArtifactRepo: workspaceRepository.name,
      baseCommit: head,
      forkHead: head,
      syncStatus: "hydrating",
      mergeStatus: "unreviewed",
      createdAt: now,
      updatedAt: now,
    })

    await scheduleWorkspaceProvisioning(workspaceId)

    return {
      id: workspaceId,
      status: "provisioning" as const,
      errorSummary: null,
    }
  })

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspaceReadInput(input))
  .handler(async ({ data, context }) => {
    const { database, user } = context

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
        repositoryRemote: schema.project.artifactRemote,
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
        acceptedCommit: schema.workspace.acceptedCommit,
      })
      .from(schema.workspace)
      .innerJoin(
        schema.project,
        eq(schema.workspace.projectId, schema.project.id)
      )
      .innerJoin(
        schema.organization,
        eq(schema.organization.id, schema.workspace.organizationId)
      )
      .where(eq(schema.workspace.id, data.workspaceId))
      .get()

    if (!workspace) {
      throw new AccessDenied({
        message: "This Workspace does not exist or you cannot access it",
        resource: "workspace",
      })
    }

    const shouldSynchronize =
      workspace.importOriginUrl &&
      (!workspace.upstreamSyncedAt ||
        Date.now() - workspace.upstreamSyncedAt.getTime() > 5 * 60 * 1000)
    if (shouldSynchronize && data.includeOptions !== false) {
      waitUntil(
        synchronizeProjectRepository(database, user.id, {
          id: workspace.projectId,
          repositoryName: workspace.repositoryName,
          repositoryRemote: workspace.repositoryRemote,
          defaultRef: workspace.defaultBranch,
          sourceUrl: workspace.importOriginUrl,
          sourceRef: workspace.importOriginBranch,
        })
      )
    }

    const runtime = workspaceRuntime(data.workspaceId)
    const readVersionControl = () => runtime.versionControl(false, false)
    const [runtimeSnapshot, versionControlSnapshot, checks, skills] =
      await Promise.all([
        workspace.status === "provisioning"
          ? provisioningRuntimeHealth(workspace.id)
          : runtime.snapshot(),
        workspace.status === "provisioning" ? null : readVersionControl(),
        workspace.status === "provisioning" ? [] : runtime.listChecks(),
        data.includeOptions === false
          ? []
          : loadInstalledSkills(
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
    const connection =
      data.includeOptions === false
        ? null
        : await effectiveConnection(
            database,
            workspace.organizationId,
            user.id,
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
      workspace.status === "error" || workspace.errorSummary
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
      workingRevision: versionControlSnapshot?.workingRevision ?? 0,
      checkpoints: encodedCheckpoints,
      checks: encodedChecks,
      review: encodedReview,
      currentReviewer: {
        id: user.id,
        name: user.name,
        image: user.image ?? null,
      },
      models: connection?.models ?? [],
      selectedModel: connection
        ? { providerId: connection.providerId, modelId: connection.modelId }
        : null,
      modelNotice: connection?.notice ?? null,
      skills: skills.map(serializeInstalledSkill),
    }
  })

export const readWorkspaceFile = createServerFn({ method: "GET" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspaceReadFileInputPromise(input))
  .handler(async ({ data }) => {
    const file = await workspaceRuntime(data.workspaceId).readFile(data)
    return {
      path: file.path,
      size: file.size,
      updatedAt: file.updatedAt,
      encoding: file.encoding,
      content: file.content,
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
      repositoryStore().inspect(workspace.repositoryName)
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
      defaultRef: workspace.branchName ?? project.defaultBranch,
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
      await restartDurableWorkspace(() => {
        const runtime = workspaceRuntime(workspace.id)
        return {
          evict: () => runtime.evict(),
          initialize: () =>
            runtime.initialize(runtimeInput).then(() => undefined),
        }
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
    const health = await workspaceRuntime(data.workspaceId).prompt(
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
    const result = await workspaceRuntime(data.workspaceId).cancelTurn(
      new WorkspaceTurnCancelInput({
        workspaceId: data.workspaceId,
        continueQueued: true,
      })
    )
    return { interrupted: result.interrupted }
  })

export const answerWorkspaceQuestion = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceQuestionReplyInputPromise(input))
  .handler(async ({ data }) => {
    await workspaceRuntime(data.workspaceId).answerQuestion(data)
  })

export const archiveWorkspace = createServerFn({ method: "POST" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspaceRequestInputPromise(input))
  .handler(async ({ data, context }) => {
    const { database, workspace } = context
    if (workspace.status === "archived") return { status: "archived" as const }
    requireWorkspaceNotMerging(workspace)

    await workspaceRuntime(data.workspaceId).archive(
      new WorkspaceArchiveInput({ workspaceId: data.workspaceId })
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
    requireWorkspaceNotMerging(workspace)

    await database
      .update(schema.workspace)
      .set({
        status: "archived",
        archivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, data.workspaceId))
    await Effect.runPromise(repositoryStore().remove(workspace.repositoryName))
    await workspaceRuntime(data.workspaceId).discard()
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
    const snapshot = await runtime.snapshot()
    if (!snapshot.opencode.healthy || snapshot.status === "running") {
      throw new PreconditionFailed({
        message: "Wait for the Workspace checks to pass before checkpointing",
      })
    }
    const result = await runtime.checkpoint(data)
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
      return encodeWorkspaceCheckpointResultSync(result)
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
    const result = await workspaceRuntime(data.workspaceId).rebase()
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
    return encodeWorkspaceRebaseResultSync(result)
  })

export const retryWorkspaceCheck = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceRetryCheckInputPromise(input))
  .handler(async ({ data }) => {
    const run = await workspaceRuntime(data.workspaceId).retryCheck(data)
    return { id: run.id, status: run.status, attempt: run.attempt }
  })

export const repairWorkspaceCheck = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceRepairCheckInputPromise(input))
  .handler(async ({ data }) => {
    const result = await workspaceRuntime(data.workspaceId).repairCheck(data)
    return { started: result.started }
  })

export const syncWorkspaceProject = createServerFn({ method: "POST" })
  .middleware([writableWorkspace])
  .validator((input) => decodeWorkspaceSyncInputPromise(input))
  .handler(async ({ data, context }) => {
    const result = await workspaceRuntime(data.workspaceId).updateProject()
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
      runtime.snapshot(),
      requireVersionControlSnapshot(data.workspaceId, true),
      runtime.listChecks(),
    ])
    const review = await loadWorkspaceReview(
      database,
      data.workspaceId,
      versionControl.forkHead
    )
    const acceptance = workspaceAcceptance({
      versionControl,
      checks,
      workspaceStatus: workspace.status,
      reviewDecision: review.decision,
      reviewCommit: review.commit,
      unresolvedComments: review.comments.filter(
        (comment) => comment.resolvedAt === null
      ).length,
      turnActive: snapshot.status === "running",
      runtimeHealthy: snapshot.opencode.healthy,
    })
    if (!acceptance.ready) {
      throw new PreconditionFailed({ message: acceptance.blockers.join(" ") })
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
          repositoryStore().inspect(workspace.repositoryName)
        )
      ).remote,
      defaultRef: project.defaultBranch,
      baseCommit: versionControl.baseCommit,
      forkHead: versionControl.forkHead,
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

export const getWorkspaceActivity = createServerFn({ method: "GET" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspaceRequestInputPromise(input))
  .handler(async ({ data }) =>
    encodeWorkspaceRuntimeHealth(
      await workspaceRuntime(data.workspaceId).snapshot()
    )
  )

export const getWorkspaceChecks = createServerFn({ method: "GET" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspaceRequestInputPromise(input))
  .handler(async ({ data }) =>
    encodeWorkspaceCheckRunList(
      await workspaceRuntime(data.workspaceId).listChecks()
    )
  )

export const readWorkspacePatch = createServerFn({ method: "GET" })
  .middleware([workspaceMember])
  .validator((input) => decodeWorkspacePatchReadInput(input))
  .handler(async ({ data }) => {
    const snapshot = await requireVersionControlSnapshot(
      data.workspaceId,
      false
    )
    if (snapshot.vcs.forkHead !== data.expectedCommit)
      throw new PreconditionFailed({
        message:
          "The Workspace Checkpoint changed. Refresh the Workspace before reviewing.",
      })
    return snapshot.vcs[data.scope].map((change) => change.patch).join("\n")
  })
