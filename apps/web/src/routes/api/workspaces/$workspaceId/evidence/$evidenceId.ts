import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"

import { accessibleWorkspace } from "@/server/organization-access"
import { createRequestSession } from "@/server/request-session"

export const Route = createFileRoute(
  "/api/workspaces/$workspaceId/evidence/$evidenceId"
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { session, database } = await createRequestSession(request)
        if (!session) return new Response("Not found", { status: 404 })
        const workspace = await accessibleWorkspace(
          database,
          params.workspaceId,
          session.user.id
        )
        if (!workspace) return new Response("Not found", { status: 404 })
        const object = await env.CHECK_EVIDENCE.get(
          `${params.workspaceId}/${params.evidenceId}`
        )
        if (!object) return new Response("Not found", { status: 404 })
        const headers = new Headers()
        object.writeHttpMetadata(headers)
        headers.set("cache-control", "private, max-age=300")
        headers.set("etag", object.httpEtag)
        return new Response(object.body, { headers })
      },
    },
  },
})
