import { Link, useRouter } from "@tanstack/react-router"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  ProductRail,
  ProjectNavigation,
  ShellRoot,
  type ProductRailItem,
} from "@workspace/ui/components/shell"
import {
  Blocks,
  CircleHelp,
  House,
  LogOut,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import type { ReactNode } from "react"
import { CommandPalette } from "@/components/command-palette"
import { authClient } from "@/lib/auth-client"

type Organization = {
  id: string
  name: string
  slug: string
}

type Project = {
  id: string
  name: string
  slug: string
  organizationId: string
}

type Workspace = {
  id: string
  projectId: string
  title: string
  status: string
}

export type AppShellDashboard = {
  installation: { canAdminister: boolean }
  organizations: ReadonlyArray<Organization>
  projects: ReadonlyArray<Project>
  providerConnected: boolean
  workspaces: ReadonlyArray<Workspace>
}

type AppShellProps = {
  active: "home" | "skills" | "admin" | "settings"
  activeWorkspaceId?: string
  children: ReactNode
  dashboard: AppShellDashboard
  showHeader?: boolean
  topbar?: ReactNode
}

export function SylphMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 20 20"
    >
      <path d="M10 1.5 14.25 6 10 10.5 5.75 6 10 1.5Z" fill="currentColor" />
      <path
        d="m5.2 8.1 3.4 3.6-3.4 3.6-3.4-3.6 3.4-3.6Z"
        fill="currentColor"
        opacity=".72"
      />
      <path
        d="m14.8 8.1 3.4 3.6-3.4 3.6-3.4-3.6 3.4-3.6Z"
        fill="currentColor"
        opacity=".72"
      />
      <path
        d="m10 13 3 3.1-3 2.4-3-2.4 3-3.1Z"
        fill="currentColor"
        opacity=".45"
      />
    </svg>
  )
}

export function AppShell({
  active,
  activeWorkspaceId,
  children,
  dashboard,
  showHeader,
  topbar,
}: AppShellProps) {
  const router = useRouter()
  const productItems: ProductRailItem[] = [
    {
      icon: House,
      label: "Projects",
      render: <Link to="/" />,
      selected: active === "home",
    },
    {
      icon: Blocks,
      label: "Skills",
      render: <Link to="/skills" />,
      selected: active === "skills",
    },
    {
      icon: Search,
      label: "Search",
      onClick: () => window.dispatchEvent(new Event("sylph:open-search")),
    },
  ]

  if (dashboard.installation.canAdminister) {
    productItems.push({
      icon: ShieldCheck,
      label: "Administration",
      render: <Link to="/admin" />,
      selected: active === "admin",
    })
  }

  const projects = dashboard.projects.map((project) => {
    const basePath = `/projects/${encodeURIComponent(project.slug)}`
    return {
      href: `${basePath}/settings`,
      id: project.id,
      issuesHref: `${basePath}/issues`,
      name: project.name,
      newWorkspaceHref: dashboard.providerConnected
        ? `${basePath}/workspaces/new`
        : undefined,
      settingsHref: `${basePath}/settings`,
      workspaces: dashboard.workspaces
        .filter((workspace) => workspace.projectId === project.id)
        .map((workspace) => ({
          active: workspace.id === activeWorkspaceId,
          href: `${basePath}/workspaces/${encodeURIComponent(workspace.id)}`,
          id: workspace.id,
          status: workspace.status,
          title: workspace.title,
        })),
    }
  })

  const account = (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open account menu"
        className="grid size-7 place-items-center rounded-full border border-white/10 bg-white/[.06] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <UserRound className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44" side="right">
        <DropdownMenuItem nativeButton={false} render={<Link to="/settings" />}>
          <Settings2 /> User settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut()
            await router.invalidate()
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <CommandPalette dashboard={dashboard}>
      {({ openSearch }) => (
        <ShellRoot
          initiallyCollapsed={dashboard.projects.length === 0}
          navigation={
            <ProjectNavigation
              organizationName={dashboard.organizations[0]?.name ?? "Projects"}
              projects={projects}
            />
          }
          productRail={
            <ProductRail
              account={account}
              brand={
                <Link
                  aria-label="Sylph"
                  className="grid size-7 place-items-center rounded-[6px] border border-white/10 bg-primary text-primary-foreground"
                  to="/"
                >
                  <SylphMark className="size-4" />
                </Link>
              }
              items={productItems.map((item) =>
                item.label === "Search"
                  ? { ...item, onClick: openSearch }
                  : item
              )}
              secondaryItems={[
                {
                  icon: CircleHelp,
                  label: "Getting started",
                  render: <Link search={{ onboarding: true }} to="/" />,
                },
                {
                  icon: Settings2,
                  label: "User settings",
                  render: <Link to="/settings" />,
                  selected: active === "settings",
                },
              ]}
            />
          }
          showHeader={showHeader}
          topbar={topbar}
        >
          {children}
        </ShellRoot>
      )}
    </CommandPalette>
  )
}
