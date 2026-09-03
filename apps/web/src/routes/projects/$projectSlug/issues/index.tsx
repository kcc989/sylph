import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
} from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { failureMessage, type IssueStatus } from "@workspace/domain"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { FileText, LoaderCircle, Plus } from "lucide-react"
import { type FormEvent, useMemo, useState } from "react"

import { AppShell } from "@/components/app-shell"
import { getDashboard } from "@/functions/installation"
import { createIssue, listProjectIssues } from "@/functions/issues"

export const Route = createFileRoute("/projects/$projectSlug/issues/")({
  loader: async ({ params }) => {
    const dashboard = await getDashboard()
    const project = dashboard.projects.find(
      (candidate) => candidate.slug === params.projectSlug
    )
    if (!project) throw notFound()
    const issues = await listProjectIssues({ data: { projectId: project.id } })
    return { dashboard, issues, project }
  },
  component: ProjectIssuesScreen,
})

type IssueFilter = "all" | IssueStatus

function ProjectIssuesScreen() {
  const { projectSlug } = Route.useParams()
  const { dashboard, issues, project } = Route.useLoaderData()
  const navigate = useNavigate()
  const create = useServerFn(createIssue)
  const [filter, setFilter] = useState<IssueFilter>("all")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visibleIssues = useMemo(
    () =>
      filter === "all"
        ? issues
        : issues.filter((issue) => issue.status === filter),
    [filter, issues]
  )

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    try {
      const issue = await create({
        data: {
          projectId: project.id,
          title: String(form.get("title")),
          body: String(form.get("body")),
        },
      })
      await navigate({
        to: "/projects/$projectSlug/issues/$issueNumber",
        params: { projectSlug, issueNumber: String(issue.number) },
      })
    } catch (cause) {
      setError(failureMessage(cause, "The Issue could not be created"))
      setPending(false)
    }
  }

  return (
    <AppShell
      active="home"
      dashboard={dashboard}
      topbar={`${project.name} · Issues`}
    >
      <main className="mx-auto grid w-full max-w-5xl gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:py-14">
        <section className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.03em]">
                Issues
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Numbered work for {project.name}
              </p>
            </div>
            <div
              className="flex rounded-[6px] bg-white/[.035] p-0.5"
              aria-label="Filter Issues"
            >
              {(["all", "open", "closed"] as const).map((value) => (
                <Button
                  key={value}
                  aria-pressed={filter === value}
                  className={cn(
                    "h-7 rounded-[5px] px-2.5 text-xs capitalize",
                    filter === value && "bg-white/[.08] text-foreground"
                  )}
                  onClick={() => setFilter(value)}
                  size="sm"
                  variant="ghost"
                >
                  {value}
                </Button>
              ))}
            </div>
          </div>
          <div className="divide-y">
            {visibleIssues.map((issue) => (
              <Link
                key={issue.id}
                className="group flex min-h-16 items-center gap-3 px-1 py-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                params={{ projectSlug, issueNumber: String(issue.number) }}
                to="/projects/$projectSlug/issues/$issueNumber"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium group-hover:text-foreground">
                    {issue.title}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                    #{issue.number} · updated{" "}
                    {new Date(issue.updatedAt).toLocaleDateString()}
                  </span>
                </span>
                <Badge
                  variant="outline"
                  className="rounded-[4px] text-[10px] capitalize"
                >
                  {issue.status}
                </Badge>
              </Link>
            ))}
            {visibleIssues.length === 0 ? (
              <div className="py-14 text-center text-sm text-muted-foreground">
                No {filter === "all" ? "" : `${filter} `}Issues
              </div>
            ) : null}
          </div>
        </section>
        <aside className="self-start border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">
          <div className="flex items-center gap-2">
            <Plus className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">New Issue</h2>
          </div>
          <form className="mt-5 grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="issue-title">Title</Label>
              <Input
                id="issue-title"
                name="title"
                placeholder="What should change?"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="issue-body">Description</Label>
              <Textarea
                id="issue-body"
                name="body"
                placeholder="Add context, constraints, or acceptance details."
                rows={7}
              />
            </div>
            {error ? (
              <p role="alert" className="text-xs leading-5 text-destructive">
                {error}
              </p>
            ) : null}
            <Button disabled={pending} type="submit">
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}
              {pending ? "Creating Issue…" : "Create Issue"}
            </Button>
          </form>
        </aside>
      </main>
    </AppShell>
  )
}
