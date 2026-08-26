import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import type { OpenCodeSubscriptionModel } from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"

import {
  cancelOpenCodeSubscription,
  getDashboard,
  getOpenCodeSubscriptionStatus,
  getOpenCodeSetup,
  saveOpenCodeSetup,
  startOpenCodeSubscription,
} from "@/lib/workspaces"

export const Route = createFileRoute("/organizations/$organizationId/settings")(
  {
    loader: async ({ params }) => {
      const [dashboard, setup] = await Promise.all([
        getDashboard(),
        getOpenCodeSetup({ data: { organizationId: params.organizationId } }),
      ])

      return {
        organization:
          dashboard.organizations.find(
            (organization) => organization.id === params.organizationId
          ) ?? null,
        setup,
      }
    },
    component: OrganizationSettingsScreen,
  }
)

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

function OrganizationSettingsScreen() {
  const { organizationId } = Route.useParams()
  const { organization, setup } = Route.useLoaderData()
  const router = useRouter()
  const saveSetup = useServerFn(saveOpenCodeSetup)
  const startSubscription = useServerFn(startOpenCodeSubscription)
  const subscriptionStatus = useServerFn(getOpenCodeSubscriptionStatus)
  const cancelSubscription = useServerFn(cancelOpenCodeSubscription)
  const [step, setStep] = useState<"intro" | "subscription" | "key" | "model">(
    "intro"
  )
  const [apiKey, setApiKey] = useState("")
  const [apiModelId, setApiModelId] = useState(
    setup?.authMethod === "api-key"
      ? setup.modelId
      : "nemotron-3.5-lightning-free"
  )
  const [subscriptionModelId, setSubscriptionModelId] = useState(
    isSubscriptionModel(setup?.modelId) ? setup.modelId : "gpt-5.6-sol"
  )
  const [editing, setEditing] = useState(!setup?.providerId)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<{
    attemptId: string
    url: string
    instructions: string
    expiresAt: number
  } | null>(null)

  useEffect(() => {
    if (step !== "subscription" || !attempt) return

    let active = true
    const poll = async () => {
      try {
        const result = await subscriptionStatus({
          data: {
            organizationId,
            attemptId: attempt.attemptId,
            modelId: subscriptionModelId,
          },
        })

        if (!active) return

        if (result.status === "complete") {
          setEditing(false)
          setStep("intro")
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
          setStep("intro")
          return
        }

        window.setTimeout(poll, 2_000)
      } catch (cause) {
        if (!active) return
        setError(
          cause instanceof Error ? cause.message : "Could not check sign-in"
        )
        setAttempt(null)
        setStep("intro")
      }
    }

    const timer = window.setTimeout(poll, 1_000)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [
    attempt,
    organizationId,
    router,
    step,
    subscriptionModelId,
    subscriptionStatus,
  ])

  if (!organization) {
    return (
      <main className="dark grid min-h-svh place-items-center bg-[var(--sylph-ink)] px-5 text-foreground">
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

  const handleSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (step === "key") {
      setStep("model")
      return
    }

    setPending(true)
    setError(null)

    try {
      await saveSetup({
        data: {
          organizationId,
          providerId: "opencode",
          modelId: apiModelId,
          apiKey,
        },
      })
      setEditing(false)
      setStep("intro")
      setApiKey("")
      await router.invalidate()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "OpenCode could not connect"
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
        data: { organizationId, modelId: subscriptionModelId },
      })
      setAttempt(nextAttempt)
      setStep("subscription")
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
    setStep("intro")

    if (!currentAttempt) return

    try {
      await cancelSubscription({
        data: {
          organizationId,
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

  return (
    <main className="dark min-h-svh bg-[var(--sylph-ink)] text-foreground">
      <header className="flex h-12 items-center border-b px-4 sm:px-6">
        <Link
          to="/organizations"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Organizations
        </Link>
        <span className="mx-2 text-muted-foreground/40">/</span>
        <span className="truncate text-xs font-medium">
          {organization.name}
        </span>
        <Button
          nativeButton={false}
          className="ml-auto"
          size="sm"
          render={
            <a
              href={`/organizations/${encodeURIComponent(organizationId)}/projects/new`}
            />
          }
        >
          <Plus /> New Project
        </Button>
      </header>

      <div className="mx-auto grid min-h-[calc(100svh-3rem)] max-w-5xl lg:grid-cols-[0.72fr_1.28fr]">
        <aside className="border-b px-6 py-8 lg:border-r lg:border-b-0 lg:px-8 lg:py-12">
          <div className="flex items-center gap-2.5">
            <Building2 className="size-4 text-[#ef9b7e]" />
            <h1 className="text-sm font-semibold">{organization.name}</h1>
          </div>
          <p className="mt-3 pl-6 font-mono text-[10px] text-muted-foreground">
            Organization · {organization.slug}
          </p>
          <p className="mt-9 border-t pt-6 text-xs leading-5 text-muted-foreground">
            The OpenCode connection is shared by every Project and Workspace
            this Organization contains. Credentials are encrypted at rest and
            are never returned to the browser.
          </p>
        </aside>

        <section className="flex items-start justify-center px-6 py-8 lg:px-12 lg:py-12">
          <div className="w-full max-w-lg">
            {!editing && setup?.providerId && setup.modelId ? (
              <div>
                <div className="grid size-9 place-items-center rounded-[7px] bg-[var(--sylph-live)]/12 text-[var(--sylph-live)]">
                  <Check className="size-4" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">
                  OpenCode connected
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  New and restarted Workspaces in {organization.name} use this
                  Organization connection.
                </p>
                <div className="mt-8 flex items-center justify-between border-y py-4">
                  <div>
                    <p className="text-xs font-medium">Default model</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {setup.providerId}/{setup.modelId}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {setup.authMethod === "chatgpt-subscription"
                        ? "Codex subscription"
                        : "API key"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(true)}
                  >
                    Replace connection
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <div className="grid size-9 place-items-center rounded-[7px] bg-[#ef9b7e]/12 text-[#f2a68d]">
                  <KeyRound className="size-4" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">
                  {step === "intro"
                    ? "Connect OpenCode"
                    : step === "subscription"
                      ? "Authorize your subscription"
                      : step === "key"
                        ? "Add the Organization key"
                        : "Choose the default model"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step === "intro"
                    ? `Connect ${organization.name} once so its members can start durable coding Workspaces with a Codex subscription or API key.`
                    : step === "subscription"
                      ? "Open the OpenAI authorization page, enter the code shown there, and return here. Sylph will finish automatically."
                      : step === "key"
                        ? "Use an OpenCode Zen API key authorized for this Organization."
                        : "Every new OpenCode session in this Organization starts with this model."}
                </p>
                {step === "intro" ? (
                  <div className="mt-8 grid gap-3">
                    <fieldset className="mb-2 grid gap-1.5">
                      <legend className="mb-2 text-xs font-medium">
                        Codex subscription model
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
                    <Button onClick={handleSubscription} disabled={pending}>
                      {pending ? (
                        <LoaderCircle className="animate-spin" />
                      ) : null}
                      Connect Codex subscription
                    </Button>
                    <Button variant="outline" onClick={() => setStep("key")}>
                      Use an API key <ArrowRight />
                    </Button>
                    <a
                      href="https://opencode.ai/docs/providers/#openai"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      How OpenCode connects to OpenAI{" "}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                ) : step === "subscription" && attempt ? (
                  <div className="mt-8">
                    <div className="border-y py-5">
                      <p className="text-xs font-medium">OpenAI sign-in</p>
                      <p className="mt-2 font-mono text-sm leading-6 text-foreground">
                        {attempt.instructions}
                      </p>
                    </div>
                    <Button
                      nativeButton={false}
                      className="mt-5 w-full"
                      render={
                        <a
                          href={attempt.url}
                          target="_blank"
                          rel="noreferrer"
                        />
                      }
                    >
                      Open OpenAI authorization <ExternalLink />
                    </Button>
                    <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                      <RefreshCw className="size-3 animate-spin" /> Waiting for
                      authorization
                    </p>
                    <Button
                      className="mt-3 w-full"
                      variant="ghost"
                      onClick={handleSubscriptionCancel}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <form className="mt-8 grid gap-5" onSubmit={handleSetup}>
                    {step === "key" ? (
                      <div className="grid gap-2">
                        <Label htmlFor="api-key">Organization API key</Label>
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
                        <Label htmlFor="model-id">OpenCode model</Label>
                        <div className="flex rounded-[8px] border bg-sidebar/45 px-3 focus-within:ring-2 focus-within:ring-ring/50">
                          <span className="self-center font-mono text-xs text-muted-foreground">
                            opencode/
                          </span>
                          <Input
                            id="model-id"
                            value={apiModelId}
                            onChange={(event) =>
                              setApiModelId(event.target.value)
                            }
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
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          setStep(step === "model" ? "key" : "intro")
                        }
                      >
                        Back
                      </Button>
                      <Button type="submit" disabled={pending}>
                        {pending ? (
                          <LoaderCircle className="animate-spin" />
                        ) : null}
                        {step === "model" ? "Connect" : "Continue"}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
