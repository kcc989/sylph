import { Effect } from "effect"

export const reconcilePrivateBucket = async (run, token) => {
  const { Bucket, ProviderLive } = await import(
    new URL(
      "../../node_modules/alchemy/src/Cloudflare/R2/Bucket.ts",
      import.meta.url
    ).href
  )
  const { findProvider } = await import("alchemy/Provider")
  const { CloudflareEnvironment } = await import(
    new URL(
      "../../node_modules/alchemy/src/Cloudflare/CloudflareEnvironment.ts",
      import.meta.url
    ).href
  )
  const { fromApiToken } =
    await import("@distilled.cloud/cloudflare/Credentials")
  const FetchHttpClient = await import("effect/unstable/http/FetchHttpClient")
  const { Redacted } = await import("effect")
  const fetcher = Object.assign(
    async (input, init) => {
      const request = new Request(input, init)
      return run(
        new URL(request.url).pathname.replace("/accounts/account", ""),
        {
          method: request.method,
          headers: request.headers,
          body: ["GET", "HEAD"].includes(request.method)
            ? undefined
            : await request.text(),
        }
      )
    },
    { preconnect: fetch.preconnect }
  )
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* findProvider(Bucket)
      return yield* provider.reconcile({
        id: "Bucket",
        fqn: "Bucket",
        instanceId: "fixture",
        news: { name: "bucket-a" },
        olds: undefined,
        output: undefined,
        session: {
          emit: () => Effect.void,
          done: () => Effect.void,
          note: () => Effect.void,
        },
        bindings: [],
      })
    }).pipe(
      Effect.provide(ProviderLive()),
      Effect.provideService(
        CloudflareEnvironment,
        Effect.succeed({
          type: "apiToken",
          apiToken: Redacted.make(token),
          accountId: "account",
          source: { type: "env" },
        })
      ),
      Effect.provide(
        fromApiToken({
          apiToken: token,
          apiBaseUrl: "https://platform.example",
        })
      ),
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetcher)
    )
  )
  return result
}
