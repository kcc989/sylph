import {
  checkDeployment,
  DeploymentConfiguration,
} from "../tools/deployment/config"
import { Schema } from "effect"

try {
  const input = Schema.decodeUnknownSync(DeploymentConfiguration)({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    setupCode: process.env.INSTALLATION_CLAIM_SECRET,
    domain: process.env.SYLPH_DOMAIN ?? "",
  })
  const checked = await checkDeployment(input)
  console.log(
    `Cloudflare account, R2, Artifacts, and address checks passed. Address: ${checked.domain || `${checked.subdomain}.workers.dev`}`
  )
} catch (cause) {
  console.error(
    Schema.isSchemaError(cause)
      ? "Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and INSTALLATION_CLAIM_SECRET (32–256 characters)."
      : cause instanceof Error
        ? cause.message
        : "Deployment checks failed"
  )
  process.exitCode = 1
}
