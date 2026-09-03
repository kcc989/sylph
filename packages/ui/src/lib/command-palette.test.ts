import { describe, expect, test } from "bun:test"
import { IssueId, ProjectId, WorkspaceId } from "@workspace/domain"

import {
  filterCommandItems,
  groupSearchResults,
  type CommandItem,
} from "@workspace/ui/lib/command-palette"

const commands: CommandItem[] = [
  {
    kind: "command",
    id: "projects",
    label: "Projects",
    keywords: ["home"],
    icon: "home",
    action: { type: "navigate", destination: { type: "home" } },
  },
  {
    kind: "command",
    id: "settings",
    label: "User settings",
    icon: "settings",
    action: { type: "navigate", destination: { type: "user-settings" } },
  },
]

describe("command palette grouping", () => {
  test("filters commands by labels and keywords", () => {
    expect(filterCommandItems("home", commands).map((item) => item.id)).toEqual(
      ["projects"]
    )
    expect(
      filterCommandItems("settings", commands).map((item) => item.id)
    ).toEqual(["settings"])
  })

  test("groups entity results by kind", () => {
    const grouped = groupSearchResults([
      {
        kind: "project",
        id: ProjectId.make("project"),
        name: "Sylph",
        slug: "sylph",
      },
      {
        kind: "workspace",
        id: WorkspaceId.make("workspace"),
        projectId: ProjectId.make("project"),
        projectSlug: "sylph",
        projectName: "Sylph",
        title: "Search",
        status: "ready",
      },
      {
        kind: "issue",
        id: IssueId.make("issue"),
        projectId: ProjectId.make("project"),
        projectSlug: "sylph",
        projectName: "Sylph",
        number: 1,
        title: "Add search",
        status: "open",
      },
    ])
    expect(grouped.projects).toHaveLength(1)
    expect(grouped.workspaces).toHaveLength(1)
    expect(grouped.issues).toHaveLength(1)
  })
})
