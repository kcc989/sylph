import { createFileRoute } from "@tanstack/react-router"
import {
  decodeWorkspacePermissionReplyInputPromise,
  encodeWorkspacePermissionReplyInputSync,
  failureMessage,
} from "@workspace/domain"

import { accessibleWorkspace } from "@/server/organization-access"
import { createRequestSession } from "@/server/request-session"
import { workspaceRuntime } from "@/server/workspace-runtime"

const authorizedRuntime = async (request: Request, workspaceId: string) => {
  const { session, database } = await createRequestSession(request)
  if (!session) return null
  const workspace = await accessibleWorkspace(
    database,
    workspaceId,
    session.user.id
  )
  return workspace ? workspaceRuntime(workspaceId) : null
}

export const Route = createFileRoute("/api/workspaces/$workspaceId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const runtime = await authorizedRuntime(request, params.workspaceId)
        if (!runtime) return new Response("Not found", { status: 404 })

        const response = await runtime.fetch("https://workspace/events", {
          headers: { accept: "text/event-stream" },
        })
        return new Response(response.body, response)
      },
      POST: async ({ request, params }) => {
        const runtime = await authorizedRuntime(request, params.workspaceId)
        if (!runtime) return new Response("Not found", { status: 404 })

        const input = await decodeWorkspacePermissionReplyInputPromise(
          await request.json()
        )
        if (input.workspaceId !== params.workspaceId) {
          return new Response("Workspace permission reply does not match", {
            status: 400,
          })
        }
        try {
          await runtime.replyPermission(
            encodeWorkspacePermissionReplyInputSync(input)
          )
        } catch (cause) {
          return new Response(
            failureMessage(cause, "Workspace runtime failed"),
            { status: 500 }
          )
        }
        return new Response(null, { status: 204 })
      },
    },
  },
})
