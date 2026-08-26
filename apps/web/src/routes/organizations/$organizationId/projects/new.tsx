import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
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
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  KeyRound,
  LoaderCircle,
} from "lucide-react"
import { type FormEvent, useState } from "react"

import { createProject, getOpenCodeSetup } from "@/lib/workspaces"

export const Route = createFileRoute(
  "/organizations/$organizationId/projects/new"
)({
  loader: ({ params }) =>
    getOpenCodeSetup({ data: { organizationId: params.organizationId } }),
  component: NewProjectScreen,
})

function NewProjectScreen() {
  const { organizationId } = Route.useParams()
  const navigate = useNavigate()
  const setup = Route.useLoaderData()
  const create = useServerFn(createProject)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        to: "/workspaces/$workspaceId",
        params: { workspaceId: result.id },
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
    <main className="grid min-h-svh place-items-center bg-muted/30 px-5 py-10">
      <div className="w-full max-w-lg">
        <Link
          to="/organizations"
          className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Organizations
        </Link>
        {needsSetup ? (
          <Card>
            <CardHeader>
              <div className="mb-2 grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
                <KeyRound className="size-4" />
              </div>
              <CardTitle>Connect an AI provider</CardTitle>
              <CardDescription>
                This Organization needs at least one Provider connection before
                its members can create Projects and durable Workspaces.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                nativeButton={false}
                className="w-full"
                render={
                  <Link
                    to="/organizations/$organizationId/settings"
                    params={{ organizationId }}
                  />
                }
              >
                Open Organization settings <ArrowRight />
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="mb-2 grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Boxes className="size-4" />
              </div>
              <CardTitle>Create a project</CardTitle>
              <CardDescription>
                Sylph creates its Repository, durable Workspace, starter files,
                and first OpenCode v2 session in one step.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-5" onSubmit={handleSubmit}>
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
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
                        to="/organizations/$organizationId/settings"
                        params={{ organizationId }}
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
                    <Boxes />
                  )}
                  {pending ? "Starting OpenCode…" : "Create project"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
