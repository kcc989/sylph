import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { ChevronRight, Plus, Settings2 } from "lucide-react"

import { AppShell } from "@/components/app-shell"
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
    <AppShell
      active="organizations"
      dashboard={dashboard}
      organizationSlug={organization.slug}
      topbar={organization.name}
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="flex items-center gap-4 border-b pb-6">
          <h1 className="min-w-0 flex-1 text-xl font-semibold tracking-[-0.03em]">
            {organization.name}
          </h1>
          <div className="flex items-center gap-2">
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
                          <a
                            href={`/organizations/${encodeURIComponent(organization.slug)}/projects/${encodeURIComponent(project.slug)}/settings`}
                          />
                        }
                      >
                        Settings
                      </Button>
                      <Button
                        nativeButton={false}
                        size="sm"
                        render={
                          <a
                            href={`/organizations/${encodeURIComponent(organization.slug)}/projects/${encodeURIComponent(project.slug)}/workspaces/new`}
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
                        <a
                          key={workspace.id}
                          href={`/organizations/${encodeURIComponent(organization.slug)}/projects/${encodeURIComponent(project.slug)}/workspaces/${encodeURIComponent(workspace.id)}`}
                          className="group flex min-h-11 items-center gap-3 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {workspace.title}
                          </span>
                          <span className="text-muted-foreground capitalize">
                            {workspace.status}
                          </span>
                          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </a>
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
    </AppShell>
  )
}
