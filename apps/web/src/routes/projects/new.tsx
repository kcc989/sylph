import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { failureMessage, type ProjectSource } from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  FileCode2,
  GitBranch,
  LoaderCircle,
  Plus,
  Star,
} from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"

import { AppShell } from "@/components/app-shell"
import { validateOnboardingSearch } from "@/lib/onboarding"
import { getDashboard } from "@/functions/installation"
import { getOpenCodeSetup } from "@/functions/provider-connections"
import {
  createProject,
  getProjectTemplates,
  lookupGitHubRepository,
} from "@/functions/projects"

type SourceKind = ProjectSource["kind"]
type GitHubMode = Extract<ProjectSource, { kind: "github" }>["mode"]

export const Route = createFileRoute("/projects/new")({
  validateSearch: validateOnboardingSearch,
  loader: async () => {
    const dashboard = await getDashboard()
    const organization = dashboard.organizations[0] ?? null
    const [setup, catalog] = organization
      ? await Promise.all([
          getOpenCodeSetup({ data: { organizationId: organization.id } }),
          getProjectTemplates({ data: { organizationId: organization.id } }),
        ])
      : [null, null]

    if (organization && !setup?.providerId) {
      throw redirect({ to: "/admin", search: { onboarding: true } })
    }

    return { dashboard, organization, setup, catalog }
  },
  component: NewProjectScreen,
})

function NewProjectScreen() {
  const navigate = useNavigate()
  const { onboarding } = Route.useSearch()
  const { dashboard, organization, setup, catalog } = Route.useLoaderData()
  const create = useServerFn(createProject)
  const lookupRepository = useServerFn(lookupGitHubRepository)
  const [pending, setPending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<SourceKind>("template")
  const [templateKey, setTemplateKey] = useState(catalog?.defaultTemplate ?? "")
  const [githubMode, setGithubMode] = useState<GitHubMode>("connected")
  const [advanced, setAdvanced] = useState(false)
  const [repositoryUrl, setRepositoryUrl] = useState("")
  const [repository, setRepository] = useState<
    Awaited<ReturnType<typeof lookupGitHubRepository>> | undefined
  >()

  if (!organization || !catalog) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Organization unavailable</h1>
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

  const organizationId = organization.id
  const selectedTemplate = catalog.templates.find(
    (template) => template.key === templateKey
  )

  const handleRepositoryLookup = async () => {
    setError(null)
    setVerifying(true)

    try {
      const result = await lookupRepository({
        data: { organizationId, url: repositoryUrl },
      })
      setRepository(result)
    } catch (cause) {
      setRepository(undefined)
      setError(failureMessage(cause, "Repository lookup failed"))
    } finally {
      setVerifying(false)
    }
  }

  const projectSource = (): ProjectSource | null => {
    if (source === "template") {
      return selectedTemplate
        ? { kind: "template", template: selectedTemplate.key }
        : null
    }
    if (source === "github") {
      return repository
        ? {
            kind: "github",
            url: repository.url,
            branch: repository.defaultBranch,
            mode: githubMode,
          }
        : null
    }
    return { kind: "empty" }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    const resolvedSource = projectSource()

    if (!resolvedSource) {
      setError(
        source === "github"
          ? "Verify the GitHub repository before importing it"
          : "Choose a Project template"
      )
      setPending(false)
      return
    }

    try {
      const result = await create({
        data: {
          organizationId,
          name: String(form.get("name")),
          source: resolvedSource,
        },
      })
      await navigate({
        to: "/projects/$projectSlug/workspaces/$workspaceId",
        params: {
          projectSlug: result.projectSlug,
          workspaceId: result.id,
        },
        search: { onboarding },
      })
    } catch (cause) {
      setError(failureMessage(cause, "The project could not be created"))
      setPending(false)
    }
  }

  const submitLabel = pending
    ? source === "github"
      ? "Importing Repository…"
      : "Creating Project…"
    : source === "github"
      ? "Import Repository"
      : "Create Project"

  return (
    <AppShell active="home" dashboard={dashboard} topbar="New project">
      <main className="px-5 py-10">
        <div className="mx-auto w-full max-w-xl">
          <Link
            to="/"
            className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Projects
          </Link>
          <section className="border-y py-8">
            <h1 className="text-xl font-semibold tracking-[-0.03em]">
              Create a Project
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Fork a template or import a GitHub Repository. Sylph creates the
              first Workspace in the same step.
            </p>
            <form className="mt-7 grid gap-5" onSubmit={handleSubmit}>
              <div className="flex items-center justify-between gap-4 border-y py-3">
                <div>
                  <p className="text-sm font-medium">Default provider</p>
                  <p className="text-xs text-muted-foreground">
                    {setup?.providerId}/{setup?.modelId}
                  </p>
                </div>
                <Button
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  render={<Link to="/admin" search={{ onboarding }} />}
                >
                  Change
                </Button>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">
                  Repository source
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SourceOption
                    active={source === "template"}
                    description="Fork a Cloudflare-ready template."
                    icon={<FileCode2 />}
                    label="Start from a template"
                    onClick={() => {
                      setSource("template")
                      setRepository(undefined)
                      setError(null)
                    }}
                  />
                  <SourceOption
                    active={source === "github"}
                    description="Copy a public or private Repository."
                    icon={<Code2 />}
                    label="Import from GitHub"
                    onClick={() => {
                      setSource("github")
                      setError(null)
                    }}
                  />
                  {advanced ? (
                    <SourceOption
                      active={source === "empty"}
                      description="Create an empty Project Repository. Checks fail until it defines the Sylph package scripts."
                      icon={<Plus />}
                      label="Empty repository"
                      onClick={() => {
                        setSource("empty")
                        setRepository(undefined)
                        setError(null)
                      }}
                    />
                  ) : null}
                </div>
                {advanced ? null : (
                  <button
                    type="button"
                    className="justify-self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => setAdvanced(true)}
                  >
                    Advanced: start with an empty repository
                  </button>
                )}
              </fieldset>
              {source === "template" ? (
                <fieldset className="grid gap-2 border-y py-5">
                  <legend className="mb-1 text-sm font-medium">Template</legend>
                  {catalog.templates.map((template) => (
                    <label
                      key={template.key}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-[8px] border p-3",
                        templateKey === template.key
                          ? "border-primary/55 bg-primary/[.07]"
                          : "bg-sidebar/45 hover:bg-sidebar"
                      )}
                    >
                      <input
                        type="radio"
                        name="template"
                        value={template.key}
                        checked={templateKey === template.key}
                        onChange={() => setTemplateKey(template.key)}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {template.name}
                          {template.key === catalog.defaultTemplate ? (
                            <span className="ml-2 rounded-full border px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                              Default
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {template.description}
                        </span>
                        <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                          {template.sourceUrl} @ {template.sourceRef}
                        </span>
                      </span>
                    </label>
                  ))}
                  <p className="text-xs leading-5 text-muted-foreground">
                    The Project Repository is forked from the template and has
                    no link to it afterwards.
                  </p>
                </fieldset>
              ) : null}
              {source === "github" ? (
                <div className="grid gap-3 border-y py-5">
                  <div className="grid gap-2">
                    <Label htmlFor="repository-url">
                      GitHub Repository URL
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="repository-url"
                        type="url"
                        value={repositoryUrl}
                        onChange={(event) => {
                          setRepositoryUrl(event.target.value)
                          setRepository(undefined)
                        }}
                        placeholder="https://github.com/owner/repository"
                        required
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={verifying || repositoryUrl.length === 0}
                        onClick={handleRepositoryLookup}
                      >
                        {verifying ? (
                          <LoaderCircle className="animate-spin" />
                        ) : repository ? (
                          <Check />
                        ) : null}
                        {repository ? "Verified" : "Verify"}
                      </Button>
                    </div>
                  </div>
                  {repository ? (
                    <RepositoryPreview repository={repository} />
                  ) : null}
                  <div className="grid gap-2">
                    <Label htmlFor="github-mode">After import</Label>
                    <select
                      id="github-mode"
                      className="h-8 rounded-[8px] border bg-background px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      value={githubMode}
                      onChange={(event) =>
                        setGithubMode(
                          event.target.value === "copy" ? "copy" : "connected"
                        )
                      }
                    >
                      <option value="connected">
                        Keep connected: sync from GitHub and deliver Accepted
                        commits back
                      </option>
                      <option value="copy">
                        Copy only: use the Repository as a one-off template
                      </option>
                    </select>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Private access uses the GitHub App repositories granted
                    during sign-in. Sylph never stores a personal access token.
                  </p>
                </div>
              ) : null}
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
                  The Project and initial Workspace use this name.
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
                  <ArrowRight />
                )}
                {submitLabel}
              </Button>
            </form>
          </section>
        </div>
      </main>
    </AppShell>
  )
}

function SourceOption({
  active,
  description,
  icon,
  label,
  onClick,
}: {
  active: boolean
  description: string
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-24 items-start gap-3 rounded-[8px] border p-3 text-left transition-colors",
        active
          ? "border-primary/55 bg-primary/[.07]"
          : "bg-sidebar/45 hover:bg-sidebar"
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-[6px] border [&>svg]:size-4",
          active && "border-primary/35 text-primary"
        )}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  )
}

function RepositoryPreview({
  repository,
}: {
  repository: Awaited<ReturnType<typeof lookupGitHubRepository>>
}) {
  return (
    <div className="rounded-[8px] border bg-sidebar/55 p-3">
      <div className="flex items-start gap-3">
        <img
          src={repository.ownerAvatarUrl}
          alt=""
          className="size-9 rounded-[6px]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">
              {repository.fullName}
            </p>
            <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
              {repository.visibility}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {repository.description ?? "No Repository description"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4 border-t pt-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <GitBranch className="size-3" /> {repository.defaultBranch}
        </span>
        {repository.language ? <span>{repository.language}</span> : null}
        <span className="inline-flex items-center gap-1.5">
          <Star className="size-3" /> {repository.stars.toLocaleString()}
        </span>
      </div>
    </div>
  )
}
