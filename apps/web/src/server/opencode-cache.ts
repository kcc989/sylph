import { Buffer } from "node:buffer"
import { gzipSync, gunzipSync } from "node:zlib"
import { KV } from "@opencode-ai/core/kv"
import { OpenCodeCompressedCacheValue } from "@workspace/domain/opencode-cache"
import { Effect, Layer, Schema } from "effect"

const compressed = Schema.is(OpenCodeCompressedCacheValue)
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))

const encode = (value: KV.Value): KV.Value => {
  const json = JSON.stringify(value)
  if (Buffer.byteLength(json) < 128 * 1024 && !compressed(value)) return value
  return {
    format: "sylph-opencode-gzip-v1",
    data: Buffer.from(gzipSync(json)).toString("base64"),
  }
}

const decode = (value: KV.Value): KV.Value =>
  compressed(value)
    ? decodeJson(
        Buffer.from(gunzipSync(Buffer.from(value.data, "base64"))).toString()
      )
    : value

const compressedCache = (base: KV.Interface): KV.Interface => ({
  get: Effect.fn("OpenCodeCache.get")(function* (key: string) {
    const value = yield* base.get(key)
    return value === undefined ? undefined : decode(value)
  }),
  set: Effect.fn("OpenCodeCache.set")(function* (key: string, value: KV.Value) {
    yield* base.set(key, encode(value))
  }),
  remove: base.remove,
  scan: Effect.fn("OpenCodeCache.scan")(function* (options: KV.ScanOptions) {
    const result = yield* base.scan(options)
    return {
      ...result,
      entries: result.entries.map((entry) => ({
        ...entry,
        value: decode(entry.value),
      })),
    }
  }),
})

const implementation = KV.node.implementation
if (!Layer.isLayer(implementation))
  throw new Error("OpenCode KV implementation is missing")

export const openCodeCacheLayer = Layer.effect(
  KV.Service,
  Effect.gen(function* () {
    return compressedCache(yield* KV.Service)
  })
).pipe(Layer.provide(implementation), Layer.orDie)
