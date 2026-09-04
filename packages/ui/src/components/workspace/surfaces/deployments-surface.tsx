"use client"

import { Rocket } from "lucide-react"

import { DeploymentPanel } from "@workspace/ui/components/deployment-panel"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import type { WorkspaceDeployments } from "../types"

export function DeploymentsSurface({
  deployments,
  canDeploy,
  acceptedCommit,
  pendingCommit,
  error,
  onDeploy,
}: {
  deployments: WorkspaceDeployments
  canDeploy: boolean
  acceptedCommit?: string | null
  pendingCommit?: string | null
  error?: string | null
  onDeploy?: (commit: string) => Promise<void>
}) {
  return (
    <section className="flex size-full min-h-0 flex-col bg-[var(--sylph-ink)]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-[#171614] px-3 text-xs text-muted-foreground">
        <Rocket className="size-3.5" />
        Project Deployments
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <DeploymentPanel
          acceptedCommits={deployments.acceptedCommits}
          canDeploy={canDeploy}
          currentWorkspaceAcceptedCommit={acceptedCommit}
          deployments={deployments.deployments}
          error={error}
          onDeploy={onDeploy ?? (async () => undefined)}
          pendingCommit={pendingCommit}
        />
      </ScrollArea>
      <footer className="border-t px-3 py-2 text-[10px] text-muted-foreground">
        Rollback creates a new Deployment of an earlier Accepted commit.
      </footer>
    </section>
  )
}
