import { useWorkspaceHistory } from "@/lib/workspace/use-workspace-history"
import { useWorkspaceData } from "@/lib/workspace/use-workspace-data"
import {
  createFileRoute,
  type ErrorComponentProps,
  Link,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import {
  failureTag,
  isRuntimeNotInitialized,
  WorkspaceId,
  GitCommitId,
} from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  WorkspaceChat,
  WorkspacePanes,
  WorkspaceRoot,
  WorkspaceToolPane,
  WorkspaceTopbar,
  TerminalSurface,
} from "@workspace/ui/components/workspace-shell"
import type { WorkspacePermissionRequest } from "@workspace/ui/components/workspace/types"
import {
  isWorkspaceCommandPending,
  pendingWorkspaceCommandTarget,
  workspaceCommandErrorExcept,
  workspaceCommandErrorMessage,
} from "@workspace/ui/lib/workspace-commands"
import { useCallback } from "react"

import { validateOnboardingSearch } from "@/lib/onboarding"
import { getDashboard } from "@/functions/installation"
import { getProjectDeployments } from "@/functions/projects"
import {
  getWorkspace,
  readWorkspaceFile,
  readWorkspacePatch,
} from "@/functions/workspaces"
import { useWorkspaceActions } from "@/lib/workspace/use-workspace-actions"
import { useWorkspaceLiveState } from "@/lib/workspace/use-workspace-live-state"
import { workspaceThreadEntries } from "@/lib/workspace/workspace-thread-entries"
import { workspaceCheckItems } from "@/lib/workspace/workspace-check-items"
import { AppShell } from "@/components/app-shell"

export const Route = createFileRoute(
  "/projects/$projectSlug/workspaces/$workspaceId"
)({
  validateSearch: validateOnboardingSearch,
  staleTime: 30_000,
  loader: async ({ params }) => {
    const dashboard = await getDashboard()
    const project = dashboard.projects.find(
      (candidate) => candidate.slug === params.projectSlug
    )
    if (!project) throw notFound()
    const [result, deployments] = await Promise.all([
      getWorkspace({
        data: { workspaceId: params.workspaceId },
      }).catch((cause) => {
        if (failureTag(cause) === "AuthenticationRequired") {
          throw redirect({ to: "/" })
        }
        throw cause
      }),
      getProjectDeployments({ data: { projectId: project.id } }),
    ])
    if (result.workspace.projectSlug !== params.projectSlug) throw notFound()
    return { dashboard, deployments, result }
  },
  component: WorkspaceScreen,
  errorComponent: WorkspaceLoadError,
})

const loadErrorCopy = (error: Error) => {
  if (failureTag(error) === "AccessDenied") {
    return {
      title: "Workspace unavailable",
      body: "This Workspace does not exist or you cannot access it.",
      retry: false,
    }
  }
  if (isRuntimeNotInitialized(error)) {
    return {
      title: "Workspace is starting",
      body: "Version control is still initializing. Try again in a moment.",
      retry: true,
    }
  }
  return {
    title: "Workspace unavailable",
    body: "Sylph could not load this Workspace. Retry or return to Project settings.",
    retry: true,
  }
}

function WorkspaceLoadError({ error, reset }: ErrorComponentProps) {
  const { projectSlug } = Route.useParams()
  const router = useRouter()
  const copy = loadErrorCopy(error)

  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
      <Card className="w-full max-w-lg">
        <CardContent className="py-10 text-center">
          <h1 className="text-lg font-semibold">{copy.title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {copy.body}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            {copy.retry ? null : (
              <Button nativeButton={false} render={<Link to="/" />}>
                Return to projects
              </Button>
            )}
            {copy.retry ? (
              <Button
                onClick={() => {
                  reset()
                  void router.invalidate()
                }}
              >
                Try again
              </Button>
            ) : null}
            <Button
              nativeButton={false}
              render={
                <Link
                  params={{ projectSlug }}
                  to="/projects/$projectSlug/settings"
                />
              }
              variant="outline"
            >
              Project settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

function WorkspaceScreen() {
  const { workspaceId } = Route.useParams()
  const { onboarding } = Route.useSearch()
  const {
    dashboard,
    deployments,
    result: initialResult,
  } = Route.useLoaderData()
  const {
    result,
    refresh: refreshLive,
    refreshError,
  } = useWorkspaceData(initialResult)
  const router = useRouter()
  const readFile = useServerFn(readWorkspaceFile)
  const readPatch = useServerFn(readWorkspacePatch)
  const forkHead = result.versionControl.forkHead
  const readWorkspaceChanges = useCallback(
    async (scope: "working" | "branch") => {
      try {
        return await readPatch({
          data: {
            workspaceId: WorkspaceId.make(workspaceId),
            scope,
            expectedCommit: GitCommitId.make(forkHead),
          },
        })
      } catch (cause) {
        if (failureTag(cause) === "PreconditionFailed")
          await refreshLive("workspace")
        throw cause
      }
    },
    [readPatch, forkHead, workspaceId, refreshLive]
  )
  const refresh = useCallback(() => router.invalidate(), [router])
  const { runtime, workspace } = result
  const history = useWorkspaceHistory(
    workspaceId,
    runtime.sessionId,
    runtime.messagesCursor
  )
  const {
    dismissPermissionRequest,
    presence,
    state: liveState,
  } = useWorkspaceLiveState(
    workspaceId,
    runtime.sessionId,
    runtime.eventCursor,
    refreshLive
  )
  const actions = useWorkspaceActions({
    dismissPermissionRequest,
    refresh,
    result,
    workspaceId,
  })
  const readWorkspaceFileContent = useCallback(
    async (path: string) => {
      try {
        return await readFile({
          data: { workspaceId: WorkspaceId.make(workspaceId), path },
        })
      } catch (cause) {
        if (failureTag(cause) === "WorkspaceFileNotFound") {
          return {
            path,
            size: 0,
            updatedAt: Date.now(),
            encoding: "missing" as const,
            content: null,
          }
        }
        throw cause
      }
    },
    [readFile, workspaceId]
  )
  const workingChanges = result.versionControl.working
  const additions = workingChanges.reduce(
    (total, change) => total + change.additions,
    0
  )
  const deletions = workingChanges.reduce(
    (total, change) => total + change.deletions,
    0
  )
  const entries = workspaceThreadEntries(
    {
      errorSummary: workspace.errorSummary,
      lastTurnOutcome: history.page ? null : runtime.lastTurnOutcome,
      files: runtime.files,
      messages: history.page?.messages ?? runtime.messages,
      status: runtime.status,
    },
    history.page ? { ...liveState, partialMessages: {} } : liveState,
    history.page ? [] : actions.optimisticEntries,
    actions.matchedSkill
  )
  const permissionRequests: WorkspacePermissionRequest[] = Object.values({
    ...Object.fromEntries(
      runtime.permissions.map((request) => [
        request.id,
        {
          id: request.id,
          action: request.action,
          resources: [...request.resources],
          message: request.message,
          canSave: Boolean(request.save?.length),
        },
      ])
    ),
    ...liveState.permissionRequests,
  })
  const checkpointCheck = result.checks.find((run) => run.kind === "checkpoint")
  const productionCheck = result.checks.find((run) => run.kind === "production")
  const checkItems = workspaceCheckItems(checkpointCheck, productionCheck, {
    automaticRepairsUsed: runtime.automaticRepairsUsed,
    limits: runtime.limits,
    onRepair: (run) => actions.runRepair(run.id),
    onRetry: (run) => actions.runRetry(run.id),
    onUpdateProject: actions.runUpdateProject,
    pending: actions.checkActionPending,
    projectChanged: result.versionControl.projectChanged,
    workingChanges: workingChanges.length,
  })
  const isPending = (
    command: Parameters<typeof isWorkspaceCommandPending>[1]
  ) => isWorkspaceCommandPending(actions.pending, command)
  const browser = {
    commit: checkpointCheck?.commit,
    url: checkpointCheck?.previewUrl ?? "",
    title: checkpointCheck?.previewUrl
      ? `Checkpoint ${checkpointCheck.commit.slice(0, 7)} Preview`
      : "A preview will appear after its Check passes.",
    status: checkpointCheck?.previewUrl
      ? ("live" as const)
      : checkpointCheck?.status === "failed"
        ? ("error" as const)
        : ("loading" as const),
  }
  const skills = result.skills
    .filter((skill) => skill.metadata.userInvokable)
    .map((skill) => ({
      name: skill.metadata.name,
      description: skill.metadata.description ?? "No description provided.",
      scope: skill.scope,
    }))
  const action = actions.actionProps

  return (
    <AppShell
      active="home"
      activeWorkspaceId={workspaceId}
      dashboard={dashboard}
      showHeader={false}
    >
      <WorkspaceRoot workspaceId={workspaceId}>
        <WorkspaceTopbar
          agentControllingBrowser={false}
          archivePending={isPending("archive")}
          browser={browser}
          checks={checkItems}
          discardPending={isPending("discard")}
          onArchiveWorkspace={action.onArchiveWorkspace}
          onDiscardWorkspace={action.onDiscardWorkspace}
          onRebase={action.onRebase}
          onRestartWorkspace={action.onRestartWorkspace}
          projectName={workspace.projectName}
          presence={presence}
          rebasePending={isPending("rebase")}
          repositoryName={workspace.repositoryName}
          restartPending={isPending("restart")}
          workspaceName={workspace.title}
        />
        <WorkspacePanes
          terminal={<TerminalSurface entries={entries} checks={checkItems} />}
          chat={
            <WorkspaceChat
              activeTurnStartedAt={runtime.activeTurnStartedAt}
              answeringQuestionId={pendingWorkspaceCommandTarget(
                actions.pending,
                "answerQuestion"
              )}
              cancelTurnPending={isPending("cancelTurn")}
              entries={entries}
              historyControls={
                history.page || history.hasOlder || history.error ? (
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {history.hasOlder ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={history.pending}
                        onClick={() => void history.loadOlder()}
                      >
                        {history.pending
                          ? "Loading messages…"
                          : "Earlier messages"}
                      </Button>
                    ) : null}
                    {history.page ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={history.showLatest}
                      >
                        Latest messages
                      </Button>
                    ) : null}
                    {history.error ? (
                      <p role="alert" className="text-sm text-destructive">
                        {history.error}
                      </p>
                    ) : null}
                  </div>
                ) : undefined
              }
              initialPrompt={
                onboarding && runtime.messages.length === 0
                  ? "Make one small, useful improvement to this starter project. Explain the change, write the files, and leave it ready for review."
                  : undefined
              }
              modelNotice={actions.modelNotice}
              models={result.models}
              onAnswerQuestion={action.onAnswerQuestion}
              onCancelTurn={action.onCancelTurn}
              onModelChange={action.onModelChange}
              onPermissionReply={action.onPermissionReply}
              onRestartWorkspace={action.onRestartWorkspace}
              onSubmitPrompt={action.onSubmitPrompt}
              permissionRequests={permissionRequests}
              promptDisabled={
                runtime.status === "provisioning" ||
                runtime.status === "error" ||
                workspace.status === "archived"
              }
              promptError={workspaceCommandErrorExcept(
                actions.commandError,
                "review"
              )}
              promptPending={isPending("prompt")}
              questions={runtime.questions}
              queuedMessages={runtime.queuedMessages}
              replyingPermissionId={pendingWorkspaceCommandTarget(
                actions.pending,
                "permissionReply"
              )}
              restartPending={isPending("restart")}
              runtimeLimits={runtime.limits}
              selectedModel={actions.selectedModel}
              skills={skills}
              turnActive={runtime.status === "running"}
              turnInterrupted={runtime.status === "interrupted"}
              workspaceError={
                refreshError ??
                (runtime.status === "error"
                  ? (workspace.errorSummary ?? "Workspace startup failed")
                  : null)
              }
            />
          }
        >
          <WorkspaceToolPane
            changeError={
              workspaceCommandErrorMessage(
                actions.commandError,
                "checkpoint"
              ) ?? workspaceCommandErrorMessage(actions.commandError, "accept")
            }
            entries={entries}
            onAccept={action.onAccept}
            onCheckpoint={action.onCheckpoint}
            acceptDisabled={
              workingChanges.length > 0 ||
              !action.onAccept ||
              isPending("checkpoint")
            }
            acceptPending={isPending("accept")}
            acceptBlockers={actions.acceptance.blockers}
            checkpointDisabled={
              workingChanges.length === 0 || !action.onCheckpoint
            }
            checkpointPending={isPending("checkpoint")}

            browser={browser}
            changedFileCount={workingChanges.length}
            changeSummary={
              workingChanges.length
                ? `+${additions} −${deletions}`
                : "No changes"
            }
            checkpointHistory={result.checkpoints}
            checks={checkItems}
            currentReviewer={result.currentReviewer}
            acceptedCommit={workspace.acceptedCommit}
            canDeploy={dashboard.installation.canAdminister}
            deployError={workspaceCommandErrorMessage(
              actions.commandError,
              "deploy"
            )}
            deployments={deployments}
            deployPending={pendingWorkspaceCommandTarget(
              actions.pending,
              "deploy"
            )}
            fileChanges={workingChanges}
            files={runtime.files}
            onAddReviewComment={action.onAddReviewComment}
            onDeploy={action.onDeploy}
            onReadFile={readWorkspaceFileContent}
            onResolveReviewComment={action.onResolveReviewComment}
            onSubmitReview={action.onSubmitReview}
            onReadPatch={readWorkspaceChanges}
            patchRevision={`${forkHead}:${result.workingRevision}`}
            reviewPatchRevision={`${result.versionControl.baseCommit}:${forkHead}`}
            review={result.review}
            reviewError={workspaceCommandErrorMessage(
              actions.commandError,
              "review"
            )}

            reviewPending={isPending("review")}
          />
        </WorkspacePanes>
      </WorkspaceRoot>
    </AppShell>
  )
}
