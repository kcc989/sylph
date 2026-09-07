import { DeployedSmokeIdentity } from "@workspace/domain/lifecycle-proof"
import { Schema } from "effect"

interface SmokeIdentityEnvironment {
  SYLPH_SMOKE_SOURCE_COMMIT?: string
  SYLPH_SMOKE_TEMPLATE_COMMIT?: string
  SYLPH_SMOKE_STAGE?: string
}

export function smokeIdentityResponse(
  request: Request,
  environment: SmokeIdentityEnvironment
) {
  if (new URL(request.url).pathname !== "/__sylph/smoke-identity") return null
  if (!environment.SYLPH_SMOKE_STAGE) return new Response(null, { status: 404 })
  const decoded = Schema.decodeUnknownExit(DeployedSmokeIdentity)({
    sourceCommit: environment.SYLPH_SMOKE_SOURCE_COMMIT,
    templateCommit: environment.SYLPH_SMOKE_TEMPLATE_COMMIT,
    stage: environment.SYLPH_SMOKE_STAGE,
  })
  if (decoded._tag !== "Success") return new Response(null, { status: 404 })
  return Response.json(decoded.value, {
    headers: { "Cache-Control": "no-store" },
  })
}
