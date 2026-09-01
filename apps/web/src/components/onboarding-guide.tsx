"use client"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Check, ChevronRight, Circle, X } from "lucide-react"
import { useEffect, useState } from "react"

import { getOnboardingState, type OnboardingStatus } from "@/lib/onboarding"

type OnboardingGuideProps = {
  force?: boolean
  focused?: boolean
  hasPersonalProvider: boolean
  organizations: ReadonlyArray<{ id: string }>
  projects: ReadonlyArray<{
    id: string
    organizationId: string
    slug: string
  }>
  providerOrganizationIds: ReadonlyArray<string>
  onVisibilityChange?: (visible: boolean) => void
  required?: boolean
  userId: string
  workspaces: ReadonlyArray<{ id: string; projectId: string }>
}

const storageKey = (userId: string) => `sylph:onboarding:${userId}`

const StepIcon = ({ status }: { status: OnboardingStatus }) =>
  status === "complete" ? (
    <span className="grid size-6 place-items-center rounded-full bg-status-live/12 text-status-live">
      <Check className="size-3.5" />
    </span>
  ) : (
    <span className="grid size-6 place-items-center rounded-full border text-muted-foreground">
      <Circle className="size-2.5 fill-current" />
    </span>
  )

export function OnboardingGuide({
  force = false,
  focused = false,
  hasPersonalProvider,
  organizations,
  projects,
  providerOrganizationIds,
  onVisibilityChange,
  required = false,
  userId,
  workspaces,
}: OnboardingGuideProps) {
  const [visible, setVisible] = useState(force || required)
  const state = getOnboardingState({
    organizations,
    projects,
    workspaces,
    providerOrganizationIds,
    hasPersonalProvider,
  })

  useEffect(() => {
    if (force || required) {
      setVisible(true)
      onVisibilityChange?.(true)
      return
    }

    try {
      const nextVisible =
        window.localStorage.getItem(storageKey(userId)) !== "dismissed"
      setVisible(nextVisible)
      onVisibilityChange?.(nextVisible)
    } catch {
      setVisible(true)
      onVisibilityChange?.(true)
    }
  }, [force, onVisibilityChange, required, userId])

  if (!visible) return null

  const project = state.project
  const workspace = state.workspace
  const workspaceHref =
    project && workspace
      ? `/projects/${encodeURIComponent(project.slug)}/workspaces/${encodeURIComponent(workspace.id)}?onboarding=1`
      : null
  const steps = [
    {
      title: "Claim the Installation",
      body: "Create the default Organization and establish its first Admin.",
      href: "/setup?onboarding=1",
      action: "Claim Installation",
    },
    {
      title: "Connect an AI provider",
      body: "Connect a Codex subscription or API key before creating a Project or Workspace.",
      href: state.organization ? "/admin?onboarding=1" : null,
      action: "Connect provider",
    },
    {
      title: "Create your first Workspace",
      body: "Create a Project and Sylph will open its first durable Workspace.",
      href: state.organization ? "/projects/new?onboarding=1" : null,
      action: "Create Workspace",
    },
    {
      title: "Land your first pull request",
      body: "Ask for a small change, inspect the proof, and take it through review.",
      href: workspaceHref,
      action: "Start first change",
    },
  ]
  const dismiss = () => {
    try {
      window.localStorage.setItem(storageKey(userId), "dismissed")
    } catch {
      setVisible(false)
      return
    }
    setVisible(false)
    onVisibilityChange?.(false)
  }

  return (
    <section
      className={cn("border-y", !focused && "mb-9")}
      aria-labelledby="onboarding-title"
    >
      <header className="flex items-start gap-5 border-b py-5">
        <div className="min-w-0 flex-1">
          <h2
            id="onboarding-title"
            className="text-lg font-semibold tracking-[-0.025em]"
          >
            Ship your first change with Sylph
          </h2>
          <p className="mt-1.5 max-w-[68ch] text-xs leading-5 text-muted-foreground">
            A clear path from a new account to a reviewed change. Initial setup
            takes only a few minutes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {state.completedCount}/4
          </span>
          {!required ? (
            <Button
              aria-label="Dismiss getting started"
              size="icon-xs"
              variant="ghost"
              onClick={dismiss}
            >
              <X />
            </Button>
          ) : null}
        </div>
      </header>
      <ol className="divide-y">
        {steps.map((step, index) => {
          const status = state.statuses[index]
          const current = status === "current"

          return (
            <li
              key={step.title}
              className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[24px_minmax(0,1fr)_auto] sm:items-center"
            >
              <StepIcon status={status} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {step.body}
                </p>
              </div>
              {current && step.href ? (
                <Button
                  nativeButton={false}
                  className="col-start-2 w-fit sm:col-start-3"
                  size="sm"
                  render={<a href={step.href} />}
                >
                  {step.action} <ChevronRight />
                </Button>
              ) : null}
            </li>
          )
        })}
      </ol>
      {state.completedCount === 3 ? (
        <p className="border-t py-3 text-xs leading-5 text-muted-foreground">
          Workspace creation is ready. Pull-request publishing still needs the
          Workspace checkpoint and Repository merge path before Sylph can mark
          this last step complete.
        </p>
      ) : null}
    </section>
  )
}
