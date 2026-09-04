import { isJSONValue, type JSONValue } from "@ai-sdk/provider"
import { Effect, Schema } from "effect"

const JsonValue = Schema.declare<JSONValue>(isJSONValue)
const JsonObject = Schema.Record(Schema.String, JsonValue)
const Metadata = Schema.Record(Schema.String, JsonObject)
const providerOptions = Schema.optional(Metadata)
const providerMetadata = Schema.optional(Metadata)
const Text = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  providerOptions,
})
const Reasoning = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  providerOptions,
})
const File = Schema.Struct({
  type: Schema.Literal("file"),
  data: Schema.String,
  mediaType: Schema.String,
  filename: Schema.optional(Schema.String),
  providerOptions,
})
const Content = Schema.Union([
  Text,
  Schema.Struct({
    type: Schema.Literals(["file-data", "image-data"]),
    data: Schema.String,
    mediaType: Schema.String,
    filename: Schema.optional(Schema.String),
    providerOptions,
  }),
  Schema.Struct({
    type: Schema.Literals(["file-url", "image-url"]),
    url: Schema.String,
    providerOptions,
  }),
  Schema.Struct({
    type: Schema.Literals(["file-id", "image-file-id"]),
    fileId: Schema.Union([
      Schema.String,
      Schema.Record(Schema.String, Schema.String),
    ]),
    providerOptions,
  }),
  Schema.Struct({ type: Schema.Literal("custom"), providerOptions }),
])
const ToolOutput = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(["text", "error-text"]),
    value: Schema.String,
    providerOptions,
  }),
  Schema.Struct({
    type: Schema.Literals(["json", "error-json"]),
    value: JsonValue,
    providerOptions,
  }),
  Schema.Struct({
    type: Schema.Literal("execution-denied"),
    reason: Schema.optional(Schema.String),
    providerOptions,
  }),
  Schema.Struct({
    type: Schema.Literal("content"),
    value: Schema.mutable(Schema.Array(Content)),
    providerOptions,
  }),
])
const ToolResult = Schema.Struct({
  type: Schema.Literal("tool-result"),
  toolCallId: Schema.String,
  toolName: Schema.String,
  output: ToolOutput,
  providerOptions,
})
const ToolCall = Schema.Struct({
  type: Schema.Literal("tool-call"),
  toolCallId: Schema.String,
  toolName: Schema.String,
  input: JsonValue,
  providerExecuted: Schema.optional(Schema.Boolean),
  providerOptions,
})
const Approval = Schema.Struct({
  type: Schema.Literal("tool-approval-response"),
  approvalId: Schema.String,
  approved: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  providerOptions,
})
const Prompt = Schema.mutable(
  Schema.Array(
    Schema.Union([
      Schema.Struct({
        role: Schema.Literal("system"),
        content: Schema.String,
        providerOptions,
      }),
      Schema.Struct({
        role: Schema.Literal("user"),
        content: Schema.mutable(Schema.Array(Schema.Union([Text, File]))),
        providerOptions,
      }),
      Schema.Struct({
        role: Schema.Literal("assistant"),
        content: Schema.mutable(
          Schema.Array(
            Schema.Union([Text, File, Reasoning, ToolCall, ToolResult])
          )
        ),
        providerOptions,
      }),
      Schema.Struct({
        role: Schema.Literal("tool"),
        content: Schema.mutable(
          Schema.Array(Schema.Union([ToolResult, Approval]))
        ),
        providerOptions,
      }),
    ])
  )
)
export const CursorModelCall = Schema.Struct({
  modelId: Schema.NonEmptyString,
  sessionId: Schema.NonEmptyString,
  options: Schema.Struct({
    prompt: Prompt,
    maxOutputTokens: Schema.optional(Schema.Number),
    temperature: Schema.optional(Schema.Number),
    topP: Schema.optional(Schema.Number),
    topK: Schema.optional(Schema.Number),
    presencePenalty: Schema.optional(Schema.Number),
    frequencyPenalty: Schema.optional(Schema.Number),
    seed: Schema.optional(Schema.Number),
    stopSequences: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    tools: Schema.optional(
      Schema.mutable(
        Schema.Array(
          Schema.Struct({
            type: Schema.Literal("function"),
            name: Schema.String,
            description: Schema.optional(Schema.String),
            inputSchema: JsonObject,
            providerOptions,
          })
        )
      )
    ),
    toolChoice: Schema.optional(
      Schema.Union([
        Schema.Struct({ type: Schema.Literals(["auto", "none", "required"]) }),
        Schema.Struct({
          type: Schema.Literal("tool"),
          toolName: Schema.String,
        }),
      ])
    ),
    responseFormat: Schema.optional(
      Schema.Union([
        Schema.Struct({ type: Schema.Literal("text") }),
        Schema.Struct({
          type: Schema.Literal("json"),
          schema: Schema.optional(JsonObject),
          name: Schema.optional(Schema.String),
          description: Schema.optional(Schema.String),
        }),
      ])
    ),
    providerOptions,
  }),
})
export type CursorModelCall = typeof CursorModelCall.Type
const Count = Schema.UndefinedOr(Schema.Number).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(undefined))
)
const Usage = Schema.Struct({
  inputTokens: Schema.Struct({
    total: Count,
    noCache: Count,
    cacheRead: Count,
    cacheWrite: Count,
  }),
  outputTokens: Schema.Struct({ total: Count, text: Count, reasoning: Count }),
  raw: Schema.optional(JsonObject),
})
const FinishReason = Schema.Struct({
  unified: Schema.Literals([
    "stop",
    "length",
    "content-filter",
    "tool-calls",
    "error",
    "other",
  ]),
  raw: Schema.UndefinedOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(undefined))
  ),
})
const Warning = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("unsupported"),
    feature: Schema.String,
    details: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("compatibility"),
    feature: Schema.String,
    details: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("other"), message: Schema.String }),
])
export const CursorStreamPart = Schema.Union([
  Schema.Struct({
    type: Schema.Literals([
      "text-start",
      "text-end",
      "reasoning-start",
      "reasoning-end",
      "tool-input-end",
    ]),
    id: Schema.String,
    providerMetadata,
  }),
  Schema.Struct({
    type: Schema.Literals([
      "text-delta",
      "reasoning-delta",
      "tool-input-delta",
    ]),
    id: Schema.String,
    delta: Schema.String,
    providerMetadata,
  }),
  Schema.Struct({
    type: Schema.Literal("tool-input-start"),
    id: Schema.String,
    toolName: Schema.String,
    providerExecuted: Schema.optional(Schema.Boolean),
    dynamic: Schema.optional(Schema.Boolean),
    title: Schema.optional(Schema.String),
    providerMetadata,
  }),
  Schema.Struct({
    type: Schema.Literal("tool-call"),
    toolCallId: Schema.String,
    toolName: Schema.String,
    input: Schema.String,
    providerExecuted: Schema.optional(Schema.Boolean),
    dynamic: Schema.optional(Schema.Boolean),
    providerMetadata,
  }),
  Schema.Struct({
    type: Schema.Literal("tool-result"),
    toolCallId: Schema.String,
    toolName: Schema.String,
    result: Schema.declare<Exclude<JSONValue, null>>(
      (value) => isJSONValue(value) && value !== null
    ),
    isError: Schema.optional(Schema.Boolean),
    preliminary: Schema.optional(Schema.Boolean),
    dynamic: Schema.optional(Schema.Boolean),
    providerMetadata,
  }),
  Schema.Struct({
    type: Schema.Literal("tool-approval-request"),
    approvalId: Schema.String,
    toolCallId: Schema.String,
    providerMetadata,
  }),
  Schema.Struct({
    type: Schema.Literal("file"),
    data: Schema.String,
    mediaType: Schema.String,
    providerMetadata,
  }),
  Schema.Struct({
    type: Schema.Literal("source"),
    sourceType: Schema.Literal("url"),
    id: Schema.String,
    url: Schema.String,
    title: Schema.optional(Schema.String),
    providerMetadata,
  }),
  Schema.Struct({
    type: Schema.Literal("source"),
    sourceType: Schema.Literal("document"),
    id: Schema.String,
    mediaType: Schema.String,
    title: Schema.String,
    filename: Schema.optional(Schema.String),
    providerMetadata,
  }),
  Schema.Struct({
    type: Schema.Literal("stream-start"),
    warnings: Schema.mutable(Schema.Array(Warning)),
  }),
  Schema.Struct({
    type: Schema.Literal("response-metadata"),
    id: Schema.optional(Schema.String),
    modelId: Schema.optional(Schema.String),
    timestamp: Schema.optional(Schema.DateFromString),
  }),
  Schema.Struct({
    type: Schema.Literal("finish"),
    usage: Usage,
    finishReason: FinishReason,
    providerMetadata,
  }),
  Schema.Struct({ type: Schema.Literal("error"), error: Schema.String }),
])
export type CursorStreamPart = typeof CursorStreamPart.Type
export const CursorTokens = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  refreshToken: Schema.NonEmptyString,
})
export const CursorLogin = Schema.Struct({
  uuid: Schema.NonEmptyString,
  verifier: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  expiresAt: Schema.Number,
})
export const CursorModels = Schema.Array(
  Schema.Struct({
    id: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    context: Schema.Number,
    images: Schema.Boolean,
  })
)
export const CursorHandle = Schema.Struct({
  userId: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
})
export const CursorBridgeRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("login") }),
  Schema.Struct({ operation: Schema.Literal("poll"), login: CursorLogin }),
  Schema.Struct({
    operation: Schema.Literal("refresh"),
    refreshToken: Schema.NonEmptyString,
  }),
  Schema.Struct({
    operation: Schema.Literal("models"),
    accessToken: Schema.NonEmptyString,
  }),
  Schema.Struct({
    operation: Schema.Literal("stream"),
    accessToken: Schema.NonEmptyString,
    call: CursorModelCall,
  }),
])
export class CursorProviderFailure extends Schema.TaggedError<CursorProviderFailure>()(
  "CursorProviderFailure",
  { message: Schema.String }
) {}
export const CursorStoredSecret = Schema.Struct({
  encrypted: Schema.String,
  iv: Schema.String,
})
export const CursorConnection = Schema.Struct({
  key: Schema.NonEmptyString,
  tokens: CursorTokens,
  refreshedAt: Schema.Number,
})
export const CursorRuntimeRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("models"),
    key: Schema.NonEmptyString,
  }),
  Schema.Struct({
    operation: Schema.Literal("stream"),
    key: Schema.NonEmptyString,
    call: CursorModelCall,
  }),
])
export const CursorCompletedLogin = Schema.Struct({
  attemptId: Schema.String,
  key: Schema.String,
  models: CursorModels,
  expiresAt: Schema.Number,
})

export const CursorAccessTokenClaims = Schema.Struct({ exp: Schema.Number })
