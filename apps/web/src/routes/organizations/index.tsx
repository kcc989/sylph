import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { ArrowRight, Boxes, Building2, Plus } from "lucide-react"

import { getDashboard } from "@/lib/workspaces"

export const Route = createFileRoute("/organizations/")({
  loader: () => getDashboard(),
  component: OrganizationsScreen,
})

function OrganizationsScreen() {
  const dashboard = Route.useLoaderData()

  return (
    <main className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="size-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">Organizations</h1>
              <p className="text-xs text-muted-foreground">
                Your Better Auth organization memberships
              </p>
            </div>
          </Link>
          <Link
            to="/"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Workspace lab
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Your organizations</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose an organization to create a Project and its first
              Workspace.
            </p>
          </div>
          {dashboard.user ? (
            <Button
              nativeButton={false}
              render={<Link to="/organizations/new" />}
            >
              <Plus /> New organization
            </Button>
          ) : null}
        </div>

        {!dashboard.user ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Building2 className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Sign in before viewing your organizations.
              </p>
              <Button nativeButton={false} render={<Link to="/" />}>
                Return to sign in
              </Button>
            </CardContent>
          </Card>
        ) : dashboard.organizations.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {dashboard.organizations.map((organization) => (
              <Card key={organization.id}>
                <CardHeader>
                  <div className="mb-2 grid size-9 place-items-center rounded-lg bg-muted">
                    <Building2 className="size-4" />
                  </div>
                  <CardTitle>{organization.name}</CardTitle>
                  <CardDescription>{organization.slug}</CardDescription>
                </CardHeader>
                <CardContent>
                  <a
                    href={`/organizations/${encodeURIComponent(organization.id)}/projects/new`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    New project <ArrowRight className="size-4" />
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Building2 className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                You do not belong to an organization yet.
              </p>
              <Button
                nativeButton={false}
                render={<Link to="/organizations/new" />}
              >
                <Plus /> Create your first organization
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
