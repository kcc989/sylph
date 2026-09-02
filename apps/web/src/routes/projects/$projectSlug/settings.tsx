import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { failureMessage } from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import {
  Bot,
  Download,
  FolderGit2,
  GitFork,
  GitBranch,
  ListChecks,
  LoaderCircle,
  Plus,
  Rocket,
  RotateCcw,
  Settings2,
} from "lucide-react"
import { useEffect, useState } from "react"

import { AppShell } from "@/components/app-shell"
import { getDashboard } from "@/functions/installation"
import {
  deployProjectCommit,
  exportProjectRecovery,
  getProjectDeployments,
  getWorkspaceCreationContext,
  setProjectDeliveryMode,
} from "@/functions/projects"
import { useWorkspaceCreation } from "@/lib/use-workspace-creation"

export const Route = createFileRoute("/projects/$projectSlug/settings")({
  loader: async ({ params }) => {
    const dashboard = await getDashboard()
    const project = dashboard.projects.find(
      (candidate) => candidate.slug === params.projectSlug
    )
    const context = project
      ? await getWorkspaceCreationContext({ data: { projectId: project.id } })
      : null
    const deploymentContext = project
      ? await getProjectDeployments({ data: { projectId: project.id } })
      : null
    return { context, dashboard, deploymentContext }
  },
  component: ProjectSettingsScreen,
})

function ProjectSettingsScreen() {
  const { projectSlug } = Route.useParams()
  const { context, dashboard, deploymentContext } = Route.useLoaderData()
  const router = useRouter()
  const setDeliveryMode = useServerFn(setProjectDeliveryMode)
  const exportRecovery = useServerFn(exportProjectRecovery)
  const deployCommit = useServerFn(deployProjectCommit)
  const [deliveryPending, setDeliveryPending] = useState(false)
  const [exportPending, setExportPending] = useState(false)
  const [repositoryError, setRepositoryError] = useState<string | null>(null)
  const [deployPending, setDeployPending] = useState<string | null>(null)
  const [confirmingCommit, setConfirmingCommit] = useState<string | null>(null)
  const [deployKey, setDeployKey] = useState(() => crypto.randomUUID())
  const canDeploy = dashboard.installation.canAdminister
  const { creatingProjectId, creationError, startWorkspace } =
    useWorkspaceCreation()

  useEffect(() => {
    const pending = deploymentContext?.deployments.some(
      (deployment) =>
        deployment.status === "queued" || deployment.status === "running"
    )
    if (!pending) return
    const timer = window.setInterval(() => void router.invalidate(), 3_000)
    return () => window.clearInterval(timer)
  }, [deploymentContext?.deployments, router])

  if (!context) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Project unavailable</h1>
          <Button
            nativeButton={false}
            className="mt-5"
            render={<Link to="/" />}
          >
            Return to Projects
          </Button>
        </div>
      </main>
    )
  }

  return (
    <AppShell active="home" dashboard={dashboard} topbar={context.project.name}>
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <Button
          className="ml-auto"
          size="sm"
          disabled={creatingProjectId !== null}
          onClick={() =>
            void startWorkspace({ id: context.project.id, slug: projectSlug })
          }
        >
          {creatingProjectId === context.project.id ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Plus />
          )}
          New Workspace
        </Button>
        {creationError?.projectId === context.project.id ? (
          <p role="alert" className="mt-2 text-right text-xs text-destructive">
            {creationError.message}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-[7px] bg-white/[.05] text-muted-foreground">
            <Settings2 className="size-4" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">
              Project settings
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {context.project.name}
            </p>
          </div>
        </div>

        <section className="mt-10 border-t">
          <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 text-xs font-medium">
              <FolderGit2 className="size-3.5 text-[#ef9b7e]" /> Repository
            </div>
            <div>
              <p className="font-mono text-xs">
                {context.project.repositoryName}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                This is the canonical Repository contained by the Project. Each
                Workspace receives an isolated fork.
              </p>
            </div>
          </div>
          <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Rocket className="size-3.5 text-primary" /> Production
            </div>
            <div className="min-w-0">
              {deploymentContext?.acceptedCommits.length ? (
                <div className="space-y-3">
                  {deploymentContext.acceptedCommits.map((accepted, index) => {
                    const action = index === 0 ? "Deploy" : "Rollback"
                    const confirming = confirmingCommit === accepted.commit
                    return (
                      <div
                        key={accepted.commit}
                        className="rounded-[8px] border px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-mono text-xs">
                              {accepted.commit.slice(0, 7)}
                            </p>
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
                              disabled={deployPending !== null || confirming}
                              onClick={() => {
                                setRepositoryError(null)
                                setConfirmingCommit(accepted.commit)
                              }}
                            >
                              {deployPending === accepted.commit ? (
                                <LoaderCircle className="animate-spin" />
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
                            role="group"
                            aria-label={`Confirm ${action.toLowerCase()} of ${accepted.commit.slice(0, 7)}`}
                            className="mt-3 rounded-[6px] border border-primary/40 bg-primary/5 px-3 py-2.5"
                          >
                            <p className="text-xs leading-5">
                              {action} Accepted commit{" "}
                              <span className="font-mono">
                                {accepted.commit.slice(0, 7)}
                              </span>{" "}
                              to production? This replaces the live Deployment
                              for every user of this Project.
                            </p>
                            <div className="mt-2 flex gap-2">
                              <Button
                                size="sm"
                                disabled={deployPending !== null}
                                onClick={async () => {
                                  setDeployPending(accepted.commit)
                                  setRepositoryError(null)
                                  try {
                                    await deployCommit({
                                      data: {
                                        projectId: context.project.id,
                                        commit: accepted.commit,
                                        confirmedCommit: accepted.commit,
                                        idempotencyKey: deployKey,
                                      },
                                    })
                                    setDeployKey(crypto.randomUUID())
                                    setConfirmingCommit(null)
                                    await router.invalidate()
                                  } catch (cause) {
                                    setRepositoryError(
                                      failureMessage(
                                        cause,
                                        "Deployment could not start"
                                      )
                                    )
                                  } finally {
                                    setDeployPending(null)
                                  }
                                }}
                              >
                                {deployPending === accepted.commit ? (
                                  <LoaderCircle className="animate-spin" />
                                ) : null}
                                Confirm {action.toLowerCase()}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={deployPending !== null}
                                onClick={() => setConfirmingCommit(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  Accept a checked Workspace commit before deploying.
                </p>
              )}
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {canDeploy
                  ? "Deploy publishes the selected Accepted commit after you confirm it. Rollback creates a new Deployment and does not change the Project Repository."
                  : "Only Organization Admins can deploy or roll back production. Ask an Admin to confirm a Deployment from this page."}
              </p>
            </div>
          </div>
          <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 text-xs font-medium">
              <RotateCcw className="size-3.5 text-muted-foreground" />{" "}
              Deployment history
            </div>
            <div className="min-w-0">
              {deploymentContext?.deployments.length ? (
                <div className="space-y-3">
                  {deploymentContext.deployments.map((deployment) => (
                    <div
                      key={deployment.id}
                      className="rounded-[8px] border px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-xs">
                          {deployment.commit.slice(0, 7)}
                        </p>
                        <span className="text-xs font-medium capitalize">
                          {deployment.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {deployment.actorName} ·{" "}
                        {new Date(deployment.createdAt).toLocaleString()}
                      </p>
                      {deployment.productionUrl ? (
                        <a
                          href={deployment.productionUrl}
                          className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open production
                        </a>
                      ) : null}
                      {deployment.failureDetails ? (
                        <pre className="mt-2 max-h-32 overflow-auto rounded-[6px] bg-muted p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-destructive">
                          {deployment.failureDetails}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  No production Deployments yet.
                </p>
              )}
            </div>
          </div>
          <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 text-xs font-medium">
              <ListChecks className="size-3.5 text-muted-foreground" /> Check
              history
            </div>
            <div className="min-w-0">
              {deploymentContext?.checks.length ? (
                <ul className="divide-y rounded-[8px] border">
                  {deploymentContext.checks.map((check) => (
                    <li
                      key={check.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-xs">
                          {check.commit.slice(0, 7)}{" "}
                          <span className="font-sans text-muted-foreground">
                            {check.kind}
                          </span>
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {check.workspaceTitle} ·{" "}
                          {new Date(check.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-xs font-medium capitalize">
                        {check.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  No Checks have run for this Project yet.
                </p>
              )}
            </div>
          </div>
          {context.project.importOriginUrl ? (
            <>
              <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <GitFork className="size-3.5 text-muted-foreground" /> GitHub
                  upstream
                </div>
                <div className="min-w-0">
                  <a
                    href={context.project.importOriginUrl}
                    className="block truncate font-mono text-xs text-primary hover:underline"
                    rel="noreferrer"
                    target="_blank"
                  >
                    {context.project.importOriginUrl}
                  </a>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {context.project.upstreamStatus.replaceAll("_", " ")}
                    {context.project.upstreamHead
                      ? ` at ${context.project.upstreamHead.slice(0, 7)}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <GitBranch className="size-3.5 text-muted-foreground" />
                  Delivery
                </div>
                <div>
                  <select
                    aria-label="GitHub delivery mode"
                    className="h-8 rounded-[8px] border bg-background px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                    disabled={deliveryPending}
                    value={context.project.deliveryMode}
                    onChange={async (event) => {
                      const mode = event.target.value
                      if (mode !== "push" && mode !== "pull_request") return
                      setDeliveryPending(true)
                      setRepositoryError(null)
                      try {
                        await setDeliveryMode({
                          data: {
                            projectId: context.project.id,
                            mode,
                          },
                        })
                        await router.invalidate()
                      } catch (cause) {
                        setRepositoryError(
                          failureMessage(
                            cause,
                            "Delivery mode could not be saved"
                          )
                        )
                      } finally {
                        setDeliveryPending(false)
                      }
                    }}
                  >
                    <option value="pull_request">Open a pull request</option>
                    <option value="push">Push the default branch</option>
                  </select>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Accepted Workspace commits are delivered with your GitHub
                    App authorization. A rejected push remains accepted in Sylph
                    and is marked as a delivery conflict.
                  </p>
                  {context.project.deliveryUrl ? (
                    <a
                      href={context.project.deliveryUrl}
                      className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open latest delivery
                    </a>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
          <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Download className="size-3.5 text-muted-foreground" /> Recovery
              export
            </div>
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={exportPending}
                onClick={async () => {
                  setExportPending(true)
                  setRepositoryError(null)
                  try {
                    const recovery = await exportRecovery({
                      data: { projectId: context.project.id },
                    })
                    const href = URL.createObjectURL(
                      new Blob([JSON.stringify(recovery, null, 2)], {
                        type: "application/json",
                      })
                    )
                    const link = document.createElement("a")
                    link.href = href
                    link.download = `${context.project.slug}-sylph-recovery.json`
                    link.click()
                    URL.revokeObjectURL(href)
                  } catch (cause) {
                    setRepositoryError(
                      failureMessage(
                        cause,
                        "Recovery export could not be prepared"
                      )
                    )
                  } finally {
                    setExportPending(false)
                  }
                }}
              >
                {exportPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Download />
                )}
                {exportPending ? "Preparing…" : "Download recovery manifest"}
              </Button>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Includes the Project Repository, every Workspace fork, commit
                identities, and short-lived credentials for full mirror clones.
              </p>
            </div>
          </div>
          <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 text-xs font-medium">
              <GitBranch className="size-3.5 text-muted-foreground" /> Default
              branch
            </div>
            <p className="font-mono text-xs">{context.project.defaultBranch}</p>
          </div>
          <div className="grid gap-4 border-b py-6 sm:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Bot className="size-3.5 text-primary" />
              AI provider
            </div>
            <div>
              <p className="font-mono text-xs">
                {context.setup.providerId && context.setup.modelId
                  ? `${context.setup.providerId}/${context.setup.modelId}`
                  : "Not connected"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                This connection is shared by every Project and Workspace in the
                Organization.
              </p>
              <a
                href="/admin"
                className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
              >
                Organization provider settings
              </a>
            </div>
          </div>
        </section>
        {repositoryError ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {repositoryError}
          </p>
        ) : null}
      </div>
    </AppShell>
  )
}
