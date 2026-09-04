import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"
import {
  CursorHandle,
  CursorModelCall,
  CursorStreamPart,
  CursorProviderFailure,
} from "@workspace/domain/cursor-provider"
import { Schema } from "effect"

const decodeHandle = Schema.decodeUnknownPromise(CursorHandle)
const decodeCall = Schema.decodeUnknownPromise(CursorModelCall)
const decodePart = Schema.decodeUnknownPromise(CursorStreamPart)

const promptFiles = (options: LanguageModelV3CallOptions) =>
  options.prompt.map((message) => {
    if (message.role === "system" || message.role === "tool") return message
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "file") return part
        if (part.data instanceof URL)
          throw new CursorProviderFailure({
            message: "Cursor requires downloaded file attachments",
          })
        if (!(part.data instanceof Uint8Array)) return part
        let binary = ""
        for (const byte of part.data) binary += String.fromCharCode(byte)
        return { ...part, data: btoa(binary) }
      }),
    }
  })

export const cursorResponseStream = (response: Response) => {
  if (!response.ok || !response.body)
    throw new CursorProviderFailure({
      message: `Cursor provider request failed (${response.status})`,
    })
  let pending = ""
  let finished = false
  return response.body.pipeThrough(new TextDecoderStream()).pipeThrough(
    new TransformStream<string, LanguageModelV3StreamPart>({
      async transform(chunk, controller) {
        pending += chunk
        if (pending.length > 8_388_608)
          throw new CursorProviderFailure({
            message: "Cursor response exceeded the size limit",
          })
        let end = pending.indexOf("\n")
        while (end >= 0) {
          const line = pending.slice(0, end)
          pending = pending.slice(end + 1)
          if (line) {
            const part = await decodePart(JSON.parse(line))
            if (part.type === "finish") finished = true
            if (part.type === "error")
              throw new CursorProviderFailure({ message: part.error })
            controller.enqueue(part)
          }
          end = pending.indexOf("\n")
        }
      },
      flush() {
        if (pending.trim() || !finished)
          throw new CursorProviderFailure({
            message:
              "Cursor stream ended before completion. The provider may have restarted.",
          })
      },
    })
  )
}

export const cursorLanguageModel = (
  modelId: string,
  credential: () => Promise<string>,
  request: (userId: string, request: Request) => Promise<Response>
): LanguageModelV3 => {
  const doStream: LanguageModelV3["doStream"] = async (options) => {
    const handle = await decodeHandle(JSON.parse(await credential()))
    const sessionId =
      options.headers?.["x-opencode-session"] ??
      options.headers?.["x-session-id"] ??
      options.headers?.["x-session-affinity"]
    if (!sessionId)
      throw new CursorProviderFailure({
        message: "OpenCode did not supply a Cursor session identity",
      })
    const call = await decodeCall({
      modelId,
      sessionId,
      options: {
        ...options,
        prompt: promptFiles(options),
        providerOptions: {
          ...options.providerOptions,
          cursor: {
            ...options.providerOptions?.cursor,
            opencodeCompaction:
              options.headers?.["x-sylph-cursor-compaction"] === "true",
          },
        },
      },
    })
    const response = await request(
      handle.userId,
      new Request("http://cursor/", {
        method: "POST",
        body: JSON.stringify({ operation: "stream", key: handle.key, call }),
        signal: options.abortSignal,
      })
    )
    return { stream: cursorResponseStream(response) }
  }
  return {
    specificationVersion: "v3",
    provider: "cursor",
    modelId,
    supportedUrls: {},
    doStream,
    async doGenerate(options): Promise<LanguageModelV3GenerateResult> {
      const { stream } = await doStream(options)
      const content: LanguageModelV3Content[] = []
      let finish:
        | Extract<LanguageModelV3StreamPart, { type: "finish" }>
        | undefined
      let warnings: LanguageModelV3GenerateResult["warnings"] = []
      for await (const part of stream) {
        switch (part.type) {
          case "text-delta":
            content.push({
              type: "text",
              text: part.delta,
              providerMetadata: part.providerMetadata,
            })
            break
          case "reasoning-delta":
            content.push({
              type: "reasoning",
              text: part.delta,
              providerMetadata: part.providerMetadata,
            })
            break
          case "tool-call":
          case "tool-result":
          case "tool-approval-request":
          case "source":
          case "file":
            content.push(part)
            break
          case "finish":
            finish = part
            break
          case "stream-start":
            warnings = part.warnings
            break
        }
      }
      if (!finish)
        throw new CursorProviderFailure({
          message: "Cursor did not finish the response",
        })
      return {
        content,
        finishReason: finish.finishReason,
        usage: finish.usage,
        providerMetadata: finish.providerMetadata,
        warnings,
      }
    },
  }
}
