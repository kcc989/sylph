import { Blocks, House, Search } from "lucide-react"
import { createElement } from "react"

import type { NavigationProject, ProductRailItem } from "./index"

export const shellItems: ProductRailItem[] = [
  {
    icon: House,
    label: "Projects",
    render: createElement("a", { href: "#projects" }),
    selected: true,
  },
  {
    icon: Blocks,
    label: "Skills",
    render: createElement("a", { href: "#skills" }),
  },
  { icon: Search, label: "Search" },
]

export const shellProjects: NavigationProject[] = [
  {
    href: "#sylph",
    id: "sylph",
    name: "Sylph",
    newWorkspaceHref: "#new",
    settingsHref: "#settings",
    workspaces: [
      {
        active: true,
        href: "#amber-otter",
        id: "workspace-1",
        status: "running",
        title: "amber-otter",
      },
      {
        href: "#quiet-heron",
        id: "workspace-2",
        status: "ready",
        title: "quiet-heron",
      },
    ],
  },
]
