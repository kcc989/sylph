import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { failureMessage } from "@workspace/domain"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Markdown } from "@workspace/ui/components/markdown"
import { ArrowLeft, Check, LoaderCircle, RotateCcw } from "lucide-react"
import { useState } from "react"

import { AppShell } from "@/components/app-shell"
import { getDashboard } from "@/functions/installation"
import { getIssue, updateIssueStatus } from "@/functions/issues"

export const Route = createFileRoute(
  "/projects/$projectSlug/issues/$issueNumber"
)({
  loader: async ({ params }) => {
    const number = Number(params.issueNumber)
    if (!Number.isInteger(number) || number < 1) throw notFound()
    const dashboard = await getDashboard()
    const project = dashboard.projects.find(
      (candidate) => candidate.slug === params.projectSlug
    )
    if (!project) throw notFound()
    const issue = await getIssue({ data: { projectId: project.id, number } })
    if (!issue) throw notFound()
    return { dashboard, issue, project }
  },
  component: IssueScreen,
})

function IssueScreen() {
  const { projectSlug } = Route.useParams()
  const { dashboard, issue, project } = Route.useLoaderData()
  const router = useRouter()
  const updateStatus = useServerFn(updateIssueStatus)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextStatus = issue.status === "open" ? "closed" : "open"

  const changeStatus = async () => {
    setPending(true)
    setError(null)
    try {
      await updateStatus({ data: { issueId: issue.id, status: nextStatus } })
      await router.invalidate()
    } catch (cause) {
      setError(failureMessage(cause, "The Issue status could not be updated"))
    } finally {
      setPending(false)
    }
  }

  return (
    <AppShell
      active="home"
      dashboard={dashboard}
      topbar={`${project.name} · Issue #${issue.number}`}
    >
      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <Link
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          params={{ projectSlug }}
          to="/projects/$projectSlug/issues"
        >
          <ArrowLeft className="size-3.5" /> Issues
        </Link>
        <article className="mt-5 border-y py-7">
          <header className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  #{issue.number}
                </span>
                <Badge
                  variant="outline"
                  className="rounded-[4px] text-[10px] capitalize"
                >
                  {issue.status}
                </Badge>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-balance">
                {issue.title}
              </h1>
            </div>
            <Button
              disabled={pending}
              onClick={() => void changeStatus()}
              size="sm"
              variant="outline"
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : nextStatus === "closed" ? (
                <Check />
              ) : (
                <RotateCcw />
              )}
              {pending
                ? "Updating…"
                : nextStatus === "closed"
                  ? "Close Issue"
                  : "Reopen Issue"}
            </Button>
          </header>
          <div className="mt-8 border-t pt-7">
            {issue.body ? (
              <Markdown>{issue.body}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">No description.</p>
            )}
          </div>
          {error ? (
            <p role="alert" className="mt-5 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </article>
      </main>
    </AppShell>
  )
}
