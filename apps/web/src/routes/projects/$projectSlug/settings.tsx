import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Bot, FolderGit2, GitBranch, Plus, Settings2 } from "lucide-react"

import { AppShell } from "@/components/app-shell"
import { getDashboard, getWorkspaceCreationContext } from "@/lib/workspaces"

export const Route = createFileRoute("/projects/$projectSlug/settings")({
  loader: async ({ params }) => {
    const dashboard = await getDashboard()
    const project = dashboard.projects.find(
      (candidate) => candidate.slug === params.projectSlug
    )
    const context = project
      ? await getWorkspaceCreationContext({ data: { projectId: project.id } })
      : null
    return { context, dashboard }
  },
  component: ProjectSettingsScreen,
})

function ProjectSettingsScreen() {
  const { projectSlug } = Route.useParams()
  const { context, dashboard } = Route.useLoaderData()

  if (!context) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Project unavailable</h1>
          <Button
            nativeButton={false}
            className="mt-5"
            render={<Link to="/" />}
          >
            Return to Projects
          </Button>
        </div>
      </main>
    )
  }

  return (
    <AppShell active="home" dashboard={dashboard} topbar={context.project.name}>
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <Button
          nativeButton={false}
          className="ml-auto"
          size="sm"
          render={
            <a
              href={`/projects/${encodeURIComponent(projectSlug)}/workspaces/new`}
            />
          }
        >
          <Plus /> New Workspace
        </Button>
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-[7px] bg-white/[.05] text-muted-foreground">
            <Settings2 className="size-4" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">
              Project settings
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {context.project.name}
            </p>
          </div>
        </div>

        <section className="mt-10 border-t">
          <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 text-xs font-medium">
              <FolderGit2 className="size-3.5 text-[#ef9b7e]" /> Repository
            </div>
            <div>
              <p className="font-mono text-xs">
                {context.project.repositoryName}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                This is the canonical Repository contained by the Project. Each
                Workspace receives an isolated fork.
              </p>
            </div>
          </div>
          <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 text-xs font-medium">
              <GitBranch className="size-3.5 text-muted-foreground" /> Default
              branch
            </div>
            <p className="font-mono text-xs">{context.project.defaultBranch}</p>
          </div>
          <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Bot className="size-3.5 text-primary" />
              AI provider
            </div>
            <div>
              <p className="font-mono text-xs">
                {context.setup.providerId && context.setup.modelId
                  ? `${context.setup.providerId}/${context.setup.modelId}`
                  : "Not connected"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                This connection is shared by every Project and Workspace in the
                Organization.
              </p>
              <a
                href="/admin"
                className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
              >
                Organization provider settings
              </a>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
