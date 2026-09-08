import { subscribe } from "node:diagnostics_channel"
import { gunzipSync } from "node:zlib"
import { Schema } from "effect"

const decodeEnvelope = Schema.decodeUnknownSync(
  Schema.Struct({
    error: Schema.optional(
      Schema.Struct({
        code: Schema.String,
        message: Schema.optional(Schema.String),
      })
    ),
  })
)

subscribe("http2.client.stream.created", ({ stream }) => {
  let pending = Buffer.alloc(0)
  const observe = (chunk) => {
    pending = Buffer.concat([pending, Buffer.from(chunk)])
    if (pending.length > 4_194_304) {
      stream.off("data", observe)
      pending = Buffer.alloc(0)
      return
    }
    while (pending.length >= 5) {
      const size = pending.readUInt32BE(1)
      if (pending.length < size + 5) return
      const flags = pending[0]
      const payload = pending.subarray(5, size + 5)
      pending = pending.subarray(size + 5)
      if (!(flags & 2)) continue
      try {
        const body = flags & 1 ? gunzipSync(payload) : payload
        const error = decodeEnvelope(JSON.parse(body.toString("utf8"))).error
        if (error)
          console.log(
            JSON.stringify({
              diagnostic: "cursor-connect-error",
              code: error.code,
              message: error.message?.slice(0, 2000),
            })
          )
      } catch {
        console.log(JSON.stringify({ diagnostic: "unreadable-connect-error" }))
      }
    }
  }
  queueMicrotask(() => stream.on("data", observe))
})
