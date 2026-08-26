import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import {
  Boxes,
  Blocks,
  Building2,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Code2,
  FolderGit2,
  House,
  Layers3,
  LoaderCircle,
  LogOut,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  UserRound,
} from "lucide-react"
import { type ComponentProps, type FormEvent, useState } from "react"

import { authClient } from "@/lib/auth-client"
import {
  getDashboard,
  getLatestMagicLink,
  restartWorkspace,
} from "@/lib/workspaces"

export const Route = createFileRoute("/")({
  loader: () => getDashboard(),
  component: HomeScreen,
})

function SylphMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      fill="none"
    >
      <path d="M10 1.5 14.25 6 10 10.5 5.75 6 10 1.5Z" fill="currentColor" />
      <path
        d="m5.2 8.1 3.4 3.6-3.4 3.6-3.4-3.6 3.4-3.6Z"
        fill="currentColor"
        opacity=".72"
      />
      <path
        d="m14.8 8.1 3.4 3.6-3.4 3.6-3.4-3.6 3.4-3.6Z"
        fill="currentColor"
        opacity=".72"
      />
      <path
        d="m10 13 3 3.1-3 2.4-3-2.4 3-3.1Z"
        fill="currentColor"
        opacity=".45"
      />
    </svg>
  )
}

function ProductRail() {
  const tools = [
    { label: "Home", icon: House },
    { label: "Search", icon: Search },
    { label: "Projects", icon: Layers3 },
    { label: "Skills", icon: Blocks },
  ]

  return (
    <aside
      aria-label="Product navigation"
      className="hidden w-12 shrink-0 flex-col items-center border-r bg-[var(--sylph-ink)] py-2.5 md:flex"
    >
      <div
        aria-label="Sylph"
        role="img"
        className="mb-4 grid size-7 place-items-center rounded-[6px] border border-white/10 bg-[#f0a087] text-[#241613]"
      >
        <SylphMark className="size-4" />
      </div>
      <nav className="grid gap-1" aria-label="Product tools">
        {tools.map(({ label, icon: Icon }, index) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            className={cn(
              "grid size-8 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              index === 0 && "bg-white/[.07] text-foreground"
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </nav>
      <div className="mt-auto grid gap-1">
        <Button aria-label="Settings" size="icon-sm" variant="ghost">
          <Settings2 />
        </Button>
        <div className="grid size-7 place-items-center rounded-full border border-white/10 bg-white/[.06]">
          <UserRound className="size-3.5 text-muted-foreground" />
        </div>
      </div>
    </aside>
  )
}

function HomeScreen() {
  const dashboard = Route.useLoaderData()
  const router = useRouter()
  const loadLatestMagicLink = useServerFn(getLatestMagicLink)
  const restart = useServerFn(restartWorkspace)
  const [pending, setPending] = useState(false)
  const [restartingId, setRestartingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [magicLink, setMagicLink] = useState<string | null>(null)

  const handleMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    setMagicLink(null)
    const form = new FormData(event.currentTarget)
    const email = String(form.get("email"))
    const result = await authClient.signIn.magicLink({
      email,
      name: email.split("@")[0],
      callbackURL: "/",
      errorCallbackURL: "/",
    })

    if (result.error) {
      setPending(false)
      setMessage(result.error.message ?? "Authentication failed")
      return
    }

    const localLink = await loadLatestMagicLink({ data: { email } })
    setMagicLink(localLink)
    setMessage("Magic link created. In production, the mailer sends this link.")
    setPending(false)
  }

  const handleRestart = async (workspaceId: string) => {
    setRestartingId(workspaceId)
    setMessage(null)

    try {
      await restart({ data: { workspaceId } })
      await router.invalidate()
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Workspace restart failed"
      )
    } finally {
      setRestartingId(null)
    }
  }

  if (!dashboard.user) {
    return (
      <main className="dark grid min-h-svh bg-[var(--sylph-ink)] lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.72fr)]">
        <section className="relative hidden min-h-svh overflow-hidden border-r p-12 lg:flex lg:flex-col">
          <div className="absolute inset-0 sylph-grid opacity-25" />
          <div className="relative flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-[8px] bg-[#f0a087] text-[#241613]">
              <SylphMark className="size-5" />
            </div>
            <span className="text-base font-semibold">Sylph</span>
          </div>
          <div className="relative my-auto max-w-xl">
            <h1 className="max-w-[11ch] text-5xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
              Durable coding workspaces for agent-built software.
            </h1>
            <p className="mt-6 max-w-[58ch] text-base leading-7 text-muted-foreground">
              A Project contains its Repository. Each Workspace forks that
              Repository, starts OpenCode v2, and keeps the agent’s work durable
              between turns.
            </p>
          </div>
          <p className="relative text-xs text-muted-foreground">
            Durable Objects for state · Cloudflare CI for process-heavy work
          </p>
        </section>
        <section className="flex min-h-svh items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <div className="mb-10 flex items-center gap-3 lg:hidden">
              <div className="grid size-8 place-items-center rounded-[7px] bg-[#f0a087] text-[#241613]">
                <SylphMark className="size-4" />
              </div>
              <span className="font-semibold">Sylph</span>
            </div>
            <h2 className="text-2xl font-semibold tracking-[-0.025em]">
              Sign in to your workspaces
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Continue with GitHub or use a magic link.
            </p>
            <form className="mt-8 grid gap-4" onSubmit={handleMagicLink}>
              <Field
                label="Email"
                name="email"
                type="email"
                placeholder="you@example.com"
              />
              <Button type="submit" disabled={pending}>
                {pending ? <LoaderCircle className="animate-spin" /> : <Mail />}
                Send magic link
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  authClient.signIn.social({
                    provider: "github",
                    callbackURL: "/",
                  })
                }
              >
                <Code2 /> Continue with GitHub
              </Button>
              {magicLink ? (
                <a
                  href={magicLink}
                  className="rounded-[8px] border border-dashed px-3 py-2.5 text-center text-xs font-medium text-[var(--sylph-coral)] underline-offset-4 hover:underline"
                >
                  Open local test magic link
                </a>
              ) : null}
            </form>
          </div>
        </section>
        {message ? <StatusToast message={message} /> : null}
      </main>
    )
  }

  const firstOrganization = dashboard.organizations[0]

  return (
    <div className="dark flex min-h-svh bg-[var(--sylph-ink)] text-foreground">
      <ProductRail />
      <aside className="hidden w-[268px] shrink-0 flex-col border-r bg-sidebar md:flex">
        <header className="flex h-12 items-center gap-2 border-b px-3">
          <div className="grid size-6 place-items-center rounded-[5px] bg-foreground text-[10px] font-bold text-background">
            {dashboard.organizations[0]?.name.slice(0, 1).toUpperCase() ?? "S"}
          </div>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {dashboard.organizations[0]?.name ?? "Sylph"}
          </span>
          <Button
            nativeButton={false}
            aria-label="Manage organizations"
            size="icon-xs"
            variant="ghost"
            render={<Link to="/organizations" />}
          >
            <Building2 />
          </Button>
        </header>
        <div className="flex h-10 items-center justify-between px-3">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Projects
          </span>
          <Button
            nativeButton={false}
            aria-label="Create project"
            size="icon-xs"
            variant="ghost"
            render={
              firstOrganization ? (
                <a
                  href={`/organizations/${encodeURIComponent(firstOrganization.id)}/projects/new`}
                />
              ) : (
                <Link to="/organizations/new" />
              )
            }
          >
            <Plus />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {dashboard.projects.map((project) => {
            const workspaces = dashboard.workspaces.filter(
              (workspace) => workspace.projectId === project.id
            )

            return (
              <section key={project.id} className="mb-2">
                <div className="flex h-8 items-center gap-2 px-2 text-xs font-semibold text-foreground/85">
                  <FolderGit2 className="size-3.5 text-[#ef9b7e]" />
                  <span className="min-w-0 flex-1 truncate">
                    {project.name}
                  </span>
                  <Button
                    nativeButton={false}
                    aria-label={`New Workspace in ${project.name}`}
                    size="icon-xs"
                    variant="ghost"
                    render={
                      <a
                        href={`/projects/${encodeURIComponent(project.id)}/workspaces/new`}
                      />
                    }
                  >
                    <Plus />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Open ${project.name} menu`}
                      className="grid size-6 place-items-center rounded-[4px] text-muted-foreground hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        onClick={() =>
                          window.location.assign(
                            `/projects/${encodeURIComponent(project.id)}/workspaces/new`
                          )
                        }
                      >
                        <Plus /> New Workspace
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          window.location.assign(
                            `/projects/${encodeURIComponent(project.id)}/settings`
                          )
                        }
                      >
                        <Settings2 /> Project settings
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <p className="ml-[22px] truncate font-mono text-[10px] text-muted-foreground">
                  Repository · {project.repositoryName}
                </p>
                <div className="mt-1 ml-[5px] border-l border-white/[.07] pl-1.5">
                  {workspaces.map((workspace) => (
                    <Link
                      key={workspace.id}
                      to="/workspaces/$workspaceId"
                      params={{ workspaceId: workspace.id }}
                      className="grid grid-cols-[10px_minmax(0,1fr)] gap-2 rounded-[5px] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/[.045] hover:text-foreground"
                    >
                      <WorkspaceStatusDot status={workspace.status} />
                      <span className="truncate">{workspace.title}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
        <footer className="flex h-10 items-center gap-2 border-t px-3 text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-[var(--sylph-live)]" />
          Durable workspace service online
        </footer>
      </aside>

      <main className="min-w-0 flex-1 bg-background">
        <header className="flex h-12 items-center border-b px-3 sm:px-4">
          <div className="flex items-center gap-2 md:hidden">
            <div className="grid size-7 place-items-center rounded-[6px] bg-[#f0a087] text-[#241613]">
              <SylphMark className="size-4" />
            </div>
            <span className="text-sm font-semibold">Sylph</span>
          </div>
          <div className="hidden items-center gap-2 text-xs md:flex">
            <House className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Home</span>
            <ChevronRight className="size-3 text-muted-foreground/50" />
            <span className="font-medium">Projects</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden max-w-56 truncate text-xs text-muted-foreground sm:block">
              {dashboard.user.email}
            </span>
            <Button
              aria-label="Sign out"
              size="icon-sm"
              variant="ghost"
              onClick={async () => {
                await authClient.signOut()
                await router.invalidate()
              }}
            >
              <LogOut />
            </Button>
          </div>
        </header>
        <div className="flex h-10 items-end gap-1 overflow-x-auto border-b px-3 sm:px-5">
          <button
            type="button"
            className="relative h-10 px-3 text-xs font-medium text-foreground"
          >
            Projects
            <span className="absolute inset-x-2 bottom-0 h-px bg-[var(--sylph-coral)]" />
          </button>
          <Link
            to="/organizations"
            className="grid h-10 place-items-center px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            Organizations
          </Link>
        </div>
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
          <div className="flex flex-col items-start gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.03em]">
                Projects
              </h1>
              <p className="mt-2 max-w-[62ch] text-sm leading-6 text-muted-foreground">
                Each Project contains one Repository. Start a Workspace to give
                OpenCode v2 a durable fork of that Repository.
              </p>
            </div>
            <Button
              nativeButton={false}
              render={
                firstOrganization ? (
                  <a
                    href={`/organizations/${encodeURIComponent(firstOrganization.id)}/projects/new`}
                  />
                ) : (
                  <Link to="/organizations/new" />
                )
              }
            >
              <Plus /> New project
            </Button>
          </div>

          {dashboard.projects.length ? (
            <div className="divide-y">
              {dashboard.projects.map((project) => {
                const workspaces = dashboard.workspaces.filter(
                  (workspace) => workspace.projectId === project.id
                )

                return (
                  <section
                    key={project.id}
                    className="grid gap-5 py-6 lg:grid-cols-[minmax(180px,0.65fr)_minmax(0,1.35fr)]"
                  >
                    <div>
                      <div className="flex items-center gap-2.5">
                        <FolderGit2 className="size-4 text-[#ef9b7e]" />
                        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {project.name}
                        </h2>
                        <Button
                          nativeButton={false}
                          size="sm"
                          variant="ghost"
                          render={
                            <a
                              href={`/projects/${encodeURIComponent(project.id)}/workspaces/new`}
                            />
                          }
                        >
                          <Plus /> Workspace
                        </Button>
                        <Button
                          nativeButton={false}
                          aria-label={`${project.name} settings`}
                          size="icon-sm"
                          variant="ghost"
                          render={
                            <a
                              href={`/projects/${encodeURIComponent(project.id)}/settings`}
                            />
                          }
                        >
                          <MoreHorizontal />
                        </Button>
                      </div>
                      <p className="mt-2 pl-6 font-mono text-[10px] text-muted-foreground">
                        Repository · {project.repositoryName}
                      </p>
                      <p className="mt-1 pl-6 text-[10px] text-muted-foreground">
                        Default branch · {project.defaultBranch}
                      </p>
                    </div>
                    <div className="grid gap-2">
                      {workspaces.map((workspace) => (
                        <div
                          key={workspace.id}
                          className="group grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border bg-sidebar/55 px-3 py-2.5 transition-colors hover:bg-sidebar"
                        >
                          <Link
                            to="/workspaces/$workspaceId"
                            params={{ workspaceId: workspace.id }}
                            className="flex min-w-0 items-center gap-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            <WorkspaceStatusDot status={workspace.status} />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium">
                                {workspace.title}
                              </span>
                              <span
                                className={cn(
                                  "mt-0.5 block truncate text-[10px] text-muted-foreground",
                                  workspace.status === "error" &&
                                    "text-destructive"
                                )}
                              >
                                {workspace.status === "error"
                                  ? workspace.errorSummary ||
                                    "Workspace startup failed"
                                  : workspace.status === "provisioning"
                                    ? "Starting OpenCode v2"
                                    : `${workspace.status} · durable fork`}
                              </span>
                            </span>
                          </Link>
                          {workspace.status === "error" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={restartingId === workspace.id}
                              onClick={() => handleRestart(workspace.id)}
                            >
                              {restartingId === workspace.id ? (
                                <LoaderCircle className="animate-spin" />
                              ) : (
                                <RefreshCw />
                              )}
                              Restart
                            </Button>
                          ) : (
                            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <div className="grid min-h-72 place-items-center text-center">
              <div className="max-w-sm">
                <Boxes className="mx-auto size-7 text-muted-foreground" />
                <h2 className="mt-4 text-sm font-semibold">
                  Create your first Project
                </h2>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Sylph will create its Repository, first durable Workspace, and
                  OpenCode v2 session together.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
      {message ? <StatusToast message={message} /> : null}
    </div>
  )
}

function WorkspaceStatusDot({ status }: { status: string }) {
  const error = status === "error"
  const active = status === "ready" || status === "running"

  return error ? (
    <CircleAlert
      aria-label="Workspace error"
      className="size-3.5 shrink-0 text-destructive"
    />
  ) : active ? (
    <CircleDot
      aria-label={`${status} Workspace`}
      className="size-3.5 shrink-0 text-[var(--sylph-live)]"
    />
  ) : (
    <LoaderCircle
      aria-label="Workspace provisioning"
      className="size-3.5 shrink-0 animate-spin text-amber-400"
    />
  )
}

function StatusToast({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 max-w-md rounded-[8px] border bg-sidebar px-4 py-3 text-sm shadow-[0_12px_36px_rgb(0_0_0/.35)]"
    >
      {message}
    </div>
  )
}

function Field({
  label,
  name,
  ...props
}: {
  label: string
  name: string
} & ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} required {...props} />
    </div>
  )
}
