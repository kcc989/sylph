"use client"

import { LoaderCircle, Rocket, RotateCcw } from "lucide-react"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

export type AcceptedCommitItem = {
  commit: string
  acceptedAt: Date | string | number | null
}

export type DeploymentItem = {
  id: string
  commit: string
  status: string
  productionUrl: string | null
  actorName: string
  failureDetails: string | null
  startedAt: Date | string | number | null
  completedAt: Date | string | number | null
  createdAt: Date | string | number
}

export type DeploymentPanelProps = {
  acceptedCommits: ReadonlyArray<AcceptedCommitItem>
  deployments: ReadonlyArray<DeploymentItem>
  canDeploy: boolean
  pendingCommit?: string | null
  error?: string | null
  currentWorkspaceAcceptedCommit?: string | null
  onDeploy: (commit: string) => Promise<void>
  className?: string
}

const deploymentStatusClass = (status: string) => {
  if (status === "running") return "text-[var(--sylph-coral)]"
  if (status === "succeeded") return "text-[var(--sylph-live)]"
  if (status === "failed") return "text-destructive"
  return "text-muted-foreground"
}

function DeploymentPanel({
  acceptedCommits,
  deployments,
  canDeploy,
  pendingCommit = null,
  error,
  currentWorkspaceAcceptedCommit,
  onDeploy,
  className,
}: DeploymentPanelProps) {
  const [confirmingCommit, setConfirmingCommit] = useState<string | null>(null)

  return (
    <div className={cn("min-w-0", className)}>
      <section aria-labelledby="production-deployment-heading">
        <h2
          className="flex h-10 items-center gap-2 border-b px-3 text-xs font-medium"
          id="production-deployment-heading"
        >
          <Rocket className="size-3.5 text-[var(--sylph-coral)]" />
          Production
        </h2>
        <div className="space-y-2 p-3">
          {acceptedCommits.length ? (
            acceptedCommits.map((accepted, index) => {
              const action = index === 0 ? "Deploy" : "Rollback"
              const confirming = confirmingCommit === accepted.commit
              const pending = pendingCommit === accepted.commit
              return (
                <div
                  className="border-b pb-2 last:border-b-0"
                  key={accepted.commit}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-xs tabular-nums">
                          {accepted.commit.slice(0, 7)}
                        </p>
                        {currentWorkspaceAcceptedCommit === accepted.commit ? (
                          <Badge
                            className="h-4 rounded-[4px] px-1.5 text-[9px]"
                            variant="outline"
                          >
                            This Workspace
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {index === 0
                          ? "Latest Accepted commit"
                          : "Earlier Accepted commit"}
                      </p>
                    </div>
                    {canDeploy ? (
                      <Button
                        size="sm"
                        variant={index === 0 ? "default" : "outline"}
                        disabled={pendingCommit !== null || confirming}
                        onClick={() => setConfirmingCommit(accepted.commit)}
                      >
                        {pending ? (
                          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                        ) : index === 0 ? (
                          <Rocket />
                        ) : (
                          <RotateCcw />
                        )}
                        {action}
                      </Button>
                    ) : null}
                  </div>
                  {confirming ? (
                    <div
                      aria-label={`Confirm ${action.toLowerCase()} of ${accepted.commit.slice(0, 7)}`}
                      className="mt-2 border border-primary/40 bg-primary/5 px-3 py-2.5"
                      role="group"
                    >
                      <p className="text-xs leading-5">
                        {action} Accepted commit{" "}
                        <span className="font-mono">
                          {accepted.commit.slice(0, 7)}
                        </span>{" "}
                        to production? This replaces the live Deployment for
                        every user of this Project.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          disabled={pendingCommit !== null}
                          onClick={async () => {
                            try {
                              await onDeploy(accepted.commit)
                              setConfirmingCommit(null)
                            } catch {}
                          }}
                        >
                          {pending ? (
                            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                          ) : null}
                          Confirm {action.toLowerCase()}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pendingCommit !== null}
                          onClick={() => setConfirmingCommit(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              Accept a checked Workspace commit before deploying.
            </p>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            {canDeploy
              ? "Deploy publishes the selected Accepted commit after you confirm it. Rollback creates a new Deployment and does not change the Project Repository."
              : "Only Organization Admins can deploy or roll back production. Ask an Admin to confirm a Deployment."}
          </p>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>
      <section aria-labelledby="deployment-history-heading">
        <h2
          className="flex h-10 items-center gap-2 border-y px-3 text-xs font-medium"
          id="deployment-history-heading"
        >
          <RotateCcw className="size-3.5 text-muted-foreground" />
          Deployment history
        </h2>
        <div className="space-y-2 p-3">
          {deployments.length ? (
            deployments.map((deployment) => (
              <article
                className="border-b pb-2 last:border-b-0"
                key={deployment.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs tabular-nums">
                    {deployment.commit.slice(0, 7)}
                  </p>
                  <span
                    className={cn(
                      "text-xs font-medium capitalize",
                      deploymentStatusClass(deployment.status)
                    )}
                  >
                    {deployment.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {deployment.actorName} ·{" "}
                  {new Date(deployment.createdAt).toLocaleString()}
                </p>
                {deployment.productionUrl ? (
                  <a
                    className="mt-2 inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href={deployment.productionUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open production
                  </a>
                ) : null}
                {deployment.failureDetails ? (
                  <pre className="mt-2 max-h-32 overflow-auto bg-muted p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-destructive">
                    {deployment.failureDetails}
                  </pre>
                ) : null}
              </article>
            ))
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              No production Deployments yet.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

export { DeploymentPanel }
