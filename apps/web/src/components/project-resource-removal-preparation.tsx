import { useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { failureMessage } from "@workspace/domain"
import { Schema } from "effect"
import {
  ResourceRemovalSelection,
  type ResourceRemovalPreparation,
  type StoredProjectResource,
} from "@workspace/domain/project-resources"
import {
  reviewResourceRemovalPreparation,
  createResourceRemovalWorkspace,
} from "@/functions/resource-removal-preparation"

export function ProjectResourceRemovalPreparation({
  projectId,
  resources,
}: {
  projectId: string
  resources: readonly StoredProjectResource[]
}) {
  const review = useServerFn(reviewResourceRemovalPreparation)
  const create = useServerFn(createResourceRemovalWorkspace)
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [preparation, setPreparation] =
    useState<ResourceRemovalPreparation | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const choices = resources.filter(
    (item) =>
      item.scope === "production" &&
      item.state === "active" &&
      item.purpose !== "recovery_control" &&
      ["queue", "durable_object"].includes(item.kind)
  )
  if (!choices.length) return null
  const hasNamespace =
    preparation?.resources.some((item) => item.kind === "durable_object") ??
    false
  const inspect = async () => {
    setPending(true)
    setError(null)
    try {
      const data = Schema.decodeUnknownSync(ResourceRemovalSelection)({
        projectId,
        resources: choices
          .filter((item) => selected.includes(`${item.kind}:${item.name}`))
          .map((item) => ({
            kind: item.kind,
            name: item.name,
            resourceId: item.resource_id,
            generation: item.generation,
          })),
      })
      setPreparation(await review({ data }))
      setAcknowledged(false)
    } catch (cause) {
      setError(failureMessage(cause, "The removal plan could not be reviewed"))
    } finally {
      setPending(false)
    }
  }
  const start = async () => {
    if (!preparation) return
    setPending(true)
    setError(null)
    try {
      const result = await create({ data: { projectId, preparation } })
      await router.navigate({
        to: "/projects/$projectSlug/workspaces/$workspaceId",
        params: {
          projectSlug: result.projectSlug,
          workspaceId: result.workspaceId,
        },
      })
    } catch (cause) {
      setError(
        failureMessage(cause, "The removal Workspace could not be created")
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <details className="mt-4 border-b pb-4">
      <summary className="cursor-pointer text-sm font-medium">
        Prepare removal in a Workspace
      </summary>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        First change and release the owning Alchemy source to detach references.
        Then review retirement and removal here. The agent prepares source
        changes; you review each release.
      </p>
      {!preparation ? (
        <div className="mt-3 space-y-3">
          <fieldset disabled={pending} className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              Queues and Durable Object namespaces
            </legend>
            {choices.map((item) => {
              const key = `${item.kind}:${item.name}`
              return (
                <label key={key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(key)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, key]
                          : current.filter((value) => value !== key)
                      )
                    }
                  />
                  <span className="break-all">{item.name}</span>
                </label>
              )
            })}
          </fieldset>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !selected.length}
            onClick={() => void inspect()}
          >
            {pending ? "Reviewing removal…" : "Review source removal"}
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs break-all text-muted-foreground">
            Accepted commit{" "}
            <span className="font-mono">{preparation.baseCommit}</span> ·
            Deployment {preparation.deploymentId}
          </p>
          <ul className="space-y-1 text-sm">
            {preparation.inventory.map((item) => (
              <li key={`${item.kind}:${item.name}`} className="break-all">
                {item.name} · {item.resource_id}
              </li>
            ))}
          </ul>
          {preparation.inventory.some((item) => item.kind === "queue") && (
            <p className="text-sm leading-6">
              Starter-managed Queues can detach consumers after pending work
              finishes. Their retained binding and recovery journal still block
              Queue retirement until a separate source transition removes the
              binding.
            </p>
          )}
          {hasNamespace && (
            <p className="text-sm leading-6">
              Deleting a namespace permanently destroys its data. A new
              namespace cannot use the same ID. Any saved recovery point that
              needs that ID blocks class deletion, including a point captured by
              the next release. This flow cannot invalidate those recovery
              points.
            </p>
          )}
          {preparation.blockers.length > 0 && (
            <div role="status" className="space-y-2 text-sm">
              <p className="font-medium">
                Class deletion is blocked. The Workspace can prepare reference
                removal.
              </p>
              <ul className="space-y-2">
                {preparation.blockers.map((blocker) => (
                  <li key={blocker} className="break-words">
                    {blocker}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasNamespace && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                disabled={pending}
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                I understand the namespace data loss and recovery limits.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || (hasNamespace && !acknowledged)}
              onClick={() => void start()}
            >
              {pending ? "Creating Workspace…" : "Create removal Workspace"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setPreparation(null)}
            >
              Change selection
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </details>
  )
}
