import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { failureMessage } from "@workspace/domain"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Markdown } from "@workspace/ui/components/markdown"
import {
  ArrowLeft,
  Blocks,
  Bot,
  ExternalLink,
  FileText,
  LoaderCircle,
  Terminal,
} from "lucide-react"
import { useState } from "react"

import { AppShell } from "@/components/app-shell"
import { getSkillReview, installSkill } from "@/functions/skills"
import { getDashboard } from "@/functions/installation"

export const Route = createFileRoute("/skills/$owner/$repository/$skill")({
  loader: async ({ params }) => {
    const [dashboard, detail] = await Promise.all([
      getDashboard(),
      getSkillReview({ data: params }),
    ])
    return { dashboard, detail }
  },
  component: SkillReviewScreen,
})

function SkillReviewScreen() {
  const { dashboard, detail } = Route.useLoaderData()
  const install = useServerFn(installSkill)
  const router = useRouter()
  const organization = dashboard.organizations[0] ?? null
  const [projectId, setProjectId] = useState(dashboard.projects[0]?.id ?? "")
  const [pendingScope, setPendingScope] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!detail || !organization) {
    return (
      <AppShell active="skills" dashboard={dashboard} topbar="Skills">
        <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
          Sign in to review this Skill.
        </div>
      </AppShell>
    )
  }

  const { review, installed } = detail
  const installFor = async (selectedProjectId?: string) => {
    setPendingScope(selectedProjectId ?? "installation")
    setError(null)
    try {
      await install({
        data: {
          organizationId: organization.id,
          projectId: selectedProjectId || undefined,
          catalogId: review.catalogId,
          sourceHash: review.sourceHash,
        },
      })
      await router.invalidate()
    } catch (cause) {
      setError(failureMessage(cause, "Could not install Skill"))
    } finally {
      setPendingScope(null)
    }
  }

  const installationInstalled = installed.some(
    (item) => item.scope === "installation"
  )
  const selectedProjectInstalled = installed.some(
    (item) => item.projectId === projectId
  )

  return (
    <AppShell active="skills" dashboard={dashboard} topbar="Skill review">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-7 sm:px-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:py-10">
        <main className="min-w-0">
          <Link
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            search={{ q: undefined }}
            to="/skills"
          >
            <ArrowLeft className="size-3.5" /> Browse Skills
          </Link>
          <header className="mt-5 border-b pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                <Blocks /> {review.source}
              </Badge>
              <Badge variant="outline">
                <FileText /> {review.files.length} files
              </Badge>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em]">
              {review.metadata.name}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {review.metadata.description || "No description provided."}
            </p>
          </header>
          <section className="py-7" aria-label="Skill instructions">
            <Markdown>{review.content}</Markdown>
          </section>
        </main>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <section className="border bg-muted/20 p-4">
            <h2 className="text-sm font-semibold">Invocation</h2>
            <dl className="mt-3 grid gap-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <Terminal className="size-3.5" /> User command
                </dt>
                <dd>
                  {review.metadata.userInvokable
                    ? `/${review.metadata.name}`
                    : "Disabled"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <Bot className="size-3.5" /> Agent choice
                </dt>
                <dd>
                  {review.metadata.disableModelInvocation
                    ? "Disabled"
                    : "Enabled"}
                </dd>
              </div>
            </dl>
            <div className="mt-4 grid gap-2 border-t pt-4">
              {dashboard.installation.canAdminister ? (
                <Button
                  disabled={pendingScope !== null}
                  onClick={() => installFor()}
                >
                  {pendingScope === "installation" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : null}
                  {installationInstalled
                    ? "Update Installation Skill"
                    : "Install for Installation"}
                </Button>
              ) : null}
              {dashboard.projects.length ? (
                <>
                  <label
                    className="mt-2 text-[11px] font-medium"
                    htmlFor="skill-project"
                  >
                    Project
                  </label>
                  <select
                    className="h-9 w-full border bg-background px-2 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    id="skill-project"
                    onChange={(event) => setProjectId(event.target.value)}
                    value={projectId}
                  >
                    {dashboard.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={!projectId || pendingScope !== null}
                    onClick={() => installFor(projectId)}
                    variant="outline"
                  >
                    {pendingScope === projectId ? (
                      <LoaderCircle className="animate-spin" />
                    ) : null}
                    {selectedProjectInstalled
                      ? "Update Project Skill"
                      : "Install for Project"}
                  </Button>
                </>
              ) : null}
              {error ? (
                <p
                  className="mt-1 text-xs leading-5 text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
            </div>
          </section>
          <section className="mt-4 grid gap-2 border p-4 text-xs">
            <a
              className="flex items-center justify-between text-muted-foreground hover:text-foreground"
              href={review.sourcePageUrl}
              rel="noreferrer"
              target="_blank"
            >
              View on skills.sh <ExternalLink className="size-3.5" />
            </a>
            <a
              className="flex items-center justify-between text-muted-foreground hover:text-foreground"
              href={review.repositoryUrl}
              rel="noreferrer"
              target="_blank"
            >
              View repository <ExternalLink className="size-3.5" />
            </a>
            <p className="mt-2 border-t pt-3 font-mono text-[9px] break-all text-muted-foreground">
              SHA-256 {review.sourceHash}
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  )
}
