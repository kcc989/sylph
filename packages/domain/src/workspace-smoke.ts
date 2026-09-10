import { Schema } from "effect"

export const WorkspaceSmokeBudgetOverride = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  maximumUsd: Schema.Literal(8),
})

export const WorkspaceSmokeRequest = Schema.Struct({
  model: Schema.Literal("x-ai/grok-4.6"),
  max_tokens: Schema.optional(Schema.Number),
  max_completion_tokens: Schema.optional(Schema.Number),
  models: Schema.optional(Schema.Never),
  route: Schema.optional(Schema.Never),
  plugins: Schema.optional(Schema.Never),
  messages: Schema.optional(
    Schema.Array(
      Schema.Struct({
        role: Schema.String,
        content: Schema.optional(
          Schema.NullOr(
            Schema.Union([
              Schema.String,
              Schema.Array(
                Schema.Struct({
                  type: Schema.Literal("text"),
                  text: Schema.String,
                })
              ),
            ])
          )
        ),
      })
    )
  ),
})
