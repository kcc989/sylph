import { useServerFn } from "@tanstack/react-start"
import { useRouter } from "@tanstack/react-router"
import { failureMessage } from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import { useState } from "react"
import {
  maintainProjectResources,
  type getProjectResources,
} from "@/functions/project-resources"

type ResourceInventory = Awaited<ReturnType<typeof getProjectResources>>

export function ProjectResourcesPanel({
  inventory,
  projectId,
  canManage,
}: {
  inventory: ResourceInventory
  projectId: string
  canManage: boolean
}) {
  const maintain = useServerFn(maintainProjectResources)
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const act = async (scope: string, action: "inspect" | "cleanup") => {
    setPending(scope)
    setError(null)
    setNotice(null)
    try {
      await maintain({
        data: {
          projectId,
          scope,
          action,
          confirmedScope: confirmation ?? undefined,
        },
      })
      setNotice("Resource maintenance started. Refresh to see the result.")
      setConfirmation(null)
      await router.invalidate()
    } catch (cause) {
      setError(failureMessage(cause, "Resource maintenance could not start"))
    } finally {
      setPending(null)
    }
  }
  return (
    <section
      className="border-b py-6"
      aria-labelledby="project-resources-title"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="project-resources-title" className="text-sm font-medium">
          Cloudflare resources
        </h2>
        <Button
          size="sm"
          variant="outline"
          disabled={pending !== null}
          onClick={async () => {
            setPending("refresh")
            setError(null)
            try {
              await router.invalidate()
            } catch (cause) {
              setError(failureMessage(cause, "Resources could not refresh"))
            } finally {
              setPending(null)
            }
          }}
        >
          Refresh
        </Button>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Resources are reserved before deployment. Preview cleanup removes only
        the resources owned by that Preview.
      </p>
      {inventory.operations.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          No tracked deployments yet. Existing resources are not adopted
          automatically.
        </p>
      )}
      {inventory.operations.map((operation) => (
        <div
          key={`${operation.account_id}:${operation.scope}`}
          className="mt-5 border-t pt-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-medium break-all">
                {operation.scope === "production"
                  ? "Production"
                  : operation.scope}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {operation.status.replaceAll("_", " ")}
              </p>
            </div>
            {operation.inspected_at !== null && (
              <p className="text-xs text-muted-foreground">
                Inspected{" "}
                {new Date(operation.inspected_at * 1000).toISOString()}
              </p>
            )}
            {canManage &&
              operation.status !== "deleted" &&
              operation.status !== "deploying" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => void act(operation.scope, "inspect")}
                  >
                    Inspect resources
                  </Button>
                  {operation.status === "cleanup_failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending !== null}
                      onClick={() => setConfirmation(operation.scope)}
                    >
                      Retry cleanup
                    </Button>
                  )}
                </div>
              )}
          </div>
          <ul className="mt-3 divide-y">
            {inventory.resources
              .filter(
                (resource) =>
                  resource.scope === operation.scope &&
                  resource.account_id === operation.account_id
              )
              .map((resource) => (
                <li
                  key={`${resource.kind}:${resource.name}`}
                  className="py-2 text-xs"
                >
                  <div className="flex justify-between gap-3">
                    <span>{resource.kind.toUpperCase()}</span>
                    <span>{resource.state}</span>
                  </div>
                  <p className="mt-1 font-mono break-all">{resource.name}</p>
                  {resource.resource_id &&
                    resource.resource_id !== resource.name && (
                      <p className="mt-1 font-mono break-all text-muted-foreground">
                        {resource.resource_id}
                      </p>
                    )}
                </li>
              ))}
          </ul>
          {operation.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {operation.error}
            </p>
          )}
          {confirmation === operation.scope && (
            <div className="mt-3 space-y-3">
              <p className="text-sm">
                Delete this Preview’s remaining resources and their data? This
                cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => void act(operation.scope, "cleanup")}
                >
                  {pending === operation.scope
                    ? "Starting cleanup…"
                    : "Delete remaining Preview resources"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => setConfirmation(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </section>
  )
}
