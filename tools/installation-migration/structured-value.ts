import { Schema, Predicate } from "effect"
import { MigrationStoredValue } from "@workspace/domain/installation-migration"
export function encodeStoredValue(value: MigrationStoredValue): string {
  const ancestors = new Set<MigrationStoredValue>()
  function encode(value: MigrationStoredValue): Schema.Json {
    if (value === undefined) return ["undefined"]
    if (
      value === null ||
      Predicate.isString(value) ||
      Predicate.isBoolean(value)
    )
      return ["scalar", value]
    if (Predicate.isNumber(value)) {
      if (!Number.isFinite(value)) throw new Error("Non-finite KV number")
      return ["number", Object.is(value, -0) ? "-0" : String(value)]
    }
    if (Predicate.isBigInt(value)) return ["bigint", String(value)]
    if (ancestors.has(value)) throw new Error("Cyclic KV value is unsupported")
    ancestors.add(value)
    try {
      if (value instanceof Date) return ["date", value.toISOString()]
      if (value instanceof ArrayBuffer)
        return ["bytes", Array.from(new Uint8Array(value))]
      if (value instanceof Uint8Array) return ["uint8", Array.from(value)]
      if (value instanceof Map)
        return [
          "map",
          Array.from(value, ([key, entry]) => [encode(key), encode(entry)]),
        ]
      if (value instanceof Set) return ["set", Array.from(value, encode)]
      if (Array.isArray(value)) return ["array", value.map(encode)]
      if (
        Predicate.isObject(value) &&
        Object.getPrototypeOf(value) === Object.prototype
      )
        return [
          "object",
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => [key, encode(entry)]),
        ]
      throw new Error("Unsupported KV value type")
    } finally {
      ancestors.delete(value)
    }
  }
  return JSON.stringify(encode(value))
}

export function decodeStoredValue(encoded: string): MigrationStoredValue {
  function decode(value: Schema.Json): MigrationStoredValue {
    if (!Array.isArray(value)) throw new Error("Invalid KV encoding")
    const [kind, body] = value
    switch (kind) {
      case "undefined":
        return undefined
      case "scalar":
        return Schema.decodeUnknownSync(
          Schema.Union([Schema.Null, Schema.String, Schema.Boolean])
        )(body)
      case "number":
        return Number(Schema.decodeUnknownSync(Schema.String)(body))
      case "bigint":
        return BigInt(Schema.decodeUnknownSync(Schema.String)(body))
      case "date":
        return new Date(Schema.decodeUnknownSync(Schema.String)(body))
      case "bytes":
        return Uint8Array.from(
          Schema.decodeUnknownSync(Schema.Array(Schema.Number))(body)
        ).buffer
      case "uint8":
        return Uint8Array.from(
          Schema.decodeUnknownSync(Schema.Array(Schema.Number))(body)
        )
      case "array":
        return Schema.decodeUnknownSync(Schema.Array(Schema.Json))(body).map(
          decode
        )
      case "set":
        return new Set(
          Schema.decodeUnknownSync(Schema.Array(Schema.Json))(body).map(decode)
        )
      case "map":
        return new Map(
          Schema.decodeUnknownSync(
            Schema.Array(Schema.Tuple([Schema.Json, Schema.Json]))
          )(body).map(([key, entry]) => [decode(key), decode(entry)])
        )
      case "object":
        return Object.fromEntries(
          Schema.decodeUnknownSync(
            Schema.Array(Schema.Tuple([Schema.String, Schema.Json]))
          )(body).map(([key, entry]) => [key, decode(entry)])
        )
      default:
        throw new Error("Invalid KV encoding kind")
    }
  }
  const value = decode(
    Schema.decodeUnknownSync(Schema.Json)(JSON.parse(encoded))
  )
  if (encodeStoredValue(value) !== encoded)
    throw new Error("Noncanonical KV encoding")
  return value
}
