import { describe, expect, test } from "bun:test"

import { getOnboardingState } from "./onboarding"

const organization = { id: "org-1", slug: "acme" }
const project = {
  id: "project-1",
  organizationId: organization.id,
  organizationSlug: organization.slug,
  slug: "weather",
}
const workspace = { id: "workspace-1", projectId: project.id }

describe("getOnboardingState", () => {
  test("starts with Organization creation", () => {
    const state = getOnboardingState({
      organizations: [],
      projects: [],
      workspaces: [],
      providerOrganizationIds: [],
      hasPersonalProvider: false,
    })

    expect(state.completedCount).toBe(0)
    expect(state.providerConnected).toBe(false)
    expect(state.statuses).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ])
  })

  test("accepts a personal Provider connection for the Organization", () => {
    const state = getOnboardingState({
      organizations: [organization],
      projects: [],
      workspaces: [],
      providerOrganizationIds: [],
      hasPersonalProvider: true,
    })

    expect(state.completedCount).toBe(2)
    expect(state.providerConnected).toBe(true)
    expect(state.statuses).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming",
    ])
  })

  test("keeps provider connection current even when legacy Projects exist", () => {
    const state = getOnboardingState({
      organizations: [organization],
      projects: [project],
      workspaces: [workspace],
      providerOrganizationIds: [],
      hasPersonalProvider: false,
    })

    expect(state.providerConnected).toBe(false)
    expect(state.completedCount).toBe(1)
    expect(state.statuses).toEqual([
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ])
  })

  test("keeps the pull request milestone current after Workspace creation", () => {
    const state = getOnboardingState({
      organizations: [organization],
      projects: [project],
      workspaces: [workspace],
      providerOrganizationIds: [organization.id],
      hasPersonalProvider: false,
    })

    expect(state.completedCount).toBe(3)
    expect(state.workspace).toEqual(workspace)
    expect(state.statuses).toEqual([
      "complete",
      "complete",
      "complete",
      "current",
    ])
  })
})
