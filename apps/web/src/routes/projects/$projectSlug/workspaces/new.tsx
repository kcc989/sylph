import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { failureMessage } from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import { LoaderCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { AppShell } from "@/components/app-shell"
import { getDashboard } from "@/functions/installation"
import { createWorkspace } from "@/functions/workspaces"

type WorkspaceCreationSearch = {
  key?: string
}

const validateWorkspaceCreationSearch = (
  search: WorkspaceCreationSearch
): WorkspaceCreationSearch =>
  search.key && search.key.length > 0 ? { key: search.key } : {}

export const Route = createFileRoute("/projects/$projectSlug/workspaces/new")({
  validateSearch: validateWorkspaceCreationSearch,
  beforeLoad: ({ params, search }) => {
    if (search.key) return
    throw redirect({
      params,
      replace: true,
      search: { key: crypto.randomUUID() },
      to: "/projects/$projectSlug/workspaces/new",
    })
  },
  loader: () => getDashboard(),
  component: CreateWorkspaceScreen,
})

function CreateWorkspaceScreen() {
  const dashboard = Route.useLoaderData()
  const { projectSlug } = Route.useParams()
  const { key } = Route.useSearch()
  const create = useServerFn(createWorkspace)
  const router = useRouter()
  const started = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [retryKey] = useState(() => crypto.randomUUID())
  const project = dashboard.projects.find(
    (candidate) => candidate.slug === projectSlug
  )

  useEffect(() => {
    if (!project || !key || started.current) return
    started.current = true

    void create({ data: { idempotencyKey: key, projectId: project.id } })
      .then((workspace) =>
        router.navigate({
          replace: true,
          to: "/projects/$projectSlug/workspaces/$workspaceId",
          params: { projectSlug, workspaceId: workspace.id },
        })
      )
      .catch((cause) =>
        setError(failureMessage(cause, "The Workspace could not be created"))
      )
  }, [create, key, project, projectSlug, router])

  return (
    <AppShell active="home" dashboard={dashboard} topbar="Creating Workspace">
      <div className="grid min-h-full place-items-center px-5 py-12">
        <div className="max-w-md text-center">
          {error ? null : (
            <LoaderCircle className="mx-auto size-5 animate-spin text-[var(--sylph-coral)] motion-reduce:animate-none" />
          )}
          <h1 className="mt-4 text-lg font-semibold">
            {project ? "Creating Workspace" : "Project unavailable"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {error ??
              (project
                ? `Preparing an isolated Workspace for ${project.name}.`
                : "This Project does not exist or you cannot access it.")}
          </p>
          {error && project ? (
            <Button
              className="mt-5"
              nativeButton={false}
              render={
                <Link
                  params={{ projectSlug }}
                  search={{ key: retryKey }}
                  to="/projects/$projectSlug/workspaces/new"
                />
              }
            >
              Try again
            </Button>
          ) : null}
          {!project ? (
            <Button
              className="mt-5"
              nativeButton={false}
              render={<Link to="/" />}
            >
              Return to Projects
            </Button>
          ) : null}
        </div>
      </div>
    </AppShell>
  )
}
