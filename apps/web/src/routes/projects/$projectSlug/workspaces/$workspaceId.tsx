import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  type ThreadEntry,
  WorkspaceShell,
} from "@workspace/ui/components/workspace-shell"
import { useEffect, useRef, useState } from "react"

import { validateOnboardingSearch } from "@/lib/onboarding"
import {
  acceptWorkspace,
  checkpointWorkspace,
  getDashboard,
  getWorkspace,
  promptWorkspace,
  restartWorkspace,
} from "@/lib/workspaces"

export const Route = createFileRoute(
  "/projects/$projectSlug/workspaces/$workspaceId"
)({
  validateSearch: validateOnboardingSearch,
  staleTime: 30_000,
  loader: async ({ params }) => {
    const [dashboard, result] = await Promise.all([
      getDashboard(),
      getWorkspace({
        data: { workspaceId: params.workspaceId },
      }),
    ])
    const matches = result?.workspace.projectSlug === params.projectSlug
    return { dashboard, result: matches ? result : null }
  },
  component: WorkspaceScreen,
})

function WorkspaceScreen() {
  const { workspaceId } = Route.useParams()
  const { onboarding } = Route.useSearch()
  const { dashboard, result } = Route.useLoaderData()
  const router = useRouter()
  const prompt = useServerFn(promptWorkspace)
  const checkpoint = useServerFn(checkpointWorkspace)
  const accept = useServerFn(acceptWorkspace)
  const restart = useServerFn(restartWorkspace)
  const [promptPending, setPromptPending] = useState(false)
  const [checkpointPending, setCheckpointPending] = useState(false)
  const [acceptPending, setAcceptPending] = useState(false)
  const [checkpointKey, setCheckpointKey] = useState(() => crypto.randomUUID())
  const [acceptKey, setAcceptKey] = useState(() => crypto.randomUUID())
  const [restartPending, setRestartPending] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState(
    result?.selectedModel ?? null
  )
  const modelSelectionChanged = useRef(false)
  const modelSelectionWorkspaceId = useRef(workspaceId)
  const [modelNotice, setModelNotice] = useState(result?.modelNotice ?? null)

  useEffect(() => {
    const workspaceChanged = modelSelectionWorkspaceId.current !== workspaceId

    if (workspaceChanged) {
      modelSelectionWorkspaceId.current = workspaceId
      modelSelectionChanged.current = false
    }

    if (workspaceChanged || !modelSelectionChanged.current) {
      setSelectedModel(result?.selectedModel ?? null)
      setModelNotice(result?.modelNotice ?? null)
    }
  }, [
    result?.modelNotice,
    result?.selectedModel?.modelId,
    result?.selectedModel?.providerId,
    workspaceId,
  ])

  useEffect(() => {
    if (
      !result ||
      (result.runtime.status !== "running" &&
        result.workspace.status !== "merging")
    )
      return
    const poll = window.setInterval(() => router.invalidate(), 1_500)
    return () => window.clearInterval(poll)
  }, [result, router])

  if (!result) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <div className="w-full max-w-lg">
          <Card>
            <CardContent className="grid justify-items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                This Workspace does not exist or you cannot access it.
              </p>
              <Button nativeButton={false} render={<Link to="/" />}>
                Return to projects
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  const { runtime, workspace } = result
  const workingChanges = result.versionControl.working
  const additions = workingChanges.reduce(
    (total, change) => total + change.additions,
    0
  )
  const deletions = workingChanges.reduce(
    (total, change) => total + change.deletions,
    0
  )
  const entries: ThreadEntry[] =
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
        ? runtime.messages.map((message) => ({
            id: message.id,
            kind: message.role === "user" ? "user" : "agent",
            title: message.error ? "Assistant error" : undefined,
            body: message.error ?? message.text,
            meta: message.role === "user" ? "You" : "Assistant",
            details: message.tools.length ? [...message.tools] : undefined,
          }))
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

  return (
    <WorkspaceShell
      organization={workspace.organizationName}
      projectName={workspace.projectName}
      repositoryName={workspace.repositoryName}
      workspaceName={workspace.title}
      browser={{
        url: "about:blank",
        title: "A preview will appear after the first checkpoint.",
        status: "loading",
      }}
      changedFileCount={workingChanges.length}
      checkpointHistory={result.checkpoints}
      changeSummary={
        workingChanges.length ? `+${additions} −${deletions}` : "No changes"
      }
      patch={workingChanges.map((change) => change.patch).join("\n")}
      checkpointPending={checkpointPending}
      acceptPending={acceptPending}
      checks={[
        {
          name: "Assistant",
          detail: runtime.opencode.healthy ? "healthy" : "unavailable",
          status: runtime.opencode.healthy ? "passed" : "failed",
        },
        {
          name: "Durable working tree",
          detail: `${runtime.files.length} files`,
          status: "passed",
        },
        {
          name: "Project baseline",
          detail: result.versionControl.projectChanged
            ? "Project Repository changed"
            : result.versionControl.baseCommit.slice(0, 7),
          status: result.versionControl.projectChanged ? "failed" : "passed",
        },
      ]}
      entries={entries}
      initialPrompt={
        onboarding && runtime.messages.length === 0
          ? "Make one small, useful improvement to this starter project. Explain the change, write the files, and leave it ready for review."
          : undefined
      }
      models={result.models}
      selectedModel={selectedModel}
      modelNotice={modelNotice}
      onModelChange={(model) => {
        modelSelectionChanged.current = true
        setSelectedModel(model)
        setModelNotice(null)
      }}
      onAccept={
        result.versionControl.branch.length > 0 &&
        workspace.status !== "merging" &&
        workspace.status !== "archived"
          ? async () => {
              setAcceptPending(true)
              setPromptError(null)
              try {
                await accept({
                  data: { workspaceId, idempotencyKey: acceptKey },
                })
                setAcceptKey(crypto.randomUUID())
                await router.invalidate()
              } catch (cause) {
                setPromptError(
                  cause instanceof Error ? cause.message : "Accept failed"
                )
              } finally {
                setAcceptPending(false)
              }
            }
          : undefined
      }
      onCheckpoint={async () => {
        setCheckpointPending(true)
        setPromptError(null)
        try {
          await checkpoint({
            data: {
              workspaceId,
              idempotencyKey: checkpointKey,
              message: "Checkpoint Workspace changes",
            },
          })
          setCheckpointKey(crypto.randomUUID())
          await router.invalidate()
        } catch (cause) {
          setPromptError(
            cause instanceof Error ? cause.message : "Checkpoint failed"
          )
        } finally {
          setCheckpointPending(false)
        }
      }}
      onSubmitPrompt={async (text, model) => {
        setPromptPending(true)
        setPromptError(null)

        try {
          const response = await prompt({ data: { workspaceId, text, model } })
          modelSelectionChanged.current = false
          setSelectedModel(response.selectedModel)
          setModelNotice(response.modelNotice)
          await router.invalidate()
        } catch (cause) {
          setPromptError(
            cause instanceof Error
              ? cause.message
              : "The assistant could not start the turn"
          )
        } finally {
          setPromptPending(false)
        }
      }}
      projects={dashboard.projects.map((project) => ({
        id: project.id,
        name: project.name,
        repositoryName: project.repositoryName,
        newWorkspaceHref: `/projects/${encodeURIComponent(project.slug)}/workspaces/new`,
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
                  : item.status === "ready"
                    ? "ready"
                    : "waiting",
          })),
      }))}
      promptDisabled={
        runtime.status === "provisioning" || runtime.status === "error"
      }
      promptError={promptError}
      promptPending={promptPending}
      restartPending={restartPending}
      workspaceError={
        runtime.status === "error"
          ? (workspace.errorSummary ?? "Workspace startup failed")
          : null
      }
      onRestartWorkspace={async () => {
        setRestartPending(true)
        setPromptError(null)

        try {
          await restart({ data: { workspaceId } })
          await router.invalidate()
        } catch (cause) {
          setPromptError(
            cause instanceof Error ? cause.message : "Workspace restart failed"
          )
        } finally {
          setRestartPending(false)
        }
      }}
    />
  )
}
