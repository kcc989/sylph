import { ProjectResourceRemovalPreparation } from "./project-resource-removal-preparation"
import { useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { useRouter } from "@tanstack/react-router"
import { Schema } from "effect"
import { failureMessage } from "@workspace/domain"
import {
  ProjectResourcePlan,
  type ResourceMutationReview,
  type StoredProjectResource,
} from "@workspace/domain/project-resources"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  confirmProjectResourceMutation,
  reviewProjectResourceMutation,
} from "@/functions/project-resources"

export function ProjectResourceActions({
  projectId,
  resources,
  pendingReview,
}: {
  projectId: string
  resources: ReadonlyArray<StoredProjectResource>
  pendingReview?: ResourceMutationReview
}) {
  const reviewAction = useServerFn(reviewProjectResourceMutation)
  const confirmAction = useServerFn(confirmProjectResourceMutation)
  const router = useRouter()
  const [action, setAction] = useState<"adopt" | "retire" | "remove">("adopt")
  const [selected, setSelected] = useState<string[]>([])
  const [plan, setPlan] = useState("")
  const [review, setReview] = useState<ResourceMutationReview | null>(null)
  const [confirmation, setConfirmation] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const choices = resources.filter(
    (item) =>
      item.scope === "production" &&
      item.purpose !== "recovery_control" &&
      item.state === (action === "retire" ? "active" : "retired")
  )
  const submitReview = async () => {
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const planned =
        action === "adopt"
          ? Schema.decodeUnknownSync(ProjectResourcePlan)(JSON.parse(plan))
          : choices
              .filter((item) => selected.includes(`${item.kind}:${item.name}`))
              .map((item) => ({ kind: item.kind, name: item.name }))
      setReview(
        await reviewAction({
          data: { projectId, scope: "production", action, resources: planned },
        })
      )
      setConfirmation("")
    } catch (cause) {
      setError(failureMessage(cause, "The resources could not be reviewed"))
    } finally {
      setPending(false)
    }
  }
  const confirm = async () => {
    if (!review) return
    setPending(true)
    setError(null)
    try {
      await confirmAction({
        data: { projectId, reviewId: review.id, confirmation },
      })
      setReview(null)
      setNotice(
        "Confirmed. Resource maintenance has started. Refresh the inventory to see its result."
      )
      await router.invalidate()
    } catch (cause) {
      setError(
        failureMessage(
          cause,
          "The resource action could not start. You can retry this confirmation."
        )
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <details className="mt-5 border-t pt-4">
      <summary className="cursor-pointer text-sm font-medium">
        Manage production resources
      </summary>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Review existing resources before adoption. Retirement keeps the resource
        and its data, but blocks future use in this Project. Removal permanently
        deletes retired resources and their data.
      </p>
      <ProjectResourceRemovalPreparation
        projectId={projectId}
        resources={resources}
      />
      {pendingReview && !review && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          className="mt-3"
          onClick={() => setReview(pendingReview)}
        >
          Resume confirmed action
        </Button>
      )}
      {!review ? (
        <div className="mt-4 space-y-4">
          <fieldset disabled={pending} className="space-y-3">
            <legend className="mb-2 text-sm font-medium">Action</legend>
            <div className="flex flex-wrap gap-4">
              {(["adopt", "retire", "remove"] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="resource-action"
                    checked={action === value}
                    onChange={() => {
                      setAction(value)
                      setSelected([])
                      setError(null)
                    }}
                  />
                  {value === "adopt"
                    ? "Adopt existing"
                    : value === "retire"
                      ? "Retire and keep"
                      : "Remove retired"}
                </label>
              ))}
            </div>
          </fieldset>
          {action === "adopt" ? (
            <div className="space-y-2">
              <label
                htmlFor="resource-adoption-plan"
                className="text-sm font-medium"
              >
                Existing resource plan
              </label>
              <Textarea
                id="resource-adoption-plan"
                value={plan}
                disabled={pending}
                onChange={(event) => setPlan(event.target.value)}
                className="min-h-32 font-mono text-base"
                aria-describedby="resource-adoption-help"
              />
              <p
                id="resource-adoption-help"
                className="text-sm text-muted-foreground"
              >
                Paste the JSON resource plan from the existing Alchemy stack.
                Review checks the account, resource IDs, and Worker bindings. It
                does not create or replace resources.
              </p>
            </div>
          ) : (
            <fieldset disabled={pending} className="space-y-3">
              <legend className="mb-2 text-sm font-medium">
                Resources to {action}
              </legend>
              {!choices.length && (
                <p className="text-sm text-muted-foreground">
                  No {action === "retire" ? "active" : "retired"} production
                  resources are available.
                </p>
              )}
              {choices.map((item) => {
                const key = `${item.kind}:${item.name}`
                return (
                  <label key={key} className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.includes(key)}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, key]
                            : selected.filter((value) => value !== key)
                        )
                      }
                    />
                    <span className="min-w-0 break-all">
                      {item.kind.toUpperCase()} · {item.name}
                    </span>
                  </label>
                )
              })}
            </fieldset>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={
              pending || (action === "adopt" ? !plan.trim() : !selected.length)
            }
            onClick={() => void submitReview()}
          >
            {pending ? "Inspecting resources…" : "Review action"}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-sm font-medium">
            Review {review.action} · Production
          </p>
          <p className="text-sm break-all text-muted-foreground">
            Cloudflare account: {review.accountId}
          </p>
          <ul className="divide-y">
            {review.inventory.map((item) => (
              <li
                key={`${item.kind}:${item.name}`}
                className="space-y-1 py-3 text-sm"
              >
                <p className="break-all">
                  {item.kind.toUpperCase()} · {item.name}
                </p>
                <p className="font-mono break-all text-muted-foreground">
                  {item.resource_id}
                </p>
                {item.generation && (
                  <p className="text-muted-foreground">
                    Created {item.generation}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-sm leading-6">
            {review.action === "remove"
              ? "This permanently deletes the listed resources and their data. Confirm only after reviewing recovery copies and the effect on production."
              : review.action === "retire"
                ? "The listed resources stay in Cloudflare. Remove them from the next Alchemy resource plan and retain them in Alchemy state until removal is separately confirmed."
                : "Sylph will claim these exact resource IDs for this Project. The Alchemy stack must adopt these resources with the same logical IDs before its next deployment."}
          </p>
          <div className="space-y-2">
            <label htmlFor="resource-action-confirmation" className="text-sm">
              Type <strong>{review.action} production</strong> to confirm
            </label>
            <Input
              id="resource-action-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={pending}
              autoComplete="off"
              className="text-base"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={review.action === "remove" ? "destructive" : "default"}
              disabled={
                pending || confirmation !== `${review.action} production`
              }
              onClick={() => void confirm()}
            >
              {pending ? "Starting…" : `Confirm ${review.action}`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setReview(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
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
    </details>
  )
}
