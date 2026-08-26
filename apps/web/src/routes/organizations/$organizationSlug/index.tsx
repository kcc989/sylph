import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { ArrowLeft, ChevronRight, Plus, Settings2 } from "lucide-react"

import { getDashboard } from "@/lib/workspaces"

export const Route = createFileRoute("/organizations/$organizationSlug/")({
  loader: async ({ params }) => {
    const dashboard = await getDashboard()
    const organization =
      dashboard.organizations.find(
        (candidate) => candidate.slug === params.organizationSlug
      ) ?? null

    return { dashboard, organization }
  },
  component: OrganizationScreen,
})

function OrganizationScreen() {
  const { dashboard, organization } = Route.useLoaderData()

  if (!organization) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Organization unavailable</h1>
          <Button
            nativeButton={false}
            className="mt-5"
            render={<Link to="/organizations" />}
          >
            Return to Organizations
          </Button>
        </div>
      </main>
    )
  }

  const projects = dashboard.projects.filter(
    (project) => project.organizationId === organization.id
  )

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="flex h-12 items-center border-b px-4 sm:px-6">
        <Link
          to="/organizations"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Organizations
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Button
            nativeButton={false}
            size="sm"
            variant="ghost"
            render={
              <Link
                to="/organizations/$organizationSlug/settings"
                params={{ organizationSlug: organization.slug }}
              />
            }
          >
            <Settings2 /> Settings
          </Button>
          <Button
            nativeButton={false}
            size="sm"
            render={
              <Link
                to="/organizations/$organizationSlug/projects/new"
                params={{ organizationSlug: organization.slug }}
              />
            }
          >
            <Plus /> New Project
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="border-b pb-6">
          <h1 className="text-xl font-semibold tracking-[-0.03em]">
            {organization.name}
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Projects and Workspaces in this Organization.
          </p>
        </section>

        {projects.length ? (
          <section aria-label="Projects">
            {projects.map((project) => {
              const workspaces = dashboard.workspaces.filter(
                (workspace) => workspace.projectId === project.id
              )

              return (
                <div key={project.id} className="border-b py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-medium">
                        {project.name}
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {workspaces.length === 1
                          ? "1 Workspace"
                          : `${workspaces.length} Workspaces`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        nativeButton={false}
                        size="sm"
                        variant="ghost"
                        render={
                          <Link
                            to="/projects/$projectId/settings"
                            params={{ projectId: project.id }}
                          />
                        }
                      >
                        Settings
                      </Button>
                      <Button
                        nativeButton={false}
                        size="sm"
                        render={
                          <Link
                            to="/projects/$projectId/workspaces/new"
                            params={{ projectId: project.id }}
                          />
                        }
                      >
                        <Plus /> New Workspace
                      </Button>
                    </div>
                  </div>
                  {workspaces.length ? (
                    <div className="mt-3 divide-y border-t">
                      {workspaces.map((workspace) => (
                        <Link
                          key={workspace.id}
                          to="/workspaces/$workspaceId"
                          params={{ workspaceId: workspace.id }}
                          className="group flex min-h-11 items-center gap-3 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {workspace.title}
                          </span>
                          <span className="text-muted-foreground capitalize">
                            {workspace.status}
                          </span>
                          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </section>
        ) : (
          <section className="border-b py-8">
            <p className="text-sm text-muted-foreground">
              This Organization does not have any Projects yet.
            </p>
            <Button
              nativeButton={false}
              className="mt-5"
              render={
                <Link
                  to="/organizations/$organizationSlug/projects/new"
                  params={{ organizationSlug: organization.slug }}
                />
              }
            >
              <Plus /> Create the first Project
            </Button>
          </section>
        )}
      </div>
    </main>
  )
}
