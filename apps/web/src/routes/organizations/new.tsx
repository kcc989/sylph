import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react"
import { type FormEvent, useState } from "react"

import { authClient } from "@/lib/auth-client"
import { AppShell } from "@/components/app-shell"
import { validateOnboardingSearch } from "@/lib/onboarding"
import { getDashboard } from "@/lib/workspaces"

export const Route = createFileRoute("/organizations/new")({
  validateSearch: validateOnboardingSearch,
  loader: () => getDashboard(),
  component: NewOrganizationScreen,
})

function NewOrganizationScreen() {
  const dashboard = Route.useLoaderData()
  const { onboarding } = Route.useSearch()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    const form = new FormData(event.currentTarget)
    const result = await authClient.organization.create({
      name: String(form.get("name")),
      slug: String(form.get("slug")),
    })

    if (result.error) {
      setPending(false)
      setMessage(result.error.message ?? "Organization creation failed")
      return
    }

    const activeOrganization = await authClient.organization.setActive({
      organizationId: result.data.id,
    })

    if (activeOrganization.error) {
      setPending(false)
      setMessage(
        activeOrganization.error.message ??
          "Organization created, but could not be activated"
      )
      return
    }

    const organizationPath = `/organizations/${encodeURIComponent(result.data.slug)}`
    window.location.assign(
      onboarding
        ? `${organizationPath}/settings?onboarding=1`
        : `${organizationPath}/projects/new`
    )
  }

  return (
    <AppShell
      active="organizations"
      dashboard={dashboard}
      topbar="New organization"
    >
      <main className="px-5 py-10">
        <div className="mx-auto w-full max-w-xl">
          <Link
            to="/organizations"
            className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Organizations
          </Link>
          <section className="border-y py-8">
            <h1 className="text-xl font-semibold tracking-[-0.03em]">
              New organization
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Create a shared boundary for Projects, Workspaces, and AI provider
              connections.
            </p>
            {dashboard.user ? (
              <form className="mt-7 grid gap-5" onSubmit={handleSubmit}>
                <div className="grid gap-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Acme Labs"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="slug">Slug</Label>
                  <Input
                    id="slug"
                    name="slug"
                    placeholder="acme-labs"
                    pattern="[a-z0-9-]+"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Used in Organization URLs.
                  </p>
                </div>
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ArrowRight />
                  )}
                  Create organization
                </Button>
                {message ? (
                  <p role="alert" className="text-sm text-destructive">
                    {message}
                  </p>
                ) : null}
              </form>
            ) : (
              <p className="mt-7 text-sm text-muted-foreground">
                Sign in before creating an Organization.
              </p>
            )}
          </section>
        </div>
      </main>
    </AppShell>
  )
}
