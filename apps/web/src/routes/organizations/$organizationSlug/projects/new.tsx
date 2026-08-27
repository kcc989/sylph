import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react"
import { type FormEvent, useState } from "react"

import { AppShell } from "@/components/app-shell"
import { createProject, getDashboard, getOpenCodeSetup } from "@/lib/workspaces"

export const Route = createFileRoute(
  "/organizations/$organizationSlug/projects/new"
)({
  loader: async ({ params }) => {
    const dashboard = await getDashboard()
    const organization =
      dashboard.organizations.find(
        (candidate) => candidate.slug === params.organizationSlug
      ) ?? null
    const setup = organization
      ? await getOpenCodeSetup({ data: { organizationId: organization.id } })
      : null

    return { dashboard, organization, setup }
  },
  component: NewProjectScreen,
})

function NewProjectScreen() {
  const navigate = useNavigate()
  const { dashboard, organization, setup } = Route.useLoaderData()
  const create = useServerFn(createProject)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const organizationId = organization.id

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(event.currentTarget)

    try {
      const result = await create({
        data: {
          organizationId,
          name: String(form.get("name")),
        },
      })
      await navigate({
        to: "/organizations/$organizationSlug/projects/$projectSlug/workspaces/$workspaceId",
        params: {
          organizationSlug: result.organizationSlug,
          projectSlug: result.projectSlug,
          workspaceId: result.id,
        },
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The project could not be created"
      )
      setPending(false)
    }
  }

  const needsSetup = !setup?.providerId

  return (
    <AppShell
      active="home"
      dashboard={dashboard}
      organizationSlug={organization.slug}
      topbar="New project"
    >
      <main className="px-5 py-10">
        <div className="mx-auto w-full max-w-xl">
          <Link
            to="/organizations"
            className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Organizations
          </Link>
          {needsSetup ? (
            <section className="border-y py-8">
              <h1 className="text-xl font-semibold tracking-[-0.03em]">
                Connect an AI provider
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Connect an AI provider for this Organization before creating a
                Project.
              </p>
              <Button
                nativeButton={false}
                className="mt-6"
                render={
                  <Link
                    to="/organizations/$organizationSlug/settings"
                    params={{ organizationSlug: organization.slug }}
                  />
                }
              >
                Open Organization settings <ArrowRight />
              </Button>
            </section>
          ) : (
            <section className="border-y py-8">
              <h1 className="text-xl font-semibold tracking-[-0.03em]">
                Create a project
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Sylph creates its Repository, first Workspace, and starter files
                in one step.
              </p>
              <form className="mt-7 grid gap-5" onSubmit={handleSubmit}>
                <div className="flex items-center justify-between border-y py-3">
                  <div>
                    <p className="text-sm font-medium">Default provider</p>
                    <p className="text-xs text-muted-foreground">
                      {setup.providerId}/{setup.modelId}
                    </p>
                  </div>
                  <Button
                    nativeButton={false}
                    variant="ghost"
                    size="sm"
                    render={
                      <Link
                        to="/organizations/$organizationSlug/settings"
                        params={{ organizationSlug: organization.slug }}
                      />
                    }
                  >
                    Change
                  </Button>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="name">Project name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Weather desk"
                    autoFocus
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    The contained Repository and initial Workspace use this
                    name.
                  </p>
                </div>
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ArrowRight />
                  )}
                  {pending ? "Creating Project…" : "Create project"}
                </Button>
              </form>
            </section>
          )}
        </div>
      </main>
    </AppShell>
  )
}
