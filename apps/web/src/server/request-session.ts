import { schema } from "@workspace/db"
import { env } from "cloudflare:workers"
import { drizzle } from "drizzle-orm/d1"

import { createRequestAuth } from "@/server/auth.server"

export const createRequestSession = async (request: Request) => {
  const auth = createRequestAuth(request, env)
  const session = await auth.api.getSession({ headers: request.headers })
  return { auth, session, database: drizzle(env.DB, { schema }) }
}
