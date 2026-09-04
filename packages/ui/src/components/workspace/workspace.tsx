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
            "dark relative flex size-full min-h-[620px] overflow-hidden bg-background text-foreground",
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
}: {
  chat: ReactNode
  children: ReactNode
}) {
  const store = useWorkspaceShellStore()
  const toolPaneOpen = useWorkspaceShell((state) => state.toolPaneOpen)
  const toolPaneSize = useWorkspaceShell((state) => state.toolPaneSize)

  return (
    <ResizablePanelGroup
      className="relative min-h-0 flex-1"
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
      <ResizablePanel id="workspace-chat" minSize="260px">
        {chat}
      </ResizablePanel>
      {toolPaneOpen ? (
        <>
          <ResizableHandle
            aria-label="Resize workspace tool pane"
            className="hidden transition-colors hover:bg-[var(--sylph-coral)]/50 md:flex"
            id="workspace-tool-handle"
            withHandle
          />
          <ResizablePanel
            className="bg-background max-md:fixed! max-md:inset-x-1.5! max-md:top-[54px]! max-md:bottom-1.5! max-md:z-50 max-md:h-auto! max-md:w-auto! max-md:max-w-none! max-md:min-w-0! max-md:basis-auto!"
            defaultSize={`${toolPaneSize}%`}
            id="workspace-tools"
            maxSize="70%"
            minSize="260px"
          >
            {children}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  )
}
