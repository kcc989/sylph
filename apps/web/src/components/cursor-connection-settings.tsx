import { useEffect, useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { ExternalLink, LoaderCircle } from "lucide-react"
import { failureMessage } from "@workspace/domain"
import {
  startCursorSubscription,
  getCursorSubscriptionStatus,
  cancelCursorSubscription,
} from "@/functions/cursor-connections"
import { disconnectOpenCodeConnection } from "@/functions/provider-connections"

type CursorAttempt = Awaited<ReturnType<typeof startCursorSubscription>>

export function CursorConnectionSettings({
  organizationId,
  connected,
}: {
  organizationId: string
  connected: boolean
}) {
  const router = useRouter()
  const start = useServerFn(startCursorSubscription)
  const status = useServerFn(getCursorSubscriptionStatus)
  const cancel = useServerFn(cancelCursorSubscription)
  const disconnect = useServerFn(disconnectOpenCodeConnection)
  const [attempt, setAttempt] = useState<CursorAttempt | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!attempt) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await status({
          data: { organizationId, scope: "user", attemptId: attempt.attemptId },
        })
        if (!active) return
        if (result.status === "complete") {
          setAttempt(null)
          await router.invalidate()
        } else if (result.status === "pending") {
          timer = setTimeout(poll, 2000)
        } else {
          setAttempt(null)
          setError("Cursor sign-in expired or failed. Start again.")
        }
      } catch (cause) {
        if (!active) return
        setAttempt(null)
        setError(failureMessage(cause, "Could not check Cursor sign-in"))
      }
    }
    timer = setTimeout(poll, 1000)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [attempt, organizationId, router, status])

  const connect = async () => {
    setPending(true)
    setError(null)
    try {
      setAttempt(await start({ data: { organizationId, scope: "user" } }))
    } catch (cause) {
      setError(failureMessage(cause, "Could not start Cursor sign-in"))
    } finally {
      setPending(false)
    }
  }
  const remove = async () => {
    setPending(true)
    setError(null)
    try {
      await disconnect({
        data: { organizationId, scope: "user", providerId: "cursor" },
      })
      await router.invalidate()
    } catch (cause) {
      setError(failureMessage(cause, "Could not disconnect Cursor"))
    } finally {
      setPending(false)
    }
  }
  const cancelAttempt = async () => {
    if (!attempt) return
    const current = attempt
    setAttempt(null)
    setPending(true)
    try {
      await cancel({
        data: { organizationId, scope: "user", attemptId: current.attemptId },
      })
    } catch (cause) {
      setError(failureMessage(cause, "Could not cancel Cursor sign-in"))
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="border-b py-6">
      <h2 className="text-sm font-semibold">Cursor subscription</h2>
      <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
        {connected
          ? "Your personal Cursor account is connected."
          : "Use your personal Cursor subscription in Sylph."}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {attempt ? (
          <>
            <Button
              nativeButton={false}
              render={<a href={attempt.url} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink /> Sign in to Cursor
            </Button>
            <Button variant="ghost" onClick={() => void cancelAttempt()}>
              Cancel
            </Button>
            <p role="status" className="text-xs text-muted-foreground">
              Waiting for sign-in…
            </p>
          </>
        ) : (
          <>
            <Button disabled={pending} onClick={() => void connect()}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              {connected ? "Reconnect Cursor" : "Connect Cursor"}
            </Button>
            {connected ? (
              <Button
                disabled={pending}
                variant="ghost"
                onClick={() => void remove()}
              >
                Disconnect
              </Button>
            ) : null}
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}
