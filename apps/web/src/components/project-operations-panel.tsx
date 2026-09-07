import { useServerFn } from "@tanstack/react-start"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { ProjectId, failureMessage } from "@workspace/domain"
import {
  collectProjectHealth,
  acknowledgeProjectIncident,
  repairProjectIncident,
  type getProjectOperations,
} from "@/functions/project-operations"

export function ProjectOperationsPanel({
  projectId,
  projectSlug,
  initial,
}: {
  projectId: string
  projectSlug: string
  initial: Awaited<ReturnType<typeof getProjectOperations>>
}) {
  const collect = useServerFn(collectProjectHealth)
  const acknowledge = useServerFn(acknowledgeProjectIncident)
  const repair = useServerFn(repairProjectIncident)
  const [state, setState] = useState(initial)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const act = async (key: string, operation: () => Promise<void>) => {
    setPending(key)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(failureMessage(cause, "The operation failed. Try again."))
    } finally {
      setPending(null)
    }
  }
  const observation = state.observation
  const open = state.incidents.filter(
    (incident) => incident.status === "open"
  ).length
  return (
    <section className="border-b py-6" aria-labelledby="project-health-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="project-health-title" className="text-sm font-medium">
          Production health
        </h2>
        <Button
          variant="outline"
          disabled={pending !== null}
          onClick={() =>
            void act("collect", async () =>
              setState(
                await collect({
                  data: { projectId: ProjectId.make(projectId) },
                })
              )
            )
          }
        >
          {pending === "collect" ? "Collecting…" : "Collect health"}
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Check recent production errors and response time, then open a repair
        Workspace.
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Collection runs on request, at most once a minute. It samples 15 minutes
        of invocation logs ending one minute ago. Alerts use observed errors or
        a sampled p95 of at least 2,000 ms.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {open > 0 && (
        <p role="status" className="mt-4 text-sm font-medium">
          {open} production {open === 1 ? "incident needs" : "incidents need"}{" "}
          attention
        </p>
      )}
      {observation ? (
        <div className="mt-4 space-y-2 text-sm">
          <p className="font-medium">
            {observation.status === "degraded"
              ? "Errors or slow responses observed"
              : observation.status === "observed"
                ? "No errors in this sample"
                : "Health unknown"}
          </p>
          <p className="font-mono text-xs break-all">
            Commit {observation.commit}
          </p>
          <p className="text-xs break-all text-muted-foreground">
            Deployment {observation.deploymentId} · Collected{" "}
            {new Date(observation.checkedAt).toLocaleString()}
          </p>
          <p>
            {observation.requests} sampled invocations · {observation.errors}{" "}
            errors · p95{" "}
            {observation.p95Ms === null
              ? "unavailable"
              : `${Math.round(observation.p95Ms)} ms`}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {observation.detail}{" "}
            {observation.limited
              ? "Collection limit reached; additional events may exist."
              : ""}
          </p>
          {observation.evidence.length > 0 && (
            <details className="pt-2">
              <summary className="cursor-pointer text-sm underline underline-offset-4">
                View invocation evidence
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                Up to 20 sampled invocations. Request bodies, headers and
                application log messages are not retained.
              </p>
              <ol className="mt-3 space-y-3">
                {observation.evidence.slice(0, 20).map((event) => (
                  <li
                    key={`${event.scriptName}:${event.requestId}`}
                    className="space-y-1 text-xs break-all"
                  >
                    <p>
                      {event.scriptName} · {event.outcome} · HTTP{" "}
                      {event.statusCode ?? "unavailable"} ·{" "}
                      {event.wallTimeMs === null
                        ? "Timing unavailable"
                        : `${Math.round(event.wallTimeMs)} ms`}
                    </p>
                    <p className="font-mono">Version {event.versionId}</p>
                    <p className="font-mono">Request {event.requestId}</p>
                    <p className="text-muted-foreground">
                      {new Date(event.timestamp).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No health observations yet. Collect after a verified production
          release.
        </p>
      )}
      <ul className="mt-5 divide-y">
        {state.incidents.map((incident) => (
          <li key={incident.id} className="space-y-3 py-4">
            <div>
              <h3 className="text-sm font-medium">
                {incident.kind === "errors"
                  ? "Production errors"
                  : "Slow production responses"}{" "}
                ·{" "}
                {incident.status === "open"
                  ? "Needs attention"
                  : "Acknowledged"}
              </h3>
              <p className="mt-1 text-xs break-all text-muted-foreground">
                Commit {incident.commit} · Last observed{" "}
                {new Date(incident.last_seen).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {incident.workspace_id ? (
                <Button
                  nativeButton={false}
                  variant="outline"
                  render={
                    <Link
                      to="/projects/$projectSlug/workspaces/$workspaceId"
                      params={{
                        projectSlug,
                        workspaceId: incident.workspace_id,
                      }}
                    />
                  }
                >
                  Open repair Workspace
                </Button>
              ) : (
                <Button
                  disabled={pending !== null}
                  onClick={() =>
                    void act(incident.id, async () => {
                      const result = await repair({
                        data: {
                          projectId: ProjectId.make(projectId),
                          incidentId: incident.id,
                        },
                      })
                      setState((current) => ({
                        ...current,
                        incidents: current.incidents.map((item) =>
                          item.id === incident.id
                            ? { ...item, workspace_id: result.workspaceId }
                            : item
                        ),
                      }))
                    })
                  }
                >
                  {pending === incident.id
                    ? "Creating repair…"
                    : "Create repair Workspace"}
                </Button>
              )}
              {incident.status === "open" && (
                <Button
                  variant="ghost"
                  disabled={pending !== null}
                  onClick={() =>
                    void act(`ack-${incident.id}`, async () =>
                      setState(
                        await acknowledge({
                          data: {
                            projectId: ProjectId.make(projectId),
                            incidentId: incident.id,
                          },
                        })
                      )
                    )
                  }
                >
                  Acknowledge
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The repair starts from this deployed commit with diagnostic
              evidence. Review and deploy separately.
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
