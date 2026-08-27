import { Link, useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { cn } from "@workspace/ui/lib/utils"
import {
  Blocks,
  CircleAlert,
  CircleDot,
  CircleHelp,
  House,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  UserRound,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  type PanelImperativeHandle,
  useDefaultLayout,
} from "react-resizable-panels"

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
  organizationSlug: string
}

type Workspace = {
  id: string
  projectId: string
  title: string
  status: string
}

type AppShellDashboard = {
  organizations: ReadonlyArray<Organization>
  projects: ReadonlyArray<Project>
  workspaces: ReadonlyArray<Workspace>
}

type AppShellProps = {
  active: "home" | "organizations" | "settings"
  children: ReactNode
  dashboard: AppShellDashboard
  organizationSlug?: string
  topbar?: ReactNode
}

const navigationStorage = {
  getItem: (name: string) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name: string, value: string) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      return
    }
  },
}

export function SylphMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      fill="none"
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

function ProductRail({ active }: { active: AppShellProps["active"] }) {
  const router = useRouter()
  const tools = [
    { label: "Projects", icon: House, href: "/", selected: active === "home" },
    { label: "Search", icon: Search },
    {
      label: "Organizations",
      icon: Blocks,
      href: "/organizations",
      selected: active === "organizations",
    },
  ]

  return (
    <aside
      aria-label="Product navigation"
      className="hidden w-12 shrink-0 flex-col items-center border-r bg-surface-utility py-2.5 md:flex"
    >
      <Link
        to="/"
        aria-label="Sylph"
        className="mb-4 grid size-7 place-items-center rounded-[6px] border border-white/10 bg-primary text-primary-foreground"
      >
        <SylphMark className="size-4" />
      </Link>
      <nav className="grid gap-1" aria-label="Product tools">
        {tools.map(({ label, icon: Icon, href, selected }) =>
          href ? (
            <Button
              key={label}
              nativeButton={false}
              aria-label={label}
              size="icon-sm"
              variant="ghost"
              className={cn(selected && "bg-white/[.07] text-foreground")}
              render={<a href={href} />}
            >
              <Icon />
            </Button>
          ) : (
            <Button
              key={label}
              aria-label={label}
              size="icon-sm"
              variant="ghost"
            >
              <Icon />
            </Button>
          )
        )}
      </nav>
      <div className="mt-auto grid gap-1">
        <Button
          nativeButton={false}
          aria-label="Getting started"
          size="icon-sm"
          variant="ghost"
          render={<a href="/?onboarding=1" />}
        >
          <CircleHelp />
        </Button>
        <Button
          nativeButton={false}
          aria-label="User settings"
          size="icon-sm"
          variant="ghost"
          className={cn(
            active === "settings" && "bg-white/[.07] text-foreground"
          )}
          render={<Link to="/settings" />}
        >
          <Settings2 />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Open account menu"
            className="grid size-7 place-items-center rounded-full border border-white/10 bg-white/[.06] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <UserRound className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-44">
            <DropdownMenuItem
              onClick={() => window.location.assign("/settings")}
            >
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
      </div>
    </aside>
  )
}

function WorkspaceStatus({ status }: { status: string }) {
  if (status === "error") {
    return (
      <CircleAlert
        aria-label="Workspace error"
        className="size-3.5 shrink-0 text-destructive"
      />
    )
  }

  return (
    <CircleDot
      aria-label={`${status} Workspace`}
      className={cn(
        "size-3.5 shrink-0",
        (status === "ready" || status === "running") && "text-status-live"
      )}
    />
  )
}

function ProjectNavigation({
  dashboard,
  mobile,
  onClose,
  organizationSlug,
}: {
  dashboard: AppShellDashboard
  mobile?: boolean
  onClose: () => void
  organizationSlug?: string
}) {
  const organization = dashboard.organizations.find(
    (candidate) => candidate.slug === organizationSlug
  )
  const projects = organization
    ? dashboard.projects.filter(
        (project) => project.organizationId === organization.id
      )
    : dashboard.projects

  return (
    <aside
      aria-label="Project and Workspace navigation"
      aria-modal={mobile || undefined}
      role={mobile ? "dialog" : undefined}
      className={cn(
        "h-full shrink-0 flex-col bg-sidebar",
        mobile ? "flex w-[268px] border-r" : "hidden size-full md:flex"
      )}
    >
      <header className="flex h-12 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {organization?.name ?? "Projects"}
        </span>
        <Button
          aria-label={mobile ? "Close navigation" : "Collapse navigation"}
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
        >
          <PanelLeftClose />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="grid gap-3">
          {projects.map((project) => {
            const workspaces = dashboard.workspaces.filter(
              (workspace) => workspace.projectId === project.id
            )
            const basePath = `/organizations/${encodeURIComponent(project.organizationSlug)}/projects/${encodeURIComponent(project.slug)}`

            return (
              <section key={project.id}>
                <div className="flex h-9 items-center gap-2 px-2 text-xs font-semibold text-foreground/85">
                  <span className="min-w-0 flex-1 truncate">
                    {project.name}
                  </span>
                  <Button
                    nativeButton={false}
                    aria-label={`New Workspace in ${project.name}`}
                    size="icon-xs"
                    variant="ghost"
                    render={<a href={`${basePath}/workspaces/new`} />}
                  >
                    <Plus />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Open ${project.name} menu`}
                      className="grid size-6 place-items-center rounded-[4px] text-muted-foreground hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        onClick={() =>
                          window.location.assign(`${basePath}/workspaces/new`)
                        }
                      >
                        <Plus /> New Workspace
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          window.location.assign(`${basePath}/settings`)
                        }
                      >
                        <Settings2 /> Project settings
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="grid gap-0.5 px-1">
                  {workspaces.map((workspace) => (
                    <a
                      key={workspace.id}
                      href={`${basePath}/workspaces/${encodeURIComponent(workspace.id)}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[5px] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/[.045] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="truncate">{workspace.title}</span>
                      <WorkspaceStatus status={workspace.status} />
                    </a>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </aside>
  )
}

export function AppShell({
  active,
  children,
  dashboard,
  organizationSlug,
  topbar,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const navigationRef = useRef<PanelImperativeHandle>(null)
  const navigationLayout = useDefaultLayout({
    id: "workspace-shell-navigation-v3",
    onlySaveAfterUserInteractions: true,
    panelIds: ["project-navigation", "workspace-area"],
    storage: navigationStorage,
  })

  const collapse = () => {
    setCollapsed(true)
  }

  const expand = () => {
    navigationRef.current?.expand()
  }

  useEffect(() => {
    if (collapsed && !navigationRef.current?.isCollapsed()) {
      navigationRef.current?.collapse()
    }
  }, [collapsed])

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      <ProductRail active={active} />
      <ResizablePanelGroup
        className="min-w-0 flex-1 max-md:[&>#project-navigation]:hidden max-md:[&>#project-navigation-handle]:hidden"
        defaultLayout={navigationLayout.defaultLayout}
        id="app-shell-navigation"
        onLayoutChanged={navigationLayout.onLayoutChanged}
        orientation="horizontal"
      >
        <ResizablePanel
          collapsedSize={0}
          collapsible={collapsed}
          defaultSize="268px"
          groupResizeBehavior="preserve-pixel-size"
          id="project-navigation"
          maxSize="420px"
          minSize="180px"
          onResize={({ inPixels }) => setCollapsed(inPixels === 0)}
          panelRef={navigationRef}
        >
          <ProjectNavigation
            dashboard={dashboard}
            onClose={collapse}
            organizationSlug={organizationSlug}
          />
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize project navigation"
          className={cn(
            "hidden transition-colors hover:bg-[var(--sylph-coral)]/50 md:flex",
            collapsed && "md:hidden"
          )}
          id="project-navigation-handle"
        />
        <ResizablePanel
          className="max-md:fixed! max-md:inset-0! max-md:w-auto! max-md:max-w-none! max-md:min-w-0! max-md:basis-auto!"
          id="workspace-area"
          minSize="480px"
        >
          <div className="size-full min-w-0 overflow-auto">
            <header className="flex h-12 items-center gap-2 border-b px-3 sm:px-4">
              <Button
                aria-label="Open navigation"
                size="icon-sm"
                variant="ghost"
                className={cn(!collapsed && "md:hidden")}
                onClick={() => {
                  if (window.matchMedia("(min-width: 768px)").matches) {
                    expand()
                    return
                  }
                  setMobileOpen(true)
                }}
              >
                <PanelLeftOpen />
              </Button>
              <div className="min-w-0 flex-1">{topbar}</div>
            </header>
            <main>{children}</main>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex bg-black/55 md:hidden">
          <ProjectNavigation
            dashboard={dashboard}
            mobile
            onClose={() => setMobileOpen(false)}
            organizationSlug={organizationSlug}
          />
          <button
            type="button"
            className="flex-1"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      ) : null}
    </div>
  )
}
