import { Schema } from "effect"

export const ManagedKvMetadata = Schema.Json
export const ManagedKvRecord = Schema.Struct({
  version: Schema.NonEmptyString,
  digest: Schema.String,
  metadata: Schema.String,
  expiration: Schema.NullOr(Schema.Number),
})
export const ManagedKvKey = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512)
)
export class ManagedKvFailure extends Schema.TaggedError<ManagedKvFailure>()(
  "ManagedKvFailure",
  { message: Schema.String }
) {}
