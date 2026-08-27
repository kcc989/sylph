import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { ArrowRight, Plus, Settings2 } from "lucide-react"

import { AppShell } from "@/components/app-shell"
import { getDashboard } from "@/lib/workspaces"

export const Route = createFileRoute("/settings")({
  loader: () => getDashboard(),
  component: UserSettingsScreen,
})

function UserSettingsScreen() {
  const dashboard = Route.useLoaderData()

  return (
    <AppShell active="settings" dashboard={dashboard} topbar="User settings">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="border-b pb-6">
          <h1 className="text-xl font-semibold tracking-[-0.03em]">
            User settings
          </h1>
          {dashboard.user ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              {dashboard.user.email}
            </p>
          ) : null}
        </section>
        <section className="py-6">
          <div className="flex items-center gap-4">
            <h2 className="min-w-0 flex-1 text-sm font-semibold">
              Organizations
            </h2>
            <Button
              nativeButton={false}
              size="sm"
              variant="ghost"
              render={<Link to="/organizations/new" />}
            >
              <Plus /> New organization
            </Button>
          </div>
          <div className="mt-3 divide-y border-y">
            {dashboard.organizations.map((organization) => (
              <div
                key={organization.id}
                className="flex items-center gap-2 py-3"
              >
                <Link
                  to="/organizations/$organizationSlug"
                  params={{ organizationSlug: organization.slug }}
                  className="group flex min-w-0 flex-1 items-center gap-2 text-sm font-medium"
                >
                  <span className="truncate">{organization.name}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Button
                  nativeButton={false}
                  aria-label={`${organization.name} settings`}
                  size="icon-sm"
                  variant="ghost"
                  render={
                    <Link
                      to="/organizations/$organizationSlug/settings"
                      params={{ organizationSlug: organization.slug }}
                    />
                  }
                >
                  <Settings2 />
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
