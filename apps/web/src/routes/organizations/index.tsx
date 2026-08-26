import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { ArrowRight, Plus, Settings2 } from "lucide-react"

import { AppShell } from "@/components/app-shell"
import { getDashboard } from "@/lib/workspaces"

export const Route = createFileRoute("/organizations/")({
  loader: () => getDashboard(),
  component: OrganizationsScreen,
})

function OrganizationsScreen() {
  const dashboard = Route.useLoaderData()

  return (
    <AppShell
      active="organizations"
      dashboard={dashboard}
      topbar="Organizations"
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="flex items-center gap-4 border-b pb-6">
          <h1 className="min-w-0 flex-1 text-xl font-semibold tracking-[-0.03em]">
            Organizations
          </h1>
          {dashboard.user ? (
            <Button
              nativeButton={false}
              size="sm"
              render={<Link to="/organizations/new" />}
            >
              <Plus /> New organization
            </Button>
          ) : null}
        </section>
        {!dashboard.user ? (
          <section className="border-b py-8">
            <p className="text-sm text-muted-foreground">
              Sign in before viewing your Organizations.
            </p>
            <Button
              nativeButton={false}
              className="mt-5"
              render={<Link to="/" />}
            >
              Return to sign in
            </Button>
          </section>
        ) : dashboard.organizations.length ? (
          <section aria-label="Organizations">
            {dashboard.organizations.map((organization) => (
              <div
                key={organization.id}
                className="flex flex-col gap-4 border-b py-5 sm:flex-row sm:items-center"
              >
                <Link
                  to="/organizations/$organizationSlug"
                  params={{ organizationSlug: organization.slug }}
                  className="group flex min-w-0 flex-1 items-center gap-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="truncate">{organization.name}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </Link>
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
                    New Project <ArrowRight />
                  </Button>
                </div>
              </div>
            ))}
          </section>
        ) : (
          <section className="border-b py-8">
            <p className="text-sm text-muted-foreground">
              You do not belong to an Organization yet.
            </p>
            <Button
              nativeButton={false}
              className="mt-5"
              render={<Link to="/organizations/new" />}
            >
              <Plus /> Create your first organization
            </Button>
          </section>
        )}
      </div>
    </AppShell>
  )
}
