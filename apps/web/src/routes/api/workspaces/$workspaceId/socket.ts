import { createFileRoute } from "@tanstack/react-router"

import { authorizedRuntime } from "@/routes/api/workspaces/$workspaceId"

export const Route = createFileRoute("/api/workspaces/$workspaceId/socket")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const authorization = await authorizedRuntime(
          request,
          params.workspaceId
        )
        if (!authorization) return new Response("Not found", { status: 404 })
        return authorization.runtime.socket(request, authorization.actor)
      },
    },
  },
})
