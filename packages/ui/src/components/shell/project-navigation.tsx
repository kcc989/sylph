import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import {
  CircleAlert,
  CircleDot,
  FileText,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Settings2,
} from "lucide-react"

import { useShell } from "./shell-root"

export type NavigationWorkspace = {
  active?: boolean
  href: string
  id: string
  status: string
  title: string
}

export type NavigationProject = {
  href: string
  id: string
  issuesHref?: string
  name: string
  newWorkspaceHref?: string
  settingsHref: string
  workspaces: ReadonlyArray<NavigationWorkspace>
}

export type ProjectNavigationProps = {
  organizationName: string
  projects: ReadonlyArray<NavigationProject>
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

export function ProjectNavigation({
  organizationName,
  projects,
}: ProjectNavigationProps) {
  const { closeNavigation } = useShell()

  return (
    <aside
      aria-label="Project and Workspace navigation"
      className="flex size-full min-w-0 flex-col overflow-hidden bg-sidebar"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {organizationName}
        </span>
        <Button
          aria-label="Close navigation"
          onClick={closeNavigation}
          size="icon-xs"
          variant="ghost"
        >
          <PanelLeftClose />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
        <div className="grid min-w-0 grid-cols-1 gap-3">
          {projects.map((project) => (
            <section className="min-w-0" key={project.id}>
              <div className="flex h-9 items-center gap-2 px-2 text-xs font-semibold text-foreground/85">
                <a
                  className="min-w-0 flex-1 truncate"
                  title={project.name}
                  href={project.href}
                >
                  {project.name}
                </a>
                {project.newWorkspaceHref ? (
                  <Button
                    aria-label={`New Workspace in ${project.name}`}
                    nativeButton={false}
                    render={<a href={project.newWorkspaceHref} />}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Plus />
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Open ${project.name} menu`}
                    className="grid size-6 shrink-0 place-items-center rounded-[4px] text-muted-foreground hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {project.newWorkspaceHref ? (
                      <DropdownMenuItem
                        nativeButton={false}
                        render={<a href={project.newWorkspaceHref} />}
                      >
                        <Plus /> New Workspace
                      </DropdownMenuItem>
                    ) : null}
                    {project.issuesHref ? (
                      <DropdownMenuItem
                        nativeButton={false}
                        render={<a href={project.issuesHref} />}
                      >
                        <FileText /> Issues
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      nativeButton={false}
                      render={<a href={project.settingsHref} />}
                    >
                      <Settings2 /> Project settings
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-0.5 px-1">
                {project.workspaces.map((workspace) => (
                  <a
                    aria-current={workspace.active ? "page" : undefined}
                    className={cn(
                      "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[5px] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/[.045] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      workspace.active && "bg-white/[.06] text-foreground"
                    )}
                    title={workspace.title}
                    href={workspace.href}
                    key={workspace.id}
                  >
                    <span className="truncate">{workspace.title}</span>
                    <WorkspaceStatus status={workspace.status} />
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </aside>
  )
}
