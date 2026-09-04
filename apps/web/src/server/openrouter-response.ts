import { Option, Schema } from "effect"

const providerError = Schema.Struct({
  message: Schema.optional(Schema.String),
  error: Schema.optional(
    Schema.Union([Schema.String, Schema.Struct({ message: Schema.String })])
  ),
})
const responseError = Schema.Struct({
  error: Schema.Struct({
    message: Schema.String,
    code: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
    metadata: Schema.Struct({
      raw: Schema.Union([
        providerError,
        Schema.fromJsonString(providerError),
        Schema.String,
      ]),
      provider_name: Schema.optional(Schema.String),
    }),
  }),
})
const decodeError = Schema.decodeUnknownOption(
  Schema.fromJsonString(responseError)
)

const redact = (message: string) =>
  message
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[\w-]+/g, "[redacted]")
    .replace(
      /\b(token|secret|password|authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi,
      "$1=[redacted]"
    )
    .slice(0, 2000)

export const openRouterErrorResponse = async (response: Response) => {
  if (response.ok) return response
  const payload = Option.getOrUndefined(
    decodeError(await response.clone().text())
  )
  const raw = payload?.error.metadata.raw
  const detail = Schema.is(Schema.String)(raw)
    ? raw
    : Schema.is(Schema.String)(raw?.error)
      ? raw.error
      : (raw?.error?.message ?? raw?.message)
  if (!payload || !detail) return response
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  headers.delete("content-encoding")
  return Response.json(
    {
      error: {
        code: payload.error.code,
        message: redact(`${payload.error.message}: ${detail}`),
      },
    },
    { status: response.status, statusText: response.statusText, headers }
  )
}
