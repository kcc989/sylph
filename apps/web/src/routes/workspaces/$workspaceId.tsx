import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  type ThreadEntry,
  WorkspaceShell,
} from "@workspace/ui/components/workspace-shell"
import { useEffect, useState } from "react"

import { getWorkspace, promptWorkspace } from "@/lib/workspaces"

export const Route = createFileRoute("/workspaces/$workspaceId")({
  loader: ({ params }) =>
    getWorkspace({ data: { workspaceId: params.workspaceId } }),
  component: WorkspaceScreen,
})

function WorkspaceScreen() {
  const { workspaceId } = Route.useParams()
  const result = Route.useLoaderData()
  const router = useRouter()
  const prompt = useServerFn(promptWorkspace)
  const [promptPending, setPromptPending] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)

  useEffect(() => {
    if (!result || result.runtime.status !== "running") return
    const poll = window.setInterval(() => router.invalidate(), 1_500)
    return () => window.clearInterval(poll)
  }, [result, router])

  if (!result) {
    return (
      <main className="grid min-h-svh place-items-center bg-muted/30 px-5">
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
  const entries: ThreadEntry[] = runtime.messages.length
    ? runtime.messages.map((message) => ({
        id: message.id,
        kind: message.role === "user" ? "user" : "agent",
        title: message.error ? "OpenCode error" : undefined,
        body: message.error ?? message.text,
        meta: message.role === "user" ? "You" : "OpenCode v2",
        details: message.tools.length ? [...message.tools] : undefined,
      }))
    : [
        {
          id: "workspace-ready",
          kind: "result",
          title: "Your durable coding Workspace is ready",
          body: "Ask OpenCode to build the first feature. Source edits persist in this Durable Object while process-heavy checks stay in Cloudflare CI.",
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
        title:
          "A Cloudflare CI preview will appear after the first checkpoint.",
        status: "loading",
      }}
      changedFileCount={0}
      changeSummary="No checkpoint diff"
      checks={[
        {
          name: "OpenCode v2 host",
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
              : "OpenCode could not start the turn"
          )
        } finally {
          setPromptPending(false)
        }
      }}
      projects={[
        {
          id: workspace.projectId,
          name: workspace.projectName,
          repositoryName: workspace.repositoryName,
          workspaces: [
            {
              id: workspace.id,
              name: workspace.title,
              branch: workspace.defaultBranch,
              status:
                runtime.status === "error"
                  ? "error"
                  : runtime.status === "running"
                    ? "running"
                    : runtime.status === "ready"
                      ? "ready"
                      : "waiting",
            },
          ],
        },
      ]}
      promptDisabled={
        runtime.status === "provisioning" || runtime.status === "error"
      }
      promptError={promptError}
      promptPending={promptPending}
    />
  )
}
