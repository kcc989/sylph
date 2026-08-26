import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  type ThreadEntry,
  WorkspaceShell,
} from "@workspace/ui/components/workspace-shell"
import { useEffect, useState } from "react"

import {
  getDashboard,
  getWorkspace,
  promptWorkspace,
  restartWorkspace,
} from "@/lib/workspaces"

export const Route = createFileRoute(
  "/organizations/$organizationSlug/projects/$projectSlug/workspaces/$workspaceId"
)({
  loader: async ({ params }) => {
    const dashboard = await getDashboard()
    const result = await getWorkspace({
      data: { workspaceId: params.workspaceId },
    })
    const matches =
      result?.workspace.projectSlug === params.projectSlug &&
      result.workspace.organizationSlug === params.organizationSlug
    return { dashboard, result: matches ? result : null }
  },
  component: WorkspaceScreen,
})

function WorkspaceScreen() {
  const { workspaceId } = Route.useParams()
  const { dashboard, result } = Route.useLoaderData()
  const router = useRouter()
  const prompt = useServerFn(promptWorkspace)
  const restart = useServerFn(restartWorkspace)
  const [promptPending, setPromptPending] = useState(false)
  const [restartPending, setRestartPending] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)

  useEffect(() => {
    if (!result || result.runtime.status !== "running") return
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
      changedFileCount={0}
      changeSummary="No checkpoint diff"
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
      ]}
      entries={entries}
      model={runtime.model}
      onSubmitPrompt={async (text) => {
        setPromptPending(true)
        setPromptError(null)

        try {
          await prompt({ data: { workspaceId, text } })
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
        newWorkspaceHref: `/organizations/${encodeURIComponent(project.organizationSlug)}/projects/${encodeURIComponent(project.slug)}/workspaces/new`,
        settingsHref: `/organizations/${encodeURIComponent(project.organizationSlug)}/projects/${encodeURIComponent(project.slug)}/settings`,
        workspaces: dashboard.workspaces
          .filter((item) => item.projectId === project.id)
          .map((item) => ({
            id: item.id,
            name: item.title,
            href: `/organizations/${encodeURIComponent(project.organizationSlug)}/projects/${encodeURIComponent(project.slug)}/workspaces/${encodeURIComponent(item.id)}`,
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
