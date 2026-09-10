import { Effect } from "effect"
import {
  ProjectDeploymentBroker,
  ProjectDeploymentBrokerLive,
} from "./server/deployment-broker"
import { deploymentBrokerStore } from "./server/deployment-broker-store"
import { env } from "cloudflare:workers"
import { smokeIdentityResponse } from "./server/smoke-identity"
import { canonicalInstallationResponse } from "./server/installation-address"
import serverEntry from "@tanstack/react-start/server-entry"

export default {
  fetch: (request: Request) => {
    if (new URL(request.url).pathname.startsWith("/api/project-deployment/"))
      return Effect.runPromise(
        Effect.gen(function* () {
          const broker = yield* ProjectDeploymentBroker
          return yield* broker.handle(request)
        }).pipe(
          Effect.provide(
            ProjectDeploymentBrokerLive({
              store: deploymentBrokerStore(env.DB),
              token: env.CF_TOKEN,
            })
          ),
          Effect.catch(() =>
            Effect.succeed(
              Response.json(
                {
                  error:
                    "Deployment capability denied: request, plan, identity, or expiry is outside the approved scope",
                },
                { status: 403 }
              )
            )
          )
        )
      )
    return (
      smokeIdentityResponse(request, env) ??
      canonicalInstallationResponse(request, env.SYLPH_URL) ??
      serverEntry.fetch(request)
    )
  },
}
