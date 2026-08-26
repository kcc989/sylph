import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ArrowLeft, Building2 } from "lucide-react"
import { type FormEvent, useState } from "react"

import { authClient } from "@/lib/auth-client"
import { getDashboard } from "@/lib/workspaces"

export const Route = createFileRoute("/organizations/new")({
  loader: () => getDashboard(),
  component: NewOrganizationScreen,
})

function NewOrganizationScreen() {
  const dashboard = Route.useLoaderData()
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

    window.location.assign(
      `/organizations/${encodeURIComponent(result.data.id)}/projects/new`
    )
  }

  return (
    <main className="min-h-svh bg-muted/30 px-5 py-10">
      <div className="mx-auto max-w-lg">
        <Link
          to="/organizations"
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Organizations
        </Link>
        <Card>
          <CardHeader>
            <div className="mb-2 grid size-9 place-items-center rounded-lg bg-muted">
              <Building2 className="size-4" />
            </div>
            <CardTitle>New organization</CardTitle>
            <CardDescription>
              Create a shared boundary for projects and workspaces.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.user ? (
              <form className="grid gap-4" onSubmit={handleSubmit}>
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
                </div>
                <Button type="submit" disabled={pending}>
                  Create organization
                </Button>
                {message ? (
                  <p className="text-sm text-destructive">{message}</p>
                ) : null}
              </form>
            ) : (
              <div className="text-sm text-muted-foreground">
                Sign in before creating an organization.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
