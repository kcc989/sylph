import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { ArrowLeft, CircleDot, GitFork, TerminalSquare } from "lucide-react"

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

  return (
    <main className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Workspaces
          </Link>
          {workspace ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CircleDot className="size-3.5" /> {workspace.status}
            </span>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8">
        {workspace ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
            <Card>
              <CardHeader>
                <div className="mb-2 grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <TerminalSquare className="size-4" />
                </div>
                <CardTitle>{workspace.title}</CardTitle>
                <CardDescription>
                  OpenCode v2 runs durably inside this workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-dashed p-10 text-center">
                  <p className="text-sm font-medium">Workspace ready</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Agent actions and future sessions stay scoped to this
                    workspace.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GitFork className="size-4" /> Repository
                </CardTitle>
                <CardDescription>{workspace.repositoryName}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Runtime</dt>
                    <dd className="font-medium">OpenCode v2</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>
        ) : (
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
        )}
      </div>
    </main>
  )
}
