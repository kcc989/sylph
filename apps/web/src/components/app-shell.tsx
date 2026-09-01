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
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  type PanelImperativeHandle,
  useDefaultLayout,
} from "react-resizable-panels"

import { authClient } from "@/lib/auth-client"
import { useWorkspaceCreation } from "@/lib/use-workspace-creation"

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

type AppShellDashboard = {
  installation: { canAdminister: boolean }
  organizations: ReadonlyArray<Organization>
  projects: ReadonlyArray<Project>
  workspaces: ReadonlyArray<Workspace>
}

type AppShellProps = {
  active: "home" | "skills" | "admin" | "settings"
  children: ReactNode
  dashboard: AppShellDashboard
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

function ProductRail({
  active,
  canAdminister,
}: {
  active: AppShellProps["active"]
  canAdminister: boolean
}) {
  const router = useRouter()
  const tools = [
    { label: "Projects", icon: House, href: "/", selected: active === "home" },
    {
      label: "Skills",
      icon: Blocks,
      href: "/skills",
      selected: active === "skills",
    },
    { label: "Search", icon: Search },
    ...(canAdminister
      ? [
          {
            label: "Administration",
            icon: ShieldCheck,
            href: "/admin",
            selected: active === "admin",
          },
        ]
      : []),
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
}: {
  dashboard: AppShellDashboard
  mobile?: boolean
  onClose: () => void
}) {
  const organization = dashboard.organizations[0]
  const projects = dashboard.projects
  const { creatingProjectId, creationError, startWorkspace } =
    useWorkspaceCreation()

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
            const basePath = `/projects/${encodeURIComponent(project.slug)}`

            return (
              <section key={project.id}>
                <div className="flex h-9 items-center gap-2 px-2 text-xs font-semibold text-foreground/85">
                  <span className="min-w-0 flex-1 truncate">
                    {project.name}
                  </span>
                  <Button
                    aria-label={
                      creatingProjectId === project.id
                        ? `Creating Workspace in ${project.name}`
                        : `New Workspace in ${project.name}`
                    }
                    size="icon-xs"
                    variant="ghost"
                    disabled={creatingProjectId !== null}
                    onClick={() => void startWorkspace(project)}
                  >
                    {creatingProjectId === project.id ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Plus />
                    )}
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
                        disabled={creatingProjectId !== null}
                        onClick={() => void startWorkspace(project)}
                      >
                        {creatingProjectId === project.id ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Plus />
                        )}
                        New Workspace
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
                {creationError?.projectId === project.id ? (
                  <p
                    role="alert"
                    className="px-3 pb-1 text-[10px] leading-4 text-destructive"
                  >
                    {creationError.message}
                  </p>
                ) : null}
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
  topbar,
}: AppShellProps) {
  const navigationInitiallyCollapsed = dashboard.projects.length === 0
  const navigationVisibilityStorageKey = navigationInitiallyCollapsed
    ? "sylph:project-navigation-hidden:onboarding-v1"
    : "sylph:project-navigation-hidden:v1"
  const [collapsed, setCollapsed] = useState(navigationInitiallyCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const hydratedVisibilityKeyRef = useRef<string | null>(null)
  const navigationRef = useRef<PanelImperativeHandle>(null)
  const navigationLayout = useDefaultLayout({
    id: navigationInitiallyCollapsed
      ? "workspace-shell-navigation-onboarding-v1"
      : "workspace-shell-navigation-v3",
    onlySaveAfterUserInteractions: true,
    panelIds: ["project-navigation", "workspace-area"],
    storage: navigationStorage,
  })

  const collapse = () => {
    navigationRef.current?.collapse()
    setCollapsed(true)
  }

  const expand = () => {
    navigationRef.current?.expand()
    setCollapsed(false)
  }

  useEffect(() => {
    if (hydratedVisibilityKeyRef.current !== navigationVisibilityStorageKey) {
      hydratedVisibilityKeyRef.current = navigationVisibilityStorageKey
      const storedVisibility = navigationStorage.getItem(
        navigationVisibilityStorageKey
      )
      const storedCollapsed =
        storedVisibility === "true"
          ? true
          : storedVisibility === "false"
            ? false
            : navigationInitiallyCollapsed

      navigationStorage.setItem(
        navigationVisibilityStorageKey,
        storedCollapsed ? "true" : "false"
      )

      if (storedCollapsed !== collapsed) {
        setCollapsed(storedCollapsed)
        return
      }
    }

    navigationStorage.setItem(
      navigationVisibilityStorageKey,
      collapsed ? "true" : "false"
    )

    if (collapsed) {
      if (!navigationRef.current?.isCollapsed()) {
        navigationRef.current?.collapse()
      }
      return
    }

    if (navigationRef.current?.isCollapsed()) {
      navigationRef.current.expand()
    }
  }, [collapsed, navigationInitiallyCollapsed, navigationVisibilityStorageKey])

  return (
    <div className="flex h-svh overflow-hidden bg-background text-foreground">
      <ProductRail
        active={active}
        canAdminister={dashboard.installation.canAdminister}
      />
      <ResizablePanelGroup
        className="min-w-0 flex-1 max-md:[&>#project-navigation]:hidden max-md:[&>#project-navigation-handle]:hidden"
        defaultLayout={navigationLayout.defaultLayout}
        id="app-shell-navigation"
        onLayoutChanged={navigationLayout.onLayoutChanged}
        orientation="horizontal"
      >
        <ResizablePanel
          collapsedSize={0}
          collapsible
          defaultSize={navigationInitiallyCollapsed ? 0 : "268px"}
          groupResizeBehavior="preserve-pixel-size"
          id="project-navigation"
          maxSize="420px"
          minSize="180px"
          onResize={({ inPixels }) => setCollapsed(inPixels <= 1)}
          panelRef={navigationRef}
        >
          <ProjectNavigation dashboard={dashboard} onClose={collapse} />
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
