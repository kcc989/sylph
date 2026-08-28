import { createFileRoute } from "@tanstack/react-router"
import { schema } from "@workspace/db"
import { decodeWorkspacePermissionReplyInputPromise } from "@workspace/domain"
import { env } from "cloudflare:workers"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"

import { createRequestAuth } from "@/server/auth.server"

const workspaceRuntime = async (request: Request, workspaceId: string) => {
  const auth = createRequestAuth(request, env)
  const session = await auth.api.getSession({ headers: request.headers })

  if (!session) return null

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
    .where(eq(schema.workspace.id, workspaceId))
    .get()

  if (!workspace) return null

  return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId))
}

export const Route = createFileRoute("/api/workspaces/$workspaceId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const runtime = await workspaceRuntime(request, params.workspaceId)
        if (!runtime) return new Response("Not found", { status: 404 })

        const response = await runtime.fetch("https://workspace/events", {
          headers: { accept: "text/event-stream" },
        })
        return new Response(response.body, response)
      },
      POST: async ({ request, params }) => {
        const runtime = await workspaceRuntime(request, params.workspaceId)
        if (!runtime) return new Response("Not found", { status: 404 })

        const input = await decodeWorkspacePermissionReplyInputPromise(
          await request.json()
        )
        if (input.workspaceId !== params.workspaceId) {
          return new Response("Workspace permission reply does not match", {
            status: 400,
          })
        }
        const response = await runtime.fetch(
          "https://workspace/permission/reply",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          }
        )
        return new Response(response.body, response)
      },
    },
  },
})
