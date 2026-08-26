import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  FolderGit2,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
} from "lucide-react"
import { type FormEvent, useState } from "react"

import { createWorkspace, getWorkspaceCreationContext } from "@/lib/workspaces"

export const Route = createFileRoute("/projects/$projectId/workspaces/new")({
  loader: ({ params }) =>
    getWorkspaceCreationContext({ data: { projectId: params.projectId } }),
  component: NewWorkspaceScreen,
})

function NewWorkspaceScreen() {
  const { projectId } = Route.useParams()
  const context = Route.useLoaderData()
  const navigate = useNavigate()
  const create = useServerFn(createWorkspace)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!context) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <div className="max-w-sm text-center">
          <FolderGit2 className="mx-auto size-7 text-muted-foreground" />
          <h1 className="mt-4 text-lg font-semibold">Project unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This Project does not exist or you cannot create a Workspace in it.
          </p>
          <Button
            nativeButton={false}
            className="mt-5"
            render={<Link to="/" />}
          >
            Return to Projects
          </Button>
        </div>
      </main>
    )
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(event.currentTarget)

    try {
      const result = await create({
        data: { projectId, title: String(form.get("title")) },
      })
      await navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: result.id },
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The Workspace could not be created"
      )
      setPending(false)
    }
  }

  const needsSetup = !context.setup.providerId

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="flex h-12 items-center border-b px-4 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Projects
        </Link>
        <span className="mx-2 text-muted-foreground/40">/</span>
        <span className="truncate text-xs font-medium">
          {context.project.name}
        </span>
      </header>

      <div className="mx-auto grid min-h-[calc(100svh-3rem)] max-w-5xl lg:grid-cols-[0.72fr_1.28fr]">
        <aside className="border-b px-6 py-8 lg:border-r lg:border-b-0 lg:px-8 lg:py-12">
          <div className="flex items-center gap-2.5">
            <FolderGit2 className="size-4 text-[#ef9b7e]" />
            <h1 className="text-sm font-semibold">{context.project.name}</h1>
          </div>
          <p className="mt-3 pl-6 font-mono text-[10px] text-muted-foreground">
            Repository · {context.project.repositoryName}
          </p>
          <p className="mt-1 pl-6 font-mono text-[10px] text-muted-foreground">
            Base branch · {context.project.defaultBranch}
          </p>
          <div className="mt-9 grid gap-4 border-t pt-6 text-xs text-muted-foreground">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-live" />
              <p className="leading-5">
                The Project’s Repository remains canonical. This Workspace gets
                its own durable fork.
              </p>
            </div>
            <div className="flex gap-3">
              <Bot className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="leading-5">
                OpenCode starts in a new session with the selected model and
                isolated working files.
              </p>
            </div>
          </div>
        </aside>

        <section className="flex items-start justify-center px-6 py-8 lg:px-12 lg:py-12">
          <div className="w-full max-w-lg">
            {needsSetup ? (
              <div>
                <div className="grid size-9 place-items-center rounded-[7px] bg-[#ef9b7e]/12 text-[#f2a68d]">
                  <KeyRound className="size-4" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">
                  Connect an AI provider
                </h2>
                <p className="mt-2 max-w-[58ch] text-sm leading-6 text-muted-foreground">
                  This Organization needs at least one Provider connection
                  before any of its Projects can start a durable Workspace.
                </p>
                <Button
                  nativeButton={false}
                  className="mt-8"
                  render={
                    <Link
                      to="/organizations/$organizationSlug/settings"
                      params={{
                        organizationSlug: context.project.organizationSlug,
                      }}
                    />
                  }
                >
                  Open Organization settings <ArrowRight />
                </Button>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                  Start a new Workspace
                </h2>
                <p className="mt-2 max-w-[58ch] text-sm leading-6 text-muted-foreground">
                  Name the work you are starting. Sylph will fork the contained
                  Repository and open a durable OpenCode session.
                </p>
                <form className="mt-8 grid gap-6" onSubmit={handleCreate}>
                  <div className="flex items-center justify-between border-y py-3">
                    <div>
                      <p className="text-xs font-medium">Default provider</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {context.setup.providerId}/{context.setup.modelId}
                      </p>
                    </div>
                    <Button
                      nativeButton={false}
                      size="sm"
                      variant="ghost"
                      render={
                        <Link
                          to="/organizations/$organizationSlug/settings"
                          params={{
                            organizationSlug: context.project.organizationSlug,
                          }}
                        />
                      }
                    >
                      Change
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="title">Workspace name</Label>
                    <Input
                      id="title"
                      name="title"
                      placeholder="Add billing"
                      autoFocus
                      required
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      Use the feature, fix, or experiment this Workspace will
                      contain.
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
                      <Plus />
                    )}
                    {pending ? "Starting Workspace…" : "Start Workspace"}
                  </Button>
                </form>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
