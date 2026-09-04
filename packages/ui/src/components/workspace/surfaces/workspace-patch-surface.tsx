import { useEffect, useState, type ReactNode } from "react"
import { Button } from "@workspace/ui/components/button"

export type WorkspacePatchReader = (
  scope: "working" | "branch"
) => Promise<string>

export function WorkspacePatchSurface({
  scope,
  readPatch,
  patch,
  revision,
  children,
}: {
  scope: "working" | "branch"
  readPatch?: WorkspacePatchReader
  patch?: string
  revision?: string | number
  children: (patch: string | undefined) => ReactNode
}) {
  const [attempt, setAttempt] = useState(0)
  const requestKey = revision ?? readPatch
  const [result, setResult] = useState<{
    requestKey: typeof requestKey
    scope: "working" | "branch"
    patch?: string
    error: boolean
  } | null>(null)
  useEffect(() => {
    if (!readPatch) return
    let active = true
    readPatch(scope).then(
      (value) => {
        if (active) setResult({ requestKey, scope, patch: value, error: false })
      },
      () => {
        if (active)
          setResult((previous) => ({
            requestKey,
            scope,
            error: true,
            patch:
              previous !== null &&
              previous.requestKey === requestKey &&
              previous.scope === scope
                ? previous.patch
                : undefined,
          }))
      }
    )
    return () => {
      active = false
    }
  }, [attempt, readPatch, requestKey, scope])
  if (!readPatch) return children(patch)
  if (!result || result.requestKey !== requestKey || result.scope !== scope) {
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        Loading changes…
      </p>
    )
  }
  return (
    <>
      {result.error ? (
        <div className="p-6">
          <p role="alert" className="mb-3 text-sm">
            Changes could not load. Retry to load the current changes.
          </p>
          <Button
            size="sm"
            onClick={() => setAttempt((current) => current + 1)}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {result.patch !== undefined ? children(result.patch) : null}
    </>
  )
}
