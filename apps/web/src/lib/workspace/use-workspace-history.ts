import { useServerFn } from "@tanstack/react-start"
import { useEffect, useRef, useState } from "react"
import { getWorkspaceMessages } from "@/functions/workspaces"

type MessagePage = Awaited<ReturnType<typeof getWorkspaceMessages>>

export const useWorkspaceHistory = (
  workspaceId: string,
  sessionId: string | null,
  latestCursor: string | null | undefined
) => {
  const readMessages = useServerFn(getWorkspaceMessages)
  const [page, setPage] = useState<MessagePage | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const busy = useRef(false)
  useEffect(() => {
    request.current += 1
    busy.current = false
    setPage(null)
    setPending(false)
    setError(null)
    return () => {
      request.current += 1
    }
  }, [workspaceId, sessionId])

  const cursor = page ? page.cursor : latestCursor
  const loadOlder = async () => {
    if (!cursor || busy.current) return
    busy.current = true
    setPending(true)
    setError(null)
    const currentRequest = ++request.current
    try {
      const next = await readMessages({ data: { workspaceId, cursor } })
      if (request.current === currentRequest)
        setPage((current) =>
          next.messages.length || !current ? next : { ...current, cursor: null }
        )
    } catch {
      if (request.current === currentRequest)
        setError("Could not load earlier messages. Try again.")
    } finally {
      if (request.current === currentRequest) {
        busy.current = false
        setPending(false)
      }
    }
  }

  const showLatest = () => {
    request.current += 1
    busy.current = false
    setPending(false)
    setError(null)
    setPage(null)
  }

  return {
    page,
    hasOlder: Boolean(cursor),
    pending,
    error,
    loadOlder,
    showLatest,
  }
}
