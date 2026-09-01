export type OnboardingStatus = "complete" | "current" | "upcoming"

type OnboardingSearchInput = {
  onboarding?: string | boolean
}

export const validateOnboardingSearch = (
  search: OnboardingSearchInput
): { onboarding?: true } =>
  search.onboarding === "1" || search.onboarding === true
    ? { onboarding: true }
    : {}

type Organization = {
  id: string
}

type Project = {
  id: string
  organizationId: string
  slug: string
}

type Workspace = {
  id: string
  projectId: string
}

type OnboardingInput = {
  organizations: ReadonlyArray<Organization>
  projects: ReadonlyArray<Project>
  workspaces: ReadonlyArray<Workspace>
  providerOrganizationIds: ReadonlyArray<string>
  hasPersonalProvider: boolean
}

export type OnboardingState = {
  organization: Organization | null
  providerConnected: boolean
  project: Project | null
  workspace: Workspace | null
  completedCount: number
  statuses: readonly [
    OnboardingStatus,
    OnboardingStatus,
    OnboardingStatus,
    OnboardingStatus,
  ]
}

export const getOnboardingState = ({
  organizations,
  projects,
  workspaces,
  providerOrganizationIds,
  hasPersonalProvider,
}: OnboardingInput): OnboardingState => {
  const organization = organizations[0] ?? null
  const providerConnected = Boolean(
    organization &&
    (hasPersonalProvider || providerOrganizationIds.includes(organization.id))
  )
  const project = organization
    ? (projects.find(
        (candidate) => candidate.organizationId === organization.id
      ) ?? null)
    : null
  const workspace = project
    ? (workspaces.find((candidate) => candidate.projectId === project.id) ??
      null)
    : null
  const completed = [
    Boolean(organization),
    providerConnected,
    providerConnected && Boolean(workspace),
  ]
  const completedCount = completed.filter(Boolean).length
  const currentIndex = completed.findIndex((value) => !value)
  const statusAt = (index: number): OnboardingStatus => {
    if (index < completedCount) return "complete"
    if (index === (currentIndex === -1 ? 3 : currentIndex)) return "current"
    return "upcoming"
  }
  const statuses: OnboardingState["statuses"] = [
    statusAt(0),
    statusAt(1),
    statusAt(2),
    statusAt(3),
  ]

  return {
    organization,
    providerConnected,
    project,
    workspace,
    completedCount,
    statuses,
  }
}
