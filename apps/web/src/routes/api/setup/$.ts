import { createFileRoute } from "@tanstack/react-router"
import { env } from "cloudflare:workers"
import { installationSetupRequest } from "@/server/installation-setup"

export const Route = createFileRoute("/api/setup/$")({
  server: {
    handlers: {
      GET: ({ request }) => installationSetupRequest(request, env),
      POST: ({ request }) => installationSetupRequest(request, env),
    },
  },
})
