import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import type {
  ConnectionScope,
  OpenCodeSubscriptionModel,
} from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  ArrowRight,
  Check,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"

import { AppShell } from "@/components/app-shell"
import {
  cancelOpenCodeSubscription,
  getDashboard,
  getOpenCodeSubscriptionStatus,
  getOpenCodeSetup,
  saveOpenCodeSetup,
  setDefaultOpenCodeConnection,
  startOpenCodeSubscription,
} from "@/lib/workspaces"

export const Route = createFileRoute(
  "/organizations/$organizationSlug/settings"
)({
  loader: async ({ params }) => {
    const dashboard = await getDashboard()
    const organization =
      dashboard.organizations.find(
        (candidate) => candidate.slug === params.organizationSlug
      ) ?? null
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

const subscriptionModels: ReadonlyArray<{
  id: OpenCodeSubscriptionModel
  name: string
  description: string
}> = [
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Highest capability for complex coding work",
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Balanced intelligence, speed, and cost",
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Fast and economical for everyday tasks",
  },
]

const isSubscriptionModel = (
  modelId: string | null | undefined
): modelId is OpenCodeSubscriptionModel =>
  subscriptionModels.some((model) => model.id === modelId)

const providerName = (providerId: string) =>
  providerId === "openai"
    ? "OpenAI"
    : providerId === "opencode"
      ? "OpenCode Zen"
      : providerId

const authMethodName = (authMethod: string) =>
  authMethod === "chatgpt-subscription" ? "Codex subscription" : "API key"

type SetupFlow = "list" | "choose" | "openai" | "subscription" | "key" | "model"

function OrganizationSettingsScreen() {
  const { dashboard, organization, setup } = Route.useLoaderData()
  const organizationId = organization?.id ?? ""
  const router = useRouter()
  const saveSetup = useServerFn(saveOpenCodeSetup)
  const setDefaultConnection = useServerFn(setDefaultOpenCodeConnection)
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
  const [apiModelId, setApiModelId] = useState(
    connections.find((connection) => connection.providerId === "opencode")
      ?.modelId ?? "nemotron-3.5-lightning-free"
  )
  const [subscriptionModelId, setSubscriptionModelId] = useState(
    (() => {
      const modelId = connections.find(
        (connection) => connection.providerId === "openai"
      )?.modelId
      return isSubscriptionModel(modelId) ? modelId : "gpt-5.6-sol"
    })()
  )
  const [pending, setPending] = useState(false)
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
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
            modelId: subscriptionModelId,
          },
        })

        if (!active) return

        if (result.status === "complete") {
          setFlow("list")
          setAttempt(null)
          await router.invalidate()
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
    router,
    scope,
    subscriptionModelId,
    subscriptionStatus,
  ])

  if (!organization) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Organization unavailable</h1>
          <Button
            nativeButton={false}
            className="mt-5"
            render={<Link to="/organizations" />}
          >
            Return to Organizations
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
    if (flow === "key") {
      setFlow("model")
      return
    }

    setPending(true)
    setError(null)
    try {
      await saveSetup({
        data: {
          organizationId,
          scope,
          providerId: "opencode",
          modelId: apiModelId,
          apiKey,
        },
      })
      returnToList()
      await router.invalidate()
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
        data: { organizationId, scope, modelId: subscriptionModelId },
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
          modelId: subscriptionModelId,
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

  const handleDefault = async (providerId: string) => {
    setPendingProviderId(providerId)
    setError(null)
    try {
      await setDefaultConnection({
        data: { organizationId, scope, providerId },
      })
      await router.invalidate()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not change the default provider"
      )
    } finally {
      setPendingProviderId(null)
    }
  }

  const reconnect = (providerId: string, modelId: string) => {
    setError(null)
    if (providerId === "openai") {
      if (isSubscriptionModel(modelId)) setSubscriptionModelId(modelId)
      setFlow("openai")
      return
    }
    setApiModelId(modelId)
    setFlow("key")
  }

  return (
    <AppShell
      active="organizations"
      dashboard={dashboard}
      organizationSlug={organization.slug}
      topbar={`${organization.name} settings`}
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        <Button
          nativeButton={false}
          className="mb-6"
          size="sm"
          render={
            <a
              href={`/organizations/${encodeURIComponent(organization.slug)}/projects/new`}
            />
          }
        >
          <Plus /> New Project
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
                      {connection.isDefault ? (
                        <span className="inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          <Check className="size-3" /> Default
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 pl-3.5 font-mono text-[10px] text-muted-foreground">
                      {connection.providerId}/{connection.modelId}
                    </p>
                    <p className="mt-0.5 pl-3.5 text-[10px] text-muted-foreground">
                      {authMethodName(connection.authMethod)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 pl-3.5 sm:pl-0">
                    {!connection.isDefault ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pendingProviderId === connection.providerId}
                        onClick={() => handleDefault(connection.providerId)}
                      >
                        {pendingProviderId === connection.providerId ? (
                          <LoaderCircle className="animate-spin" />
                        ) : null}{" "}
                        Make default
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        reconnect(connection.providerId, connection.modelId)
                      }
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
              Choose the default model for this connection, then authorize your
              Codex subscription.
            </p>
            <fieldset className="mt-5 grid gap-1.5">
              <legend className="mb-2 text-xs font-medium">
                Default model
              </legend>
              {subscriptionModels.map((model, index) => (
                <label
                  key={model.id}
                  className="flex cursor-pointer items-center gap-3 rounded-[8px] border px-3 py-2.5 transition-colors hover:bg-sidebar/55 has-checked:border-[#ef9b7e]/70 has-checked:bg-[#ef9b7e]/6"
                >
                  <input
                    type="radio"
                    name="subscription-model"
                    value={model.id}
                    checked={subscriptionModelId === model.id}
                    onChange={() => setSubscriptionModelId(model.id)}
                    className="size-3.5 accent-[#ef9b7e]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-xs font-medium">
                      {model.name}
                      {index === 0 ? (
                        <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                          Default
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                      {model.description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
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
              key and choose the default model.
            </p>
            <form
              className="mt-5 grid max-w-lg gap-5"
              onSubmit={handleApiSetup}
            >
              {flow === "key" ? (
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
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="model-id">Default model</Label>
                  <div className="flex rounded-[8px] border bg-sidebar/45 px-3 focus-within:ring-2 focus-within:ring-ring/50">
                    <span className="self-center font-mono text-xs text-muted-foreground">
                      opencode/
                    </span>
                    <Input
                      id="model-id"
                      value={apiModelId}
                      onChange={(event) => setApiModelId(event.target.value)}
                      className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                      autoFocus
                      required
                    />
                  </div>
                </div>
              )}
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFlow(flow === "model" ? "key" : "choose")}
                >
                  Back
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <LoaderCircle className="animate-spin" /> : null}
                  {flow === "model" ? "Connect provider" : "Continue"}
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
          </section>
        ) : null}
      </div>
    </AppShell>
  )
}

const isOrganizationAdminRole = (role: string) =>
  role === "owner" || role === "admin"
