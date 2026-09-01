import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Blocks, Search } from "lucide-react"
import { Schema } from "effect"

import { AppShell } from "@/components/app-shell"
import { getSkillCatalog } from "@/lib/skills"
import { getDashboard } from "@/lib/workspaces"

const validateSearch = Schema.decodeUnknownSync(
  Schema.Struct({ q: Schema.optional(Schema.String) })
)

export const Route = createFileRoute("/skills/")({
  validateSearch,
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => {
    const [dashboard, catalog] = await Promise.all([
      getDashboard(),
      getSkillCatalog({ data: { query: deps.q } }),
    ])
    return { dashboard, catalog }
  },
  component: SkillCatalogScreen,
})

function SkillCatalogScreen() {
  const { dashboard, catalog } = Route.useLoaderData()
  const { q } = Route.useSearch()
  const installedCatalogIds = new Set(
    catalog?.installed.map((skill) => skill.catalogId) ?? []
  )

  return (
    <AppShell active="skills" dashboard={dashboard} topbar="Skills">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <Blocks className="size-4" />
              <span className="text-xs font-medium tracking-[0.14em] uppercase">
                skills.sh
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
              Give agents specialist playbooks
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Review the complete source, then install a Skill for every Project
              or for one Project.
            </p>
          </div>
          <form className="flex w-full max-w-sm gap-2" method="get">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search Skills"
                className="pl-9"
                defaultValue={q}
                name="q"
                placeholder="Search Skills"
              />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </header>

        {!catalog ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Sign in to browse Skills.
          </div>
        ) : catalog.entries.length ? (
          <section
            className="divide-y"
            aria-label={q ? "Search results" : "Trending Skills"}
          >
            <div className="flex items-center justify-between py-3 text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
              <span>{q ? `Results for “${q}”` : "Trending now"}</span>
              <span>{catalog.entries.length} Skills</span>
            </div>
            {catalog.entries.map((skill) => {
              const [owner, repository, name] = skill.catalogId.split("/")
              return (
                <Link
                  className="group grid gap-2 py-4 outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_9rem_5rem] sm:items-center sm:px-3"
                  key={skill.catalogId}
                  params={{ owner, repository, skill: name }}
                  to="/skills/$owner/$repository/$skill"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium group-hover:text-primary">
                        {skill.name}
                      </span>
                      {installedCatalogIds.has(skill.catalogId) ? (
                        <Badge variant="outline">Installed</Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                      {skill.source}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground sm:text-right">
                    {skill.installs} installs
                  </span>
                  <span className="text-xs font-medium text-primary sm:text-right">
                    Review →
                  </span>
                </Link>
              )
            })}
          </section>
        ) : (
          <div className="py-16 text-center">
            <Blocks className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No matching Skills</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a broader search.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  )
}
