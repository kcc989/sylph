import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  IssueId,
  ProjectId,
  WorkspaceId,
  type SearchResult,
} from "@workspace/domain"
import { useState, type ComponentProps } from "react"

import { CommandPalette } from "@workspace/ui/components/command-palette"
import type { CommandItem, RecentItem } from "@workspace/ui/lib/command-palette"

const commands: CommandItem[] = [
  {
    kind: "command",
    id: "projects",
    label: "Projects",
    keywords: ["home", "search"],
    icon: "home",
    action: { type: "navigate", destination: { type: "home" } },
  },
  {
    kind: "command",
    id: "new-project",
    label: "New Project",
    icon: "new",
    action: { type: "navigate", destination: { type: "new-project" } },
  },
  {
    kind: "command",
    id: "settings",
    label: "User settings",
    icon: "settings",
    action: { type: "navigate", destination: { type: "user-settings" } },
  },
]

const recent: RecentItem[] = [
  {
    kind: "recent",
    id: "workspace:sylph:workspace-1",
    label: "Search functionality",
    description: "Sylph",
    icon: "workspace",
    destination: {
      type: "workspace",
      projectSlug: "sylph",
      workspaceId: "workspace-1",
    },
  },
]

const results: SearchResult[] = [
  {
    kind: "project",
    id: ProjectId.make("project-1"),
    name: "Sylph",
    slug: "sylph",
  },
  {
    kind: "workspace",
    id: WorkspaceId.make("workspace-1"),
    projectId: ProjectId.make("project-1"),
    projectSlug: "sylph",
    projectName: "Sylph",
    title: "Search functionality",
    status: "ready",
  },
  {
    kind: "workspace",
    id: WorkspaceId.make("workspace-2"),
    projectId: ProjectId.make("project-1"),
    projectSlug: "sylph",
    projectName: "Sylph",
    title: "Search exploration",
    status: "archived",
  },
  {
    kind: "issue",
    id: IssueId.make("issue-1"),
    projectId: ProjectId.make("project-1"),
    projectSlug: "sylph",
    projectName: "Sylph",
    number: 17,
    title: "Add command palette search",
    status: "open",
  },
]

function PaletteStory(
  props: Omit<
    ComponentProps<typeof CommandPalette>,
    "onOpenChange" | "onQueryChange" | "onSelect"
  >
) {
  const [open, setOpen] = useState(props.open)
  const [query, setQuery] = useState(props.query)
  return (
    <CommandPalette
      {...props}
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      onSelect={() => undefined}
    />
  )
}

const meta = {
  title: "Workspace/Command palette",
  component: CommandPalette,
  render: (args) => <PaletteStory {...args} />,
  args: {
    open: true,
    query: "",
    loading: false,
    commands,
    results: [],
    recent,
    onOpenChange: () => undefined,
    onQueryChange: () => undefined,
    onSelect: () => undefined,
  },
} satisfies Meta<typeof CommandPalette>

export default meta
type Story = StoryObj<typeof meta>

export const EmptyQuery: Story = {}

export const SearchResults: Story = {
  args: { query: "search", results },
}

export const Loading: Story = {
  args: { query: "search", loading: true },
}

export const NoResults: Story = {
  args: { query: "unfindable", recent: [] },
}

export const ServerFailure: Story = {
  args: {
    query: "search",
    error: "Search is unavailable. Try again.",
    recent: [],
  },
}
