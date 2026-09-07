import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router"
import { failureMessage } from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"

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
  preloadStaleTime: 0,
  beforeLoad: ({ params, search, preload }) => {
    if (preload || search.key) return
    throw redirect({
      params,
      replace: true,
      search: { key: crypto.randomUUID() },
      to: "/projects/$projectSlug/workspaces/new",
    })
  },
  loaderDeps: ({ search }) => ({ key: search.key }),
  loader: async ({ params, deps, preload }) => {
    if (preload || !deps.key) return
    const dashboard = await getDashboard()
    const project = dashboard.projects.find(
      (candidate) => candidate.slug === params.projectSlug
    )
    if (!project) throw notFound()
    const workspace = await createWorkspace({
      data: { idempotencyKey: deps.key, projectId: project.id },
    })
    throw redirect({
      replace: true,
      to: "/projects/$projectSlug/workspaces/$workspaceId",
      params: { projectSlug: params.projectSlug, workspaceId: workspace.id },
    })
  },
  errorComponent: WorkspaceCreationError,
})

function WorkspaceCreationError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()

  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">
          Workspace could not be created
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {failureMessage(error, "Try again to open the Workspace.")}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button
            onClick={async () => {
              reset()
              await router.invalidate()
            }}
          >
            Try again
          </Button>
          <Button
            nativeButton={false}
            render={<Link to="/" />}
            variant="outline"
          >
            Return to Projects
          </Button>
        </div>
      </div>
    </main>
  )
}
