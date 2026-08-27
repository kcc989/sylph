import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import type { ConnectionScope } from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import {
  decodeModelOption,
  encodeModelOption,
} from "@workspace/ui/lib/model-option"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  ArrowRight,
  Copy,
  ExternalLink,
  LoaderCircle,
  MailPlus,
  Plus,
  RefreshCw,
} from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"

import { AppShell } from "@/components/app-shell"
import { authClient } from "@/lib/auth-client"
import { validateOnboardingSearch } from "@/lib/onboarding"
import {
  cancelOpenCodeSubscription,
  getDashboard,
  getOpenCodeSubscriptionStatus,
  getOpenCodeSetup,
  saveOpenCodeSetup,
  setDefaultModel,
  startOpenCodeSubscription,
} from "@/lib/workspaces"

export const Route = createFileRoute("/admin")({
  validateSearch: validateOnboardingSearch,
  loader: async () => {
    const dashboard = await getDashboard()
    const organization = dashboard.organizations[0] ?? null
    const setup = organization
      ? await getOpenCodeSetup({ data: { organizationId: organization.id } })
      : null

    return {
      dashboard,
      organization,
      setup,
    }
  },
  component: OrganizationSettingsScreen,
})

const providerName = (providerId: string) =>
  providerId === "openai"
    ? "OpenAI"
    : providerId === "opencode"
      ? "OpenCode Zen"
      : providerId

const authMethodName = (authMethod: string) =>
  authMethod === "chatgpt-subscription" ? "Codex subscription" : "API key"

type SetupFlow = "list" | "choose" | "openai" | "subscription" | "key"

function OrganizationSettingsScreen() {
  const { dashboard, organization, setup } = Route.useLoaderData()
  const { onboarding } = Route.useSearch()
  const organizationId = organization?.id ?? ""
  const router = useRouter()
  const saveSetup = useServerFn(saveOpenCodeSetup)
  const saveDefaultModel = useServerFn(setDefaultModel)
  const startSubscription = useServerFn(startOpenCodeSubscription)
  const subscriptionStatus = useServerFn(getOpenCodeSubscriptionStatus)
  const cancelSubscription = useServerFn(cancelOpenCodeSubscription)
  const [scope, setScope] = useState<ConnectionScope>(
    setup?.canManageOrganization ? "organization" : "user"
  )
  const connections =
    scope === "organization"
      ? (setup?.organizationConnections ?? [])
      : (setup?.personalConnections ?? [])
  const [flow, setFlow] = useState<SetupFlow>("list")
  const [apiKey, setApiKey] = useState("")
  const [pending, setPending] = useState(false)
  const [defaultPending, setDefaultPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invitePending, setInvitePending] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<{
    attemptId: string
    url: string
    instructions: string
    expiresAt: number
  } | null>(null)

  useEffect(() => {
    if (flow !== "subscription" || !attempt || !organizationId) return

    let active = true
    const poll = async () => {
      try {
        const result = await subscriptionStatus({
          data: {
            organizationId,
            scope,
            attemptId: attempt.attemptId,
          },
        })

        if (!active) return

        if (result.status === "complete") {
          setFlow("list")
          setAttempt(null)
          await router.invalidate()
          if (onboarding && organization) {
            window.location.assign("/projects/new?onboarding=1")
          }
          return
        }

        if (result.status === "failed" || result.status === "expired") {
          setError(
            result.message ??
              (result.status === "expired"
                ? "This sign-in code expired. Start again."
                : "OpenAI sign-in failed. Start again.")
          )
          setAttempt(null)
          setFlow("openai")
          return
        }

        window.setTimeout(poll, 2_000)
      } catch (cause) {
        if (!active) return
        setError(
          cause instanceof Error ? cause.message : "Could not check sign-in"
        )
        setAttempt(null)
        setFlow("openai")
      }
    }

    const timer = window.setTimeout(poll, 1_000)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [
    attempt,
    flow,
    organizationId,
    onboarding,
    organization,
    router,
    scope,
    subscriptionStatus,
  ])

  if (!organization || !dashboard.installation.canAdminister) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Administration unavailable</h1>
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

  const returnToList = () => {
    setFlow("list")
    setError(null)
    setApiKey("")
  }

  const handleApiSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await saveSetup({
        data: {
          organizationId,
          scope,
          providerId: "opencode",
          apiKey,
        },
      })
      returnToList()
      await router.invalidate()
      if (onboarding) {
        window.location.assign("/projects/new?onboarding=1")
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "OpenCode Zen could not connect"
      )
    } finally {
      setPending(false)
    }
  }

  const handleSubscription = async () => {
    setPending(true)
    setError(null)
    try {
      const nextAttempt = await startSubscription({
        data: { organizationId, scope },
      })
      setAttempt(nextAttempt)
      setFlow("subscription")
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start OpenAI sign-in"
      )
    } finally {
      setPending(false)
    }
  }

  const handleSubscriptionCancel = async () => {
    const currentAttempt = attempt
    setAttempt(null)
    setFlow("openai")
    if (!currentAttempt) return

    try {
      await cancelSubscription({
        data: {
          organizationId,
          scope,
          attemptId: currentAttempt.attemptId,
        },
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not cancel OpenAI sign-in"
      )
    }
  }

  const reconnect = (providerId: string) => {
    setError(null)
    if (providerId === "openai") {
      setFlow("openai")
      return
    }
    setFlow("key")
  }

  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setInvitePending(true)
    setInviteError(null)
    setInvitationUrl(null)
    const form = new FormData(event.currentTarget)
    const result = await authClient.organization.inviteMember({
      email: String(form.get("email")),
      role: "member",
      organizationId,
    })

    if (result.error) {
      setInviteError(
        result.error.message ?? "The invitation could not be created"
      )
      setInvitePending(false)
      return
    }

    setInvitationUrl(
      new URL(
        `/invite/${encodeURIComponent(result.data.id)}`,
        window.location.origin
      ).toString()
    )
    event.currentTarget.reset()
    setInvitePending(false)
    await router.invalidate()
  }

  return (
    <AppShell
      active="admin"
      dashboard={dashboard}
      topbar="Installation administration"
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        <Button
          nativeButton={false}
          className="mb-6"
          size="sm"
          render={
            <a href={`/projects/new${onboarding ? "?onboarding=1" : ""}`} />
          }
        >
          <Plus />{" "}
          {onboarding && setup?.providerId
            ? "Continue to Project"
            : "New Project"}
        </Button>
        <section className="flex items-start justify-between gap-6 border-b pb-6">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.03em]">
              AI connections
            </h1>
            <p className="mt-1.5 max-w-[65ch] text-sm leading-6 text-muted-foreground">
              {scope === "organization"
                ? `Shared connections are available to everyone in ${organization.name}.`
                : "Personal connections are used for Workspaces you create."}{" "}
              Your personal default takes precedence over the Organization
              default.
            </p>
          </div>
          {flow === "list" ? (
            <Button size="sm" onClick={() => setFlow("choose")}>
              <Plus /> Add provider
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={returnToList}>
              Cancel
            </Button>
          )}
        </section>

        <div
          className="flex h-11 items-end gap-1 border-b"
          role="tablist"
          aria-label="Connection scope"
        >
          <button
            type="button"
            role="tab"
            aria-selected={scope === "user"}
            className="relative h-11 px-3 text-xs font-medium text-muted-foreground hover:text-foreground aria-selected:text-foreground"
            onClick={() => {
              setScope("user")
              returnToList()
            }}
          >
            Personal
            {scope === "user" ? (
              <span className="absolute inset-x-2 bottom-0 h-px bg-primary" />
            ) : null}
          </button>
          {setup?.canManageOrganization ? (
            <button
              type="button"
              role="tab"
              aria-selected={scope === "organization"}
              className="relative h-11 px-3 text-xs font-medium text-muted-foreground hover:text-foreground aria-selected:text-foreground"
              onClick={() => {
                setScope("organization")
                returnToList()
              }}
            >
              Organization
              {scope === "organization" ? (
                <span className="absolute inset-x-2 bottom-0 h-px bg-primary" />
              ) : null}
            </button>
          ) : null}
        </div>

        {flow === "list" ? (
          <section aria-label="Connected AI providers">
            {connections.length === 0 ? (
              <div className="border-b py-8">
                <p className="text-sm font-medium">No providers connected</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {scope === "organization"
                    ? "Add a provider for everyone in this Organization."
                    : "Add a provider for your own Workspace activity."}
                </p>
              </div>
            ) : (
              connections.map((connection) => (
                <div
                  key={connection.providerId}
                  className="flex flex-col gap-4 border-b py-5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-status-live" />
                      <h2 className="text-sm font-medium">
                        {providerName(connection.providerId)}
                      </h2>
                    </div>
                    <p className="mt-1 pl-3.5 text-[10px] text-muted-foreground">
                      {connection.availableModelCount}{" "}
                      {connection.availableModelCount === 1
                        ? "model"
                        : "models"}{" "}
                      available
                    </p>
                    <p className="mt-0.5 pl-3.5 text-[10px] text-muted-foreground">
                      {authMethodName(connection.authMethod)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 pl-3.5 sm:pl-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reconnect(connection.providerId)}
                    >
                      Reconnect
                    </Button>
                  </div>
                </div>
              ))
            )}
            {error ? (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {scope === "organization" && setup?.organizationModels.length ? (
              <div className="mt-6 grid max-w-lg gap-2">
                <Label htmlFor="organization-default-model">
                  Organization default model
                </Label>
                <p className="text-xs leading-5 text-muted-foreground">
                  Used when a member has not chosen a personal default.
                </p>
                <select
                  id="organization-default-model"
                  className="h-10 rounded-[8px] border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  disabled={defaultPending}
                  value={
                    setup.organizationDefault
                      ? encodeModelOption(setup.organizationDefault)
                      : ""
                  }
                  onChange={async (event) => {
                    const model = decodeModelOption(event.target.value)
                    if (!model) return
                    setDefaultPending(true)
                    setError(null)
                    try {
                      await saveDefaultModel({
                        data: {
                          organizationId,
                          scope: "organization",
                          providerId: model.providerId,
                          modelId: model.modelId,
                        },
                      })
                      await router.invalidate()
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Could not save the Organization default model"
                      )
                    } finally {
                      setDefaultPending(false)
                    }
                  }}
                >
                  {setup.organizationModels.map((model) => (
                    <option
                      key={`${model.providerId}/${model.modelId}`}
                      value={encodeModelOption(model)}
                    >
                      {model.providerName} · {model.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </section>
        ) : flow === "choose" ? (
          <section className="py-6">
            <h2 className="text-sm font-medium">Choose a provider</h2>
            <div className="mt-4 border-y">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 border-b px-1 py-4 text-left hover:bg-sidebar/45 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => setFlow("openai")}
              >
                <span>
                  <span className="block text-sm font-medium">OpenAI</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Connect a Codex subscription
                  </span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 px-1 py-4 text-left hover:bg-sidebar/45 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => setFlow("key")}
              >
                <span>
                  <span className="block text-sm font-medium">
                    OpenCode Zen
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Connect with an API key
                  </span>
                </span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </button>
            </div>
          </section>
        ) : flow === "openai" ? (
          <section className="py-6">
            <h2 className="text-sm font-medium">Connect OpenAI</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Authorize your Codex subscription. Sylph will discover the models
              available to this connection.
            </p>
            {error ? (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              className="mt-5"
              onClick={handleSubscription}
              disabled={pending}
            >
              {pending ? <LoaderCircle className="animate-spin" /> : null}{" "}
              Continue to OpenAI
            </Button>
            <a
              href="https://opencode.ai/docs/providers/#openai"
              target="_blank"
              rel="noreferrer"
              className="ml-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Connection help <ExternalLink className="size-3" />
            </a>
          </section>
        ) : flow === "subscription" && attempt ? (
          <section className="py-6">
            <h2 className="text-sm font-medium">Authorize OpenAI</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Enter this code on the OpenAI authorization page. Sylph will
              finish the connection automatically.
            </p>
            <p className="mt-5 border-y py-4 font-mono text-sm leading-6">
              {attempt.instructions}
            </p>
            <Button
              nativeButton={false}
              className="mt-5"
              render={<a href={attempt.url} target="_blank" rel="noreferrer" />}
            >
              Open OpenAI authorization <ExternalLink />
            </Button>
            <span className="ml-4 inline-flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="size-3 animate-spin" /> Waiting
            </span>
            <Button
              className="mt-5 block"
              variant="ghost"
              onClick={handleSubscriptionCancel}
            >
              Cancel authorization
            </Button>
          </section>
        ) : (
          <section className="py-6">
            <h2 className="text-sm font-medium">Connect OpenCode Zen</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Add {scope === "organization" ? "an Organization" : "your"} API
              key. Sylph will discover the models available to this connection.
            </p>
            <form
              className="mt-5 grid max-w-lg gap-5"
              onSubmit={handleApiSetup}
            >
              <div className="grid gap-2">
                <Label htmlFor="api-key">
                  {scope === "organization" ? "Organization" : "Personal"}
                  {" API key"}
                </Label>
                <Input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="off"
                  placeholder="opk_…"
                  autoFocus
                  required
                />
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFlow("choose")}
                >
                  Back
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <LoaderCircle className="animate-spin" /> : null}
                  Connect provider
                </Button>
              </div>
            </form>
          </section>
        )}

        {flow === "list" ? (
          <section className="mt-10 border-t pt-6" aria-labelledby="members">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <h2 id="members" className="text-sm font-medium">
                  Members
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Admins manage shared connections. Users manage their own.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {setup?.members.length ?? 0}
              </span>
            </div>
            <form
              className="mt-5 grid gap-3 border-y py-5 sm:grid-cols-[minmax(0,1fr)_auto]"
              onSubmit={handleInvite}
            >
              <div className="grid gap-2">
                <Label htmlFor="invite-email">Invite by email</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  placeholder="teammate@example.com"
                  required
                />
              </div>
              <Button
                className="self-end"
                type="submit"
                disabled={invitePending}
              >
                {invitePending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <MailPlus />
                )}
                Create invitation
              </Button>
              {inviteError ? (
                <p
                  role="alert"
                  className="text-sm text-destructive sm:col-span-2"
                >
                  {inviteError}
                </p>
              ) : null}
              {invitationUrl ? (
                <div className="grid gap-2 sm:col-span-2">
                  <p className="text-xs leading-5 text-muted-foreground">
                    Send this private link to the invited address. It expires in
                    48 hours.
                  </p>
                  <div className="flex min-w-0 items-center gap-2">
                    <Input
                      readOnly
                      value={invitationUrl}
                      className="font-mono text-[10px]"
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label="Copy invitation link"
                      onClick={() =>
                        navigator.clipboard.writeText(invitationUrl)
                      }
                    >
                      <Copy />
                    </Button>
                  </div>
                </div>
              ) : null}
            </form>
            <div className="mt-4 divide-y border-y">
              {setup?.members.map((member) => (
                <div
                  key={member.id}
                  className="flex min-w-0 items-center gap-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {member.name}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {member.email}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {isOrganizationAdminRole(member.role) ? "Admin" : "User"}
                  </span>
                </div>
              ))}
            </div>
            {setup?.invitations.some(
              (invitation) => invitation.status === "pending"
            ) ? (
              <div className="mt-8">
                <h3 className="text-sm font-medium">Pending invitations</h3>
                <div className="mt-3 divide-y border-y">
                  {setup.invitations
                    .filter((invitation) => invitation.status === "pending")
                    .map((invitation) => (
                      <div
                        key={invitation.id}
                        className="flex items-center gap-4 py-3 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {invitation.email}
                        </span>
                        <span className="text-muted-foreground">User</span>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Copy invitation link for ${invitation.email}`}
                          onClick={() =>
                            navigator.clipboard.writeText(
                              new URL(
                                `/invite/${encodeURIComponent(invitation.id)}`,
                                window.location.origin
                              ).toString()
                            )
                          }
                        >
                          <Copy />
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </AppShell>
  )
}

const isOrganizationAdminRole = (role: string) =>
  role === "owner" || role === "admin"
