import {
  createFileRoute,
  type ErrorComponentProps,
  Link,
  notFound,
  redirect,
  useRouter,
} from "@tanstack/react-router"
import {
  failureTag,
  isRuntimeNotInitialized,
  resolveSkillInvocation,
  type WorkspacePresenceUser,
  type WorkspacePermissionReply,
  WorkspaceId,
} from "@workspace/domain"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  type ThreadEntry,
  type CheckItem,
  type WorkspacePermissionRequest,
  type WorkspaceQuestionValue,
  WorkspaceShell,
} from "@workspace/ui/components/workspace-shell"
import {
  isWorkspaceCommandPending,
  pendingWorkspaceCommandTarget,
  workspaceCommandErrorMessage,
} from "@workspace/ui/lib/workspace-commands"
import { useCallback, useEffect, useRef, useState } from "react"

import { CommandPalette } from "@/components/command-palette"
import { validateOnboardingSearch } from "@/lib/onboarding"
import { toolCallEntry } from "@/lib/tool-call-entries"
import { getDashboard } from "@/functions/installation"
import {
  deployProjectCommit,
  getProjectDeployments,
} from "@/functions/projects"
import {
  addWorkspaceReviewComment,
  resolveWorkspaceReviewComment,
  submitWorkspaceReview,
} from "@/functions/review"
import {
  acceptWorkspace,
  answerWorkspaceQuestion,
  archiveWorkspace,
  cancelWorkspaceTurn,
  checkpointWorkspace,
  discardWorkspace,
  getWorkspace,
  promptWorkspace,
  rebaseWorkspace,
  repairWorkspaceCheck,
  readWorkspaceFile,
  restartWorkspace,
  retryWorkspaceCheck,
  syncWorkspaceProject,
} from "@/functions/workspaces"
import { useWorkspaceCommands } from "@/lib/use-workspace-commands"
import { useWorkspaceCreation } from "@/lib/use-workspace-creation"

import {
  applyWorkspaceRuntimeEvent,
  emptyWorkspaceLiveState,
  workspaceEventNeedsSnapshot,
} from "@/lib/workspace-runtime-events"
import { WorkspaceSocket } from "@/lib/workspace-socket"

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
  const { dashboard, deployments, result } = Route.useLoaderData()
  const router = useRouter()
  const prompt = useServerFn(promptWorkspace)
  const cancelTurn = useServerFn(cancelWorkspaceTurn)
  const answerQuestion = useServerFn(answerWorkspaceQuestion)
  const archive = useServerFn(archiveWorkspace)
  const discard = useServerFn(discardWorkspace)
  const checkpoint = useServerFn(checkpointWorkspace)
  const accept = useServerFn(acceptWorkspace)
  const addReviewComment = useServerFn(addWorkspaceReviewComment)
  const restart = useServerFn(restartWorkspace)
  const rebase = useServerFn(rebaseWorkspace)
  const retryCheck = useServerFn(retryWorkspaceCheck)
  const repairCheck = useServerFn(repairWorkspaceCheck)
  const resolveReviewComment = useServerFn(resolveWorkspaceReviewComment)
  const syncProject = useServerFn(syncWorkspaceProject)
  const submitReview = useServerFn(submitWorkspaceReview)
  const readFile = useServerFn(readWorkspaceFile)
  const deployCommit = useServerFn(deployProjectCommit)
  const refresh = useCallback(() => router.invalidate(), [router])
  const commands = useWorkspaceCommands(refresh)
  const checkActionPending = isWorkspaceCommandPending(
    commands.pending,
    "check"
  )
  const [checkpointKey, setCheckpointKey] = useState(() => crypto.randomUUID())
  const [acceptKey, setAcceptKey] = useState(() => crypto.randomUUID())
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID())
  const [repairKey, setRepairKey] = useState(() => crypto.randomUUID())
  const [deployKey, setDeployKey] = useState(() => crypto.randomUUID())
  const [liveState, setLiveState] = useState(emptyWorkspaceLiveState)
  const liveStateRef = useRef(liveState)
  const [presence, setPresence] = useState<
    ReadonlyArray<WorkspacePresenceUser>
  >([])
  const socketCursor = useRef({
    workspaceId,
    cursor: result.runtime.eventCursor,
  })
  if (socketCursor.current.workspaceId !== workspaceId) {
    socketCursor.current = { workspaceId, cursor: result.runtime.eventCursor }
  }
  const [optimisticEntries, setOptimisticEntries] = useState<ThreadEntry[]>([])
  const [selectedModel, setSelectedModel] = useState(
    result.selectedModel ?? null
  )
  const modelSelectionChanged = useRef(false)
  const modelSelectionWorkspaceId = useRef(workspaceId)
  const [modelNotice, setModelNotice] = useState(result.modelNotice ?? null)
  const { creatingProjectId, startWorkspace } = useWorkspaceCreation()

  useEffect(() => {
    liveStateRef.current = emptyWorkspaceLiveState()
    setLiveState(liveStateRef.current)
    setOptimisticEntries([])
    setPresence([])
    if (!result.runtime.sessionId) return
    let refreshTimer: number | null = null

    const refresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => void router.invalidate(), 80)
    }

    const socket = new WorkspaceSocket({
      workspaceId,
      sessionId: result.runtime.sessionId,
      cursor: socketCursor.current.cursor,
      onConnecting: () => {
        liveStateRef.current = emptyWorkspaceLiveState()
        setLiveState(liveStateRef.current)
      },
      onEvent: async (event) => {
        liveStateRef.current = await applyWorkspaceRuntimeEvent(
          liveStateRef.current,
          event
        )
        setLiveState(liveStateRef.current)
        if (workspaceEventNeedsSnapshot(event)) refresh()
      },
      onSynced: () => {
        setOptimisticEntries([])
        refresh()
      },
      onPresence: setPresence,
    })
    const pause = () => socket.pause()
    const resume = () => socket.resume()
    window.addEventListener("pagehide", pause)
    window.addEventListener("pageshow", resume)
    socket.connect()

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      window.removeEventListener("pagehide", pause)
      window.removeEventListener("pageshow", resume)
      socket.close()
    }
  }, [result.runtime.sessionId, router, workspaceId])

  useEffect(() => {
    const workspaceChanged = modelSelectionWorkspaceId.current !== workspaceId

    if (workspaceChanged) {
      modelSelectionWorkspaceId.current = workspaceId
      modelSelectionChanged.current = false
    }

    if (workspaceChanged || !modelSelectionChanged.current) {
      setSelectedModel(result.selectedModel ?? null)
      setModelNotice(result.modelNotice ?? null)
    }
  }, [
    result.modelNotice,
    result.selectedModel?.modelId,
    result.selectedModel?.providerId,
    workspaceId,
  ])

  const { runtime, workspace } = result
  const readWorkspaceFileContent = useCallback(
    async (path: string) => {
      try {
        return await readFile({
          data: {
            workspaceId: WorkspaceId.make(workspaceId),
            path,
          },
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
  const matchedSkill = (text: string) => {
    const invocation = resolveSkillInvocation(text, result.skills)
    if (!invocation) return undefined
    const skill = result.skills.find(
      (candidate) => candidate.metadata.name === invocation.skillId
    )
    return skill
      ? {
          name: invocation.skillId,
          scope: skill.scope,
          prompt: invocation.text,
        }
      : undefined
  }
  const workingChanges = result.versionControl.working
  const additions = workingChanges.reduce(
    (total, change) => total + change.additions,
    0
  )
  const deletions = workingChanges.reduce(
    (total, change) => total + change.deletions,
    0
  )
  const snapshotEntries: ThreadEntry[] =
    runtime.status === "error"
      ? [
          {
            id: "workspace-error",
            kind: "agent",
            title: "Workspace startup failed",
            body:
              workspace.errorSummary ??
              "The assistant did not finish initializing this Workspace.",
            meta: "Action required",
          },
        ]
      : runtime.messages.length
        ? runtime.messages.flatMap((message) => {
            if (!message.parts.length && message.error) {
              return [
                {
                  id: message.id,
                  kind: "agent" as const,
                  title: "Assistant error",
                  body: message.error,
                  meta: "Assistant",
                },
              ]
            }
            return message.parts.map((part, index): ThreadEntry => {
              if (part.type === "tool") {
                return {
                  id: `${message.id}:${part.id}`,
                  kind: "tool",
                  title:
                    index === 0 && message.error
                      ? "Assistant error"
                      : undefined,
                  body: "",
                  tool: toolCallEntry(part),
                }
              }
              return {
                id: `${message.id}:text:${index}`,
                kind: message.role === "user" ? "user" : "agent",
                title:
                  index === 0 && message.error ? "Assistant error" : undefined,
                body: index === 0 && message.error ? message.error : part.text,
                skill:
                  message.role === "user" ? matchedSkill(part.text) : undefined,
                meta: message.role === "user" ? "You" : "Assistant",
              }
            })
          })
        : [
            {
              id: "workspace-ready",
              kind: "result",
              title: "Your durable coding Workspace is ready",
              body: "Ask the assistant to build the first feature. Your files and conversation stay with this Workspace between turns.",
              meta: `${runtime.files.length} starter files`,
              details: [...runtime.files],
            },
          ]

  const snapshotMessageIds = new Set(
    runtime.messages.map((message) => message.id)
  )
  const streamingEntries: ThreadEntry[] = Object.entries(
    liveState.partialMessages
  )
    .filter(([id]) => !snapshotMessageIds.has(id))
    .map(([id, body]) => ({
      id,
      kind: "agent",
      body,
      meta: "Assistant",
    }))
  const entries = [
    ...snapshotEntries,
    ...optimisticEntries,
    ...streamingEntries,
  ]
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
  const currentCheckpointPassed =
    checkpointCheck?.commit === result.versionControl.forkHead &&
    checkpointCheck.status === "passed"
  const checkItems: CheckItem[] = checkpointCheck
    ? checkpointCheck.stages.map((stage, index) => {
        const diagnostic = checkpointCheck.diagnostics.find(
          (item) => item.stage === stage.name
        )
        const failed = stage.status === "failed"
        return {
          name: stage.name[0].toUpperCase() + stage.name.slice(1),
          detail:
            stage.durationMs === null
              ? `${stage.detail} · attempt ${checkpointCheck.attempt}/${checkpointCheck.maxAttempts ?? runtime.limits.maxCheckAttempts}`
              : `${stage.detail} · ${(stage.durationMs / 1000).toFixed(1)}s · attempt ${checkpointCheck.attempt}/${checkpointCheck.maxAttempts ?? runtime.limits.maxCheckAttempts}`,
          status:
            stage.status === "passed" || stage.status === "skipped"
              ? ("passed" as const)
              : failed
                ? ("failed" as const)
                : stage.status === "running"
                  ? ("running" as const)
                  : ("queued" as const),
          output: diagnostic?.output,
          evidence:
            stage.name === "browser" ? checkpointCheck.evidence : undefined,
          action:
            failed &&
            index ===
              checkpointCheck.stages.findIndex(
                (candidate) => candidate.status === "failed"
              )
              ? {
                  label: "Retry",
                  disabled: checkActionPending,
                  onClick: () => {
                    void commands.run(
                      "check",
                      async () => {
                        await retryCheck({
                          data: {
                            workspaceId,
                            runId: checkpointCheck.id,
                            idempotencyKey: retryKey,
                          },
                        })
                        setRetryKey(crypto.randomUUID())
                      },
                      "Check retry failed"
                    )
                  },
                }
              : undefined,
        }
      })
    : []
  if (checkpointCheck?.status === "failed") {
    const automaticRepairs = `${runtime.automaticRepairsUsed}/${runtime.limits.maxAutomaticRepairs} automatic`
    checkItems.push({
      name: "Agent repair",
      detail:
        checkpointCheck.repairStatus === "started"
          ? `Repair Turn ${checkpointCheck.repairAttempt ?? 1}/${checkpointCheck.maxRepairAttempts ?? runtime.limits.maxRepairAttempts} · ${Math.round(runtime.limits.maxTurnDurationMs / 60_000)} min limit · ${automaticRepairs}`
          : `${checkpointCheck.repairAttempt ?? 0}/${checkpointCheck.maxRepairAttempts ?? runtime.limits.maxRepairAttempts} repairs used · ${automaticRepairs}`,
      status: checkpointCheck.repairStatus === "started" ? "running" : "failed",
      output: checkpointCheck.repairNotice,
      evidence: undefined,
      action: {
        label: "Repair",
        disabled:
          checkActionPending ||
          checkpointCheck.repairStatus === "started" ||
          (checkpointCheck.repairAttempt ?? 0) >=
            (checkpointCheck.maxRepairAttempts ??
              runtime.limits.maxRepairAttempts),
        onClick: () => {
          void commands.run(
            "check",
            async () => {
              await repairCheck({
                data: {
                  workspaceId,
                  runId: checkpointCheck.id,
                  idempotencyKey: repairKey,
                },
              })
              setRepairKey(crypto.randomUUID())
            },
            "Repair turn failed"
          )
        },
      },
    })
  }
  if (result.versionControl.projectChanged) {
    checkItems.unshift({
      name: "Project Repository",
      detail: "A newer commit is available",
      status: "failed",
      output: undefined,
      evidence: undefined,
      action: {
        label: "Update",
        disabled: checkActionPending || workingChanges.length > 0,
        onClick: () => {
          void commands.run(
            "check",
            async () => {
              await syncProject({ data: { workspaceId } })
            },
            "Repository update failed"
          )
        },
      },
    })
  }
  if (productionCheck) {
    checkItems.push(
      ...productionCheck.stages.map((stage) => ({
        name: `Production ${stage.name}`,
        detail: stage.detail,
        status:
          stage.status === "passed" || stage.status === "skipped"
            ? ("passed" as const)
            : stage.status === "failed"
              ? ("failed" as const)
              : stage.status === "running"
                ? ("running" as const)
                : ("queued" as const),
        output: productionCheck.diagnostics.find(
          (diagnostic) => diagnostic.stage === stage.name
        )?.output,
      }))
    )
  }

  const runReviewMutation = (mutation: () => Promise<object>) =>
    commands.run(
      "review",
      async () => {
        await mutation()
      },
      "The review could not be updated"
    )

  return (
    <CommandPalette dashboard={dashboard}>
      {({ openSearch }) => (
        <WorkspaceShell
          key={workspaceId}
          workspaceId={workspaceId}
          canAdminister={dashboard.installation.canAdminister}
          organization={workspace.organizationName}
          projectName={workspace.projectName}
          repositoryName={workspace.repositoryName}
          workspaceName={workspace.title}
          onOpenSearch={openSearch}
          browser={{
            url: checkpointCheck?.previewUrl ?? "",
            title: checkpointCheck?.previewUrl
              ? `Checkpoint ${checkpointCheck.commit.slice(0, 7)} Preview`
              : "A preview will appear after its Check passes.",
            status: checkpointCheck?.previewUrl
              ? "live"
              : checkpointCheck?.status === "failed"
                ? "error"
                : "loading",
          }}
          changedFileCount={workingChanges.length}
          checkpointHistory={result.checkpoints}
          files={runtime.files}
          fileChanges={workingChanges}
          onReadFile={readWorkspaceFileContent}
          deployments={deployments}
          acceptedCommit={workspace.acceptedCommit}
          deployPending={pendingWorkspaceCommandTarget(
            commands.pending,
            "deploy"
          )}
          deployError={workspaceCommandErrorMessage(commands.error, "deploy")}
          onDeploy={async (commit) => {
            const started = await commands.run(
              "deploy",
              async () => {
                await deployCommit({
                  data: {
                    projectId: workspace.projectId,
                    commit,
                    confirmedCommit: commit,
                    idempotencyKey: deployKey,
                  },
                })
                setDeployKey(crypto.randomUUID())
              },
              "Deployment could not start",
              { target: commit }
            )
            if (!started) throw new Error("Deployment could not start")
          }}
          review={result.review}
          reviewPatch={result.versionControl.branch
            .map((change) => change.patch)
            .join("\n")}
          currentReviewer={result.currentReviewer}
          changeSummary={
            workingChanges.length ? `+${additions} −${deletions}` : "No changes"
          }
          patch={workingChanges.map((change) => change.patch).join("\n")}
          pending={commands.pending}
          commandError={commands.error}
          checks={checkItems}
          entries={entries}
          permissionRequests={permissionRequests}
          presence={presence}
          questions={runtime.questions}
          queuedMessages={runtime.queuedMessages}
          runtimeLimits={runtime.limits}
          turnActive={runtime.status === "running"}
          turnInterrupted={runtime.status === "interrupted"}
          activeTurnStartedAt={runtime.activeTurnStartedAt}
          onAnswerQuestion={async (
            questionId,
            answer: Record<string, WorkspaceQuestionValue>
          ) => {
            await commands.run(
              "answerQuestion",
              async () => {
                await answerQuestion({
                  data: { workspaceId, questionId, answer },
                })
              },
              "The agent question answer could not be sent",
              { target: questionId }
            )
          }}
          onCancelTurn={async () => {
            await commands.run(
              "cancelTurn",
              async () => {
                await cancelTurn({ data: { workspaceId } })
              },
              "Turn cancellation failed"
            )
          }}
          onPermissionReply={async (requestId, reply) => {
            await commands.run(
              "permissionReply",
              async () => {
                const response = await fetch(
                  `/api/workspaces/${encodeURIComponent(workspaceId)}`,
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      workspaceId,
                      requestId,
                      reply: reply satisfies WorkspacePermissionReply,
                    }),
                  }
                )
                if (!response.ok) throw new Error(await response.text())
                setLiveState((state) => {
                  const permissionRequests = { ...state.permissionRequests }
                  delete permissionRequests[requestId]
                  const next = { ...state, permissionRequests }
                  liveStateRef.current = next
                  return next
                })
              },
              "The permission response could not be sent",
              { target: requestId, refresh: false }
            )
          }}
          onAddReviewComment={(comment) =>
            runReviewMutation(() =>
              addReviewComment({
                data: {
                  workspaceId,
                  commit: result.review.commit,
                  ...comment,
                },
              })
            )
          }
          onResolveReviewComment={(commentId, resolved) =>
            runReviewMutation(() =>
              resolveReviewComment({
                data: { workspaceId, commentId, resolved },
              })
            ).then(() => undefined)
          }
          onSubmitReview={(decision) =>
            runReviewMutation(() =>
              submitReview({
                data: {
                  workspaceId,
                  commit: result.review.commit,
                  decision,
                },
              })
            ).then(() => undefined)
          }
          initialPrompt={
            onboarding && runtime.messages.length === 0
              ? "Make one small, useful improvement to this starter project. Explain the change, write the files, and leave it ready for review."
              : undefined
          }
          models={result.models}
          skills={result.skills
            .filter((skill) => skill.metadata.userInvokable)
            .map((skill) => ({
              name: skill.metadata.name,
              description:
                skill.metadata.description ?? "No description provided.",
              scope: skill.scope,
            }))}
          selectedModel={selectedModel}
          modelNotice={modelNotice}
          onModelChange={(model) => {
            modelSelectionChanged.current = true
            setSelectedModel(model)
            setModelNotice(null)
          }}
          onAccept={
            result.versionControl.branch.length > 0 &&
            currentCheckpointPassed &&
            result.review.decision === "approved" &&
            !result.versionControl.projectChanged &&
            workspace.status !== "merging" &&
            workspace.status !== "archived"
              ? async () => {
                  await commands.run(
                    "accept",
                    async () => {
                      await accept({
                        data: { workspaceId, idempotencyKey: acceptKey },
                      })
                      setAcceptKey(crypto.randomUUID())
                    },
                    "Accept failed"
                  )
                }
              : undefined
          }
          onRebase={
            result.versionControl.projectChanged &&
            workspace.status !== "merging" &&
            workspace.status !== "archived"
              ? async () => {
                  await commands.run(
                    "rebase",
                    async () => {
                      await rebase({ data: { workspaceId } })
                    },
                    "Rebase failed"
                  )
                }
              : undefined
          }
          onCheckpoint={
            workspace.status !== "archived"
              ? async () => {
                  await commands.run(
                    "checkpoint",
                    async () => {
                      await checkpoint({
                        data: {
                          workspaceId,
                          idempotencyKey: checkpointKey,
                          message: "Checkpoint Workspace changes",
                        },
                      })
                      setCheckpointKey(crypto.randomUUID())
                    },
                    "Checkpoint failed"
                  )
                }
              : undefined
          }
          onSubmitPrompt={async (text, model, delivery) => {
            const optimisticId = `optimistic-${crypto.randomUUID()}`
            setOptimisticEntries([
              {
                id: optimisticId,
                kind: "user",
                body: text,
                skill: matchedSkill(text),
                meta:
                  delivery === "steer"
                    ? "You · steering"
                    : delivery === "queue"
                      ? "You · queued"
                      : "You",
              },
            ])

            await commands.run(
              "prompt",
              async () => {
                const response = await prompt({
                  data: { workspaceId, text, model, delivery },
                })
                modelSelectionChanged.current = false
                setSelectedModel(response.selectedModel)
                setModelNotice(response.modelNotice)
                await refresh()
              },
              "The assistant could not start the turn",
              { refresh: false }
            )
            setOptimisticEntries([])
          }}
          projects={dashboard.projects.map((project) => ({
            id: project.id,
            name: project.name,
            repositoryName: project.repositoryName,
            creatingWorkspace: creatingProjectId === project.id,
            onCreateWorkspace: () => void startWorkspace(project),
            settingsHref: `/projects/${encodeURIComponent(project.slug)}/settings`,
            workspaces: dashboard.workspaces
              .filter((item) => item.projectId === project.id)
              .map((item) => ({
                id: item.id,
                name: item.title,
                href: `/projects/${encodeURIComponent(project.slug)}/workspaces/${encodeURIComponent(item.id)}`,
                branch: project.defaultBranch,
                status:
                  item.status === "error"
                    ? "error"
                    : item.status === "running"
                      ? "running"
                      : item.status === "archived"
                        ? "archived"
                        : item.status === "ready"
                          ? "ready"
                          : "waiting",
              })),
          }))}
          promptDisabled={
            runtime.status === "provisioning" ||
            runtime.status === "error" ||
            workspace.status === "archived"
          }
          workspaceError={
            runtime.status === "error"
              ? (workspace.errorSummary ?? "Workspace startup failed")
              : null
          }
          onRestartWorkspace={async () => {
            await commands.run(
              "restart",
              async () => {
                await restart({ data: { workspaceId, model: selectedModel } })
              },
              "Workspace restart failed"
            )
          }}
          onArchiveWorkspace={
            workspace.status !== "archived"
              ? async () => {
                  await commands.run(
                    "archive",
                    async () => {
                      await archive({ data: { workspaceId } })
                    },
                    "Workspace archive failed"
                  )
                }
              : undefined
          }
          onDiscardWorkspace={async () => {
            await commands.run(
              "discard",
              async () => {
                await discard({ data: { workspaceId } })
                await router.navigate({ to: "/" })
              },
              "Workspace discard failed",
              { refresh: false }
            )
          }}
        />
      )}
    </CommandPalette>
  )
}
