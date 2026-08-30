import { createFileRoute } from "@tanstack/react-router"
import { schema } from "@workspace/db"
import { env } from "cloudflare:workers"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"

import { createRequestAuth } from "@/server/auth.server"

export const Route = createFileRoute(
  "/api/workspaces/$workspaceId/evidence/$evidenceId"
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = createRequestAuth(request, env)
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) return new Response("Not found", { status: 404 })
        const workspace = await drizzle(env.DB, { schema })
          .select({ id: schema.workspace.id })
          .from(schema.workspace)
          .innerJoin(
            schema.member,
            and(
              eq(schema.member.organizationId, schema.workspace.organizationId),
              eq(schema.member.userId, session.user.id)
            )
          )
          .where(eq(schema.workspace.id, params.workspaceId))
          .get()
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
