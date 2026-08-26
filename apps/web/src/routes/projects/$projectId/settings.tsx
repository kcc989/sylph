import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  ArrowLeft,
  Bot,
  FolderGit2,
  GitBranch,
  Plus,
  Settings2,
} from "lucide-react"

import { getWorkspaceCreationContext } from "@/lib/workspaces"

export const Route = createFileRoute("/projects/$projectId/settings")({
  loader: ({ params }) =>
    getWorkspaceCreationContext({ data: { projectId: params.projectId } }),
  component: ProjectSettingsScreen,
})

function ProjectSettingsScreen() {
  const { projectId } = Route.useParams()
  const context = Route.useLoaderData()

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
    <main className="min-h-svh bg-background text-foreground">
      <header className="flex h-12 items-center border-b px-4 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Projects
        </Link>
        <span className="mx-2 text-muted-foreground/40">/</span>
        <span className="truncate text-xs font-medium">
          {context.project.name}
        </span>
        <Button
          nativeButton={false}
          className="ml-auto"
          size="sm"
          render={
            <a
              href={`/projects/${encodeURIComponent(projectId)}/workspaces/new`}
            />
          }
        >
          <Plus /> New Workspace
        </Button>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
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
              OpenCode
            </div>
            <div>
              <p className="font-mono text-xs">
                {context.setup.providerId && context.setup.modelId
                  ? `${context.setup.providerId}/${context.setup.modelId}`
                  : "Not connected"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                OpenCode belongs to the Organization and is reused by every
                Project and Workspace it contains.
              </p>
              <a
                href={`/organizations/${encodeURIComponent(context.project.organizationSlug)}/settings`}
                className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
              >
                Organization OpenCode settings
              </a>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
