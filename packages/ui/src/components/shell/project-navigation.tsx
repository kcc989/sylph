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
  LoaderCircle,
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
  onCreateWorkspace?: () => void
  creatingWorkspace?: boolean
  creationError?: string
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
      className="flex size-full flex-col bg-sidebar"
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="grid gap-3">
          {projects.map((project) => (
            <section key={project.id}>
              <div className="flex h-9 items-center gap-2 px-2 text-xs font-semibold text-foreground/85">
                <a className="min-w-0 flex-1 truncate" href={project.href}>
                  {project.name}
                </a>
                {project.newWorkspaceHref || project.onCreateWorkspace ? (
                  <Button
                    aria-label={`New Workspace in ${project.name}`}
                    nativeButton={!project.newWorkspaceHref}
                    render={
                      project.newWorkspaceHref ? (
                        <a href={project.newWorkspaceHref} />
                      ) : undefined
                    }
                    disabled={project.creatingWorkspace}
                    onClick={project.onCreateWorkspace}
                    size="icon-xs"
                    variant="ghost"
                  >
                    {project.creatingWorkspace ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Plus />
                    )}
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Open ${project.name} menu`}
                    className="grid size-6 place-items-center rounded-[4px] text-muted-foreground hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    {project.newWorkspaceHref || project.onCreateWorkspace ? (
                      <DropdownMenuItem
                        nativeButton={!project.newWorkspaceHref}
                        render={
                          project.newWorkspaceHref ? (
                            <a href={project.newWorkspaceHref} />
                          ) : undefined
                        }
                        disabled={project.creatingWorkspace}
                        onClick={project.onCreateWorkspace}
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
              {project.creationError ? (
                <p role="alert" className="px-2 py-1 text-xs text-destructive">
                  {project.creationError}
                </p>
              ) : null}
              <div className="grid gap-0.5 px-1">
                {project.workspaces.map((workspace) => (
                  <a
                    aria-current={workspace.active ? "page" : undefined}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[5px] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/[.045] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      workspace.active && "bg-white/[.06] text-foreground"
                    )}
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
