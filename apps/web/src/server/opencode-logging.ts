import { Layer, Logger, Option, References, Schema } from "effect"
import { providerRuntimeErrorDetail } from "./workspace-error-summary"

const pluginFailure = Schema.Struct({
  "plugin.id": Schema.String,
  cause: Schema.Unknown,
})
const decodePluginFailure = Schema.decodeUnknownOption(pluginFailure)

export const openCodeLogging = Layer.merge(
  Layer.succeed(References.MinimumLogLevel, "Warn"),
  Logger.layer([
    Logger.make<unknown, void>((entry) => {
      const message = Array.isArray(entry.message)
        ? entry.message
            .flatMap((value) => {
              if (Schema.is(Schema.String)(value)) return [value]
              const failure = decodePluginFailure(value)
              return Option.isSome(failure)
                ? [
                    failure.value["plugin.id"],
                    providerRuntimeErrorDetail(failure.value.cause),
                  ]
                : []
            })
            .join(" ")
        : Schema.is(Schema.String)(entry.message)
          ? entry.message
          : "OpenCode runtime error"
      const detail = providerRuntimeErrorDetail(entry.cause)
      console.error(message, detail)
    }),
  ])
)
