"use client"

import { Button } from "@workspace/ui/components/button"
import { Check, ChevronRight, Circle, X } from "lucide-react"
import { useEffect, useState } from "react"

import { getOnboardingState, type OnboardingStatus } from "@/lib/onboarding"

type OnboardingGuideProps = {
  force?: boolean
  hasPersonalProvider: boolean
  organizations: ReadonlyArray<{ id: string; slug: string }>
  projects: ReadonlyArray<{
    id: string
    organizationId: string
    organizationSlug: string
    slug: string
  }>
  providerOrganizationIds: ReadonlyArray<string>
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
  hasPersonalProvider,
  organizations,
  projects,
  providerOrganizationIds,
  userId,
  workspaces,
}: OnboardingGuideProps) {
  const [visible, setVisible] = useState(force)
  const state = getOnboardingState({
    organizations,
    projects,
    workspaces,
    providerOrganizationIds,
    hasPersonalProvider,
  })

  useEffect(() => {
    if (force) {
      setVisible(true)
      return
    }

    try {
      setVisible(
        window.localStorage.getItem(storageKey(userId)) !== "dismissed"
      )
    } catch {
      setVisible(true)
    }
  }, [force, userId])

  if (!visible) return null

  const organization = state.organization
  const project = state.project
  const workspace = state.workspace
  const workspaceHref =
    organization && project && workspace
      ? `/organizations/${encodeURIComponent(project.organizationSlug)}/projects/${encodeURIComponent(project.slug)}/workspaces/${encodeURIComponent(workspace.id)}?onboarding=1`
      : null
  const steps = [
    {
      title: "Create an Organization",
      body: "Give Repositories, Workspaces, and shared connections a home.",
      href: "/organizations/new?onboarding=1",
      action: "Create Organization",
    },
    {
      title: "Connect an OpenCode provider",
      body: "Choose a Codex subscription or an OpenCode Zen API key.",
      href: organization
        ? `/organizations/${encodeURIComponent(organization.slug)}/settings?onboarding=1`
        : null,
      action: "Connect provider",
    },
    {
      title: "Create your first Workspace",
      body: "Create a Project and Sylph will open its first durable Workspace.",
      href: organization
        ? `/organizations/${encodeURIComponent(organization.slug)}/projects/new?onboarding=1`
        : null,
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
  }

  return (
    <section className="mb-9 border-y" aria-labelledby="onboarding-title">
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
          <Button
            aria-label="Dismiss getting started"
            size="icon-xs"
            variant="ghost"
            onClick={dismiss}
          >
            <X />
          </Button>
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
