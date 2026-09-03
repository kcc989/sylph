import { describe, expect, test } from "bun:test"
import { IssueId, ProjectId, WorkspaceId } from "@workspace/domain"

import { commandPaletteDestination } from "@/lib/command-palette-navigation"

describe("commandPaletteDestination", () => {
  test("maps Projects to Project settings", () => {
    expect(
      commandPaletteDestination({
        kind: "project",
        id: ProjectId.make("project"),
        name: "Sylph",
        slug: "sylph",
      })
    ).toEqual({
      to: "/projects/$projectSlug/settings",
      params: { projectSlug: "sylph" },
    })
  })

  test("maps Workspaces and Issues to their detail routes", () => {
    expect(
      commandPaletteDestination({
        kind: "workspace",
        id: WorkspaceId.make("workspace"),
        projectId: ProjectId.make("project"),
        projectSlug: "sylph",
        projectName: "Sylph",
        title: "Search",
        status: "ready",
      })
    ).toEqual({
      to: "/projects/$projectSlug/workspaces/$workspaceId",
      params: { projectSlug: "sylph", workspaceId: "workspace" },
    })
    expect(
      commandPaletteDestination({
        kind: "issue",
        id: IssueId.make("issue"),
        projectId: ProjectId.make("project"),
        projectSlug: "sylph",
        projectName: "Sylph",
        number: 17,
        title: "Command palette",
        status: "open",
      })
    ).toEqual({
      to: "/projects/$projectSlug/issues/$issueNumber",
      params: { projectSlug: "sylph", issueNumber: "17" },
    })
  })

  test("maps navigation commands and leaves actions unmapped", () => {
    expect(
      commandPaletteDestination({
        kind: "command",
        id: "skills",
        label: "Skills",
        icon: "skills",
        action: { type: "navigate", destination: { type: "skills" } },
      })
    ).toEqual({ to: "/skills" })
    expect(
      commandPaletteDestination({
        kind: "command",
        id: "sign-out",
        label: "Sign out",
        icon: "sign-out",
        action: { type: "sign-out" },
      })
    ).toBeNull()
  })
})
