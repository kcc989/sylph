import { createFileRoute, Link } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
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
import { ArrowLeft, GitFork } from "lucide-react"
import { type FormEvent, useState } from "react"

import { createRepository, getDashboard } from "@/lib/workspaces"

export const Route = createFileRoute(
  "/organizations/$organizationId/repositories/new"
)({
  loader: () => getDashboard(),
  component: NewRepositoryScreen,
})

function NewRepositoryScreen() {
  const { organizationId } = Route.useParams()
  const dashboard = Route.useLoaderData()
  const provisionRepository = useServerFn(createRepository)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const organization = dashboard.organizations.find(
    (candidate) => candidate.id === organizationId
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    const form = new FormData(event.currentTarget)

    try {
      const created = await provisionRepository({
        data: {
          organizationId,
          name: String(form.get("name")),
        },
      })
      window.location.assign(`/workspaces/${encodeURIComponent(created.id)}`)
    } catch (error) {
      setPending(false)
      setMessage(error instanceof Error ? error.message : "Provisioning failed")
    }
  }

  return (
    <main className="min-h-svh bg-muted/30 px-5 py-10">
      <div className="mx-auto max-w-xl">
        <Link
          to="/organizations"
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Organizations
        </Link>
        <Card>
          <CardHeader>
            <div className="mb-2 grid size-9 place-items-center rounded-lg bg-muted">
              <GitFork className="size-4" />
            </div>
            <CardTitle>New repository</CardTitle>
            <CardDescription>
              {organization
                ? `Create a repository for ${organization.name}. Sylph creates and opens its workspace automatically.`
                : "Choose an organization you belong to before continuing."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.user && organization ? (
              <form className="grid gap-4" onSubmit={handleSubmit}>
                <div className="grid gap-2">
                  <Label htmlFor="name">Repository name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="customer-portal"
                    required
                  />
                </div>
                <Button type="submit" disabled={pending}>
                  Create repository
                </Button>
                {message ? (
                  <p className="text-sm text-destructive">{message}</p>
                ) : null}
              </form>
            ) : (
              <Button
                nativeButton={false}
                render={<Link to="/organizations" />}
              >
                Choose organization
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
