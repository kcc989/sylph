import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { WorkspaceShell } from "@workspace/ui/components/workspace-shell"

import { getDashboard } from "@/lib/workspaces"

export const Route = createFileRoute("/workspaces/$workspaceId")({
  loader: () => getDashboard(),
  component: WorkspaceScreen,
})

function WorkspaceScreen() {
  const { workspaceId } = Route.useParams()
  const dashboard = Route.useLoaderData()
  const workspace = dashboard.workspaces.find(
    (candidate) => candidate.id === workspaceId
  )

  return workspace ? (
    <WorkspaceShell
      organization="Sylph"
      browser={{
        url: "about:blank",
        title: "Start a preview server to connect the browser.",
        status: "loading",
      }}
      changedFileCount={0}
      changeSummary="No changes"
      checks={[]}
      entries={[
        {
          id: "workspace-ready",
          kind: "result",
          title: "Workspace ready",
          body: "This durable workspace is connected. Start a task to create the first agent turn.",
          meta: workspace.status,
        },
      ]}
      repositoryName={workspace.repositoryName}
      workspaceName={workspace.title}
      repositories={[
        {
          id: workspace.repositoryName,
          name: workspace.repositoryName,
          workspaces: [
            {
              id: workspace.id,
              name: workspace.title,
              branch: "main",
              status:
                workspace.status === "error"
                  ? "error"
                  : workspace.status === "ready"
                    ? "ready"
                    : "waiting",
            },
          ],
        },
      ]}
    />
  ) : (
    <main className="grid min-h-svh place-items-center bg-muted/30 px-5">
      <div className="w-full max-w-lg">
        <Card>
          <CardContent className="grid justify-items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              This workspace does not exist or you cannot access it.
            </p>
            <Button nativeButton={false} render={<Link to="/" />}>
              Return to workspaces
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
