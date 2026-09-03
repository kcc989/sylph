import type { SearchResult } from "@workspace/domain"
import type {
  CommandItem,
  CommandPaletteDestination,
  RecentItem,
} from "@workspace/ui/lib/command-palette"

export type RouterDestination =
  | { to: "/"; search: { onboarding?: boolean } }
  | { to: "/skills" }
  | { to: "/settings" }
  | { to: "/admin" }
  | { to: "/projects/new"; search: { onboarding?: boolean } }
  | {
      to: "/projects/$projectSlug/settings"
      params: { projectSlug: string }
    }
  | {
      to: "/projects/$projectSlug/issues"
      params: { projectSlug: string }
    }
  | {
      to: "/projects/$projectSlug/issues/$issueNumber"
      params: { projectSlug: string; issueNumber: string }
    }
  | {
      to: "/projects/$projectSlug/workspaces/$workspaceId"
      params: { projectSlug: string; workspaceId: string }
    }

const destinationToRouter = (
  destination: CommandPaletteDestination
): RouterDestination => {
  switch (destination.type) {
    case "home":
      return {
        to: "/",
        search: destination.onboarding ? { onboarding: true } : {},
      }
    case "skills":
      return { to: "/skills" }
    case "user-settings":
      return { to: "/settings" }
    case "admin":
      return { to: "/admin" }
    case "new-project":
      return { to: "/projects/new", search: {} }
    case "project-settings":
      return {
        to: "/projects/$projectSlug/settings",
        params: { projectSlug: destination.projectSlug },
      }
    case "project-issues":
      return {
        to: "/projects/$projectSlug/issues",
        params: { projectSlug: destination.projectSlug },
      }
    case "issue":
      return {
        to: "/projects/$projectSlug/issues/$issueNumber",
        params: {
          projectSlug: destination.projectSlug,
          issueNumber: String(destination.issueNumber),
        },
      }
    case "workspace":
      return {
        to: "/projects/$projectSlug/workspaces/$workspaceId",
        params: {
          projectSlug: destination.projectSlug,
          workspaceId: destination.workspaceId,
        },
      }
  }
}

export const commandPaletteDestination = (
  item: CommandItem | RecentItem | SearchResult
): RouterDestination | null => {
  if (item.kind === "recent") return destinationToRouter(item.destination)
  if (item.kind === "command") {
    return item.action.type === "navigate"
      ? destinationToRouter(item.action.destination)
      : null
  }
  if (item.kind === "project") {
    return destinationToRouter({
      type: "project-settings",
      projectSlug: item.slug,
    })
  }
  if (item.kind === "workspace") {
    return destinationToRouter({
      type: "workspace",
      projectSlug: item.projectSlug,
      workspaceId: item.id,
    })
  }
  return destinationToRouter({
    type: "issue",
    projectSlug: item.projectSlug,
    issueNumber: item.number,
  })
}
