import { Schema } from "effect"

export const OpenCodeCompressedCacheValue = Schema.Struct({
  format: Schema.Literal("sylph-opencode-gzip-v1"),
  data: Schema.String,
})
