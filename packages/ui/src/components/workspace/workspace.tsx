"use client"

import type { ReactNode } from "react"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import {
  WorkspaceShellProvider,
  useWorkspaceShell,
  useWorkspaceShellStore,
} from "./workspace-shell-provider"
import { setWorkspaceToolPaneSize } from "./workspace-shell-store"

export function WorkspaceRoot({
  children,
  className,
  workspaceId,
}: {
  children: ReactNode
  className?: string
  workspaceId: string
}) {
  return (
    <WorkspaceShellProvider workspaceId={workspaceId}>
      <TooltipProvider>
        <div
          className={cn(
            "dark relative flex size-full min-h-0 overflow-hidden bg-background text-foreground",
            className
          )}
        >
          <div className="flex size-full min-w-0 flex-col">{children}</div>
        </div>
      </TooltipProvider>
    </WorkspaceShellProvider>
  )
}

export function WorkspacePanes({
  chat,
  children,
  terminal,
}: {
  chat: ReactNode
  children: ReactNode
  terminal?: ReactNode
}) {
  const store = useWorkspaceShellStore()
  const toolPaneOpen = useWorkspaceShell((state) => state.toolPaneOpen)
  const toolPaneSize = useWorkspaceShell((state) => state.toolPaneSize)

  const expanded = useWorkspaceShell((state) => state.expanded)
  const mobileView = useWorkspaceShell((state) => state.mobileView)
  const terminalOpen = useWorkspaceShell((state) => state.terminalOpen)
  const terminalSize = useWorkspaceShell((state) => state.terminalSize ?? 28)

  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="min-h-0 flex-1"
      onLayoutChanged={(layout, meta) => {
        const size = layout["workspace-terminal"]
        if (meta.isUserInteraction && size !== undefined)
          store.setState((state) => ({ ...state, terminalSize: size }))
      }}
    >
      <ResizablePanel id="workspace-main" minSize="45%">
        <ResizablePanelGroup
          className={cn(
            "relative min-h-0 flex-1",
            expanded &&
              "md:[&>#workspace-chat]:hidden! md:[&>#workspace-tools]:flex-1!",
            mobileView === "inspect"
              ? "max-md:[&>#workspace-chat]:hidden! max-md:[&>#workspace-tools]:flex-1!"
              : "max-md:[&>#workspace-chat]:flex-1! max-md:[&>#workspace-tools]:hidden!"
          )}
          id="workspace-content-panes"
          onLayoutChanged={(layout, meta) => {
            const size = layout["workspace-tools"]
            if (
              meta.isUserInteraction &&
              size !== undefined &&
              Number.isFinite(size)
            ) {
              setWorkspaceToolPaneSize(store, size)
            }
          }}
          orientation="horizontal"
        >
          <ResizablePanel id="workspace-chat" minSize="300px">
            {chat}
          </ResizablePanel>
          {toolPaneOpen ? (
            <>
              <ResizableHandle
                aria-label="Resize workspace tool pane"
                className={cn(
                  "hidden transition-colors hover:bg-[var(--sylph-coral)]/50 md:flex",
                  expanded && "md:hidden"
                )}
                id="workspace-tool-handle"
                withHandle
              />
              <ResizablePanel
                className="bg-background"
                defaultSize={`${toolPaneSize}%`}
                id="workspace-tools"
                maxSize={expanded ? "100%" : "75%"}
                minSize="300px"
              >
                {children}
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </ResizablePanel>
      {terminalOpen && terminal ? (
        <>
          <ResizableHandle aria-label="Resize command output" withHandle />
          <ResizablePanel
            id="workspace-terminal"
            defaultSize={`${terminalSize}%`}
            minSize="15%"
            maxSize="55%"
          >
            {terminal}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  )
}
