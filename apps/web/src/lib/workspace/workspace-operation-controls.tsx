import { useRef, useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import {
  createWorkspacePreview,
  runWorkspaceChecks,
} from "@/functions/workspaces"

export function WorkspaceOperationControls({
  workspaceId,
  disabled,
  refresh,
}: {
  workspaceId: string
  disabled: boolean
  refresh: () => Promise<void>
}) {
  const checks = useServerFn(runWorkspaceChecks)
  const preview = useServerFn(createWorkspacePreview)
  const checkKey = useRef(crypto.randomUUID())
  const [autoRepair, setAutoRepair] = useState(false)
  const [captureEvidence, setCaptureEvidence] = useState(false)
  const [pending, setPending] = useState<"checks" | "preview" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (kind: "checks" | "preview") => {
    if (pending) return
    setPending(kind)
    setError(null)
    try {
      if (kind === "checks") {
        await checks({
          data: { workspaceId, idempotencyKey: checkKey.current, autoRepair },
        })
        checkKey.current = crypto.randomUUID()
      } else await preview({ data: { workspaceId, captureEvidence } })
      await refresh()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The operation could not start. Try again."
      )
    } finally {
      setPending(null)
    }
  }
  return (
    <div className="shrink-0 border-b p-3">
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        <div className="space-y-2">
          <Button
            size="xs"
            variant="outline"
            disabled={disabled || pending !== null}
            onClick={() => void run("checks")}
          >
            {pending === "checks" ? "Starting checks…" : "Run checks"}
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRepair}
              disabled={disabled || pending !== null}
              onChange={(event) => setAutoRepair(event.target.checked)}
            />
            Automatically fix failed checks
          </label>
        </div>
        <div className="space-y-2">
          <Button
            size="xs"
            variant="outline"
            disabled={disabled || pending !== null}
            onClick={() => void run("preview")}
          >
            {pending === "preview" ? "Starting Preview…" : "Create Preview"}
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={captureEvidence}
              disabled={disabled || pending !== null}
              onChange={(event) => setCaptureEvidence(event.target.checked)}
            />
            Capture browser evidence
          </label>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
