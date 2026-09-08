import { Layer, Logger, References, Schema } from "effect"
import { providerRuntimeErrorDetail } from "./workspace-error-summary"

export const openCodeLogging = Layer.merge(
  Layer.succeed(References.MinimumLogLevel, "Error"),
  Logger.layer([
    Logger.make((entry) => {
      const message = Array.isArray(entry.message)
        ? entry.message
            .filter((value) => Schema.is(Schema.String)(value))
            .join(" ")
        : Schema.is(Schema.String)(entry.message)
          ? entry.message
          : "OpenCode runtime error"
      const detail = providerRuntimeErrorDetail(entry.cause)
      console.error(message, detail)
    }),
  ])
)
