import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { failureMessage } from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"
import {
  ChevronRight,
  CircleAlert,
  CircleDot,
  Code2,
  LoaderCircle,
  LogOut,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from "lucide-react"
import { type ComponentProps, type FormEvent, useEffect, useState } from "react"

import { authClient } from "@/lib/auth-client"
import { AppShell, SylphMark } from "@/components/app-shell"
import { OnboardingGuide } from "@/components/onboarding-guide"
import { getOnboardingState, validateOnboardingSearch } from "@/lib/onboarding"
import { getDashboard, getLatestMagicLink } from "@/functions/installation"
import { restartWorkspace } from "@/functions/workspaces"
import { useWorkspaceCreation } from "@/lib/use-workspace-creation"

export const Route = createFileRoute("/")({
  validateSearch: validateOnboardingSearch,
  loader: () => getDashboard(),
  component: HomeScreen,
})

function HomeScreen() {
  const dashboard = Route.useLoaderData()
  const { onboarding } = Route.useSearch()
  const router = useRouter()
  const loadLatestMagicLink = useServerFn(getLatestMagicLink)
  const restart = useServerFn(restartWorkspace)
  const [pending, setPending] = useState(false)
  const [restartingId, setRestartingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [magicLink, setMagicLink] = useState<string | null>(null)
  const onboardingState = getOnboardingState({
    organizations: dashboard.organizations,
    projects: dashboard.projects,
    workspaces: dashboard.workspaces,
    providerOrganizationIds: dashboard.providerOrganizationIds,
    hasPersonalProvider: dashboard.hasPersonalProvider,
  })
  const needsOnboarding = onboardingState.completedCount < 3
  const [onboardingVisible, setOnboardingVisible] = useState(needsOnboarding)
  const { creatingProjectId, creationError, startWorkspace } =
    useWorkspaceCreation()

  useEffect(() => {
    if (!needsOnboarding) setOnboardingVisible(false)
  }, [needsOnboarding])

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
      setMessage(failureMessage(cause, "Workspace restart failed"))
    } finally {
      setRestartingId(null)
    }
  }

  if (!dashboard.user) {
    return (
      <main className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.72fr)]">
        <section className="relative hidden min-h-svh overflow-hidden border-r p-12 lg:flex lg:flex-col">
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
              A Project contains its Repository. Each Workspace gives the agent
              an isolated place to work that stays ready between turns.
            </p>
          </div>
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
              Authenticate with a method configured by this Installation.
            </p>
            <div className="mt-8 grid gap-4">
              {dashboard.authentication.testMagicLinks ? (
                <form className="grid gap-4" onSubmit={handleMagicLink}>
                  <Field
                    label="Email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                  />
                  <Button type="submit" disabled={pending}>
                    {pending ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Mail />
                    )}
                    Send test magic link
                  </Button>
                </form>
              ) : null}
              {dashboard.authentication.github ? (
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
              ) : null}
              {magicLink ? (
                <a
                  href={magicLink}
                  className="rounded-[8px] border border-dashed px-3 py-2.5 text-center text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  Open local test magic link
                </a>
              ) : null}
              {!dashboard.authentication.github &&
              !dashboard.authentication.testMagicLinks ? (
                <p className="border-y py-4 text-sm leading-6 text-muted-foreground">
                  Authentication is not configured. Finish the Installation
                  setup and redeploy Sylph.
                </p>
              ) : null}
            </div>
          </div>
        </section>
        {message ? <StatusToast message={message} /> : null}
      </main>
    )
  }

  const firstOrganization = dashboard.organizations[0]

  if (!firstOrganization) {
    return (
      <main className="relative grid min-h-svh place-items-center bg-background px-6 py-20">
        <div className="absolute top-6 left-6 flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-[7px] bg-[#f0a087] text-[#241613]">
            <SylphMark className="size-4" />
          </div>
          <span className="text-sm font-semibold">Sylph</span>
        </div>
        <section className="w-full max-w-lg border-y py-8">
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">
            {dashboard.installation.claimed
              ? "You need an invitation"
              : "Claim this Installation"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {dashboard.installation.claimed
              ? "An Admin must invite your email address before you can access Projects and Workspaces."
              : "The first operator creates the default Organization and becomes its Admin using the claim secret generated during deployment."}
          </p>
          {dashboard.installation.claimed ? (
            <Button
              type="button"
              className="mt-6"
              variant="outline"
              onClick={async () => {
                await authClient.signOut()
                await router.invalidate()
              }}
            >
              <LogOut /> Return to sign in
            </Button>
          ) : (
            <Button
              nativeButton={false}
              className="mt-6"
              render={<Link to="/setup" />}
            >
              Claim Installation <ChevronRight />
            </Button>
          )}
        </section>
      </main>
    )
  }

  const onboardingGuide = (
    <OnboardingGuide
      force={onboarding}
      focused={needsOnboarding && onboardingVisible}
      hasPersonalProvider={dashboard.hasPersonalProvider}
      organizations={dashboard.organizations}
      projects={dashboard.projects}
      providerOrganizationIds={dashboard.providerOrganizationIds}
      onVisibilityChange={setOnboardingVisible}
      required={Boolean(
        onboardingState.organization && !onboardingState.providerConnected
      )}
      userId={dashboard.user.id}
      workspaces={dashboard.workspaces}
    />
  )

  if (needsOnboarding && onboardingVisible) {
    return (
      <main className="flex min-h-svh flex-col bg-background text-foreground">
        <header className="flex h-12 shrink-0 items-center gap-2.5 border-b px-4 sm:px-6">
          <div className="grid size-7 place-items-center rounded-[6px] border border-white/10 bg-primary text-primary-foreground">
            <SylphMark className="size-4" />
          </div>
          <span className="text-sm font-semibold">Sylph</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-xs text-muted-foreground">Getting started</span>
        </header>
        <div className="mx-auto flex w-full max-w-3xl flex-1 items-start px-5 py-12 sm:items-center sm:px-8 sm:py-16">
          {onboardingGuide}
        </div>
      </main>
    )
  }

  return (
    <AppShell active="home" dashboard={dashboard} topbar="Projects">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        {onboardingGuide}
        <div className="flex items-center justify-between gap-5 border-b pb-7">
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">
            Projects
          </h1>
          <Button
            nativeButton={false}
            render={
              firstOrganization ? (
                <a href="/projects/new" />
              ) : (
                <Link to="/setup" />
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
              const basePath = `/projects/${encodeURIComponent(project.slug)}`

              return (
                <section key={project.id} className="py-5">
                  <div className="flex items-center gap-2.5">
                    <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {project.name}
                    </h2>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={creatingProjectId !== null}
                      onClick={() => void startWorkspace(project)}
                    >
                      {creatingProjectId === project.id ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Plus />
                      )}
                      Workspace
                    </Button>
                    <Button
                      nativeButton={false}
                      aria-label={`${project.name} settings`}
                      size="icon-sm"
                      variant="ghost"
                      render={<a href={`${basePath}/settings`} />}
                    >
                      <MoreHorizontal />
                    </Button>
                  </div>
                  {creationError?.projectId === project.id ? (
                    <p role="alert" className="px-1 text-xs text-destructive">
                      {creationError.message}
                    </p>
                  ) : null}
                  <div className="mt-3 grid gap-2">
                    {workspaces.map((workspace) => (
                      <div
                        key={workspace.id}
                        className="group grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border bg-sidebar/55 px-3 py-2.5 transition-colors hover:bg-sidebar"
                      >
                        <a
                          href={`${basePath}/workspaces/${encodeURIComponent(workspace.id)}`}
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
                                  ? "Starting Workspace"
                                  : workspace.status}
                            </span>
                          </span>
                        </a>
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
              <h2 className="text-sm font-semibold">
                Create your first Project
              </h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Sylph will create its Repository and first Workspace together.
              </p>
            </div>
          </div>
        )}
      </div>
      {message ? <StatusToast message={message} /> : null}
    </AppShell>
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
      className="size-3.5 shrink-0 text-status-live"
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
