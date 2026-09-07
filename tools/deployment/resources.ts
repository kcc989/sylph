import * as Alchemy from "alchemy"
import * as Output from "alchemy/Output"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { createHash } from "node:crypto"

const optionalSecret = (name: string) =>
  Config.redacted(name).pipe(
    Config.withDefault(Redacted.make("")),
    Effect.orDie
  )

export const installationSecret = Effect.fn("installationSecret")(function* (
  name: string
) {
  const existing = yield* optionalSecret(name)
  return Redacted.value(existing) ? existing : yield* Alchemy.makeRandom(name)
})

export const deploymentCredentials = Effect.fn("deploymentCredentials")(
  function* () {
    const accountId = yield* Config.string("CLOUDFLARE_ACCOUNT_ID").pipe(
      Effect.orDie
    )
    const resources = { [`com.cloudflare.api.account.${accountId}`]: "*" }
    const configuredRuntimeToken = yield* optionalSecret("CF_TOKEN")
    let runtimeToken:
      | Redacted.Redacted<string>
      | Output.Output<Redacted.Redacted<string>> = configuredRuntimeToken
    if (!Redacted.value(configuredRuntimeToken)) {
      const token = yield* Cloudflare.ApiToken.AccountApiToken("RuntimeToken", {
        accountId,
        policies: [
          {
            effect: "allow",
            resources,
            permissionGroups: [
              "Account Settings Read",
              "Workers Scripts Write",
              "Workers Observability Write",
              "D1 Write",
              "Workers R2 Storage Write",
              "Workers KV Storage Write",
              "Queues Write",
              "Workers Containers Write",
              "Workers CI Write",
              "Workers AI Read",
              "Workers AI Write",
            ],
          },
        ],
      })
      runtimeToken = token.value
    }
    const accessKeyId = yield* optionalSecret("R2_ACCESS_KEY_ID")
    const secretAccessKey = yield* optionalSecret("R2_SECRET_ACCESS_KEY")
    if (
      Boolean(Redacted.value(accessKeyId)) !==
      Boolean(Redacted.value(secretAccessKey))
    ) {
      return yield* Effect.die(
        "Set both R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, or leave both empty"
      )
    }
    if (!Redacted.value(accessKeyId)) {
      const token = yield* Cloudflare.ApiToken.AccountApiToken("BackupToken", {
        accountId,
        policies: [
          {
            effect: "allow",
            resources,
            permissionGroups: ["Workers R2 Storage Write"],
          },
        ],
      })
      return {
        runtimeToken,
        accessKeyId: Output.map(token.tokenId, Redacted.make),
        secretAccessKey: Output.map(token.value, (value) =>
          Redacted.make(
            createHash("sha256").update(Redacted.value(value)).digest("hex")
          )
        ),
      }
    }
    return { runtimeToken, accessKeyId, secretAccessKey }
  }
)
