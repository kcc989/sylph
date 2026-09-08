import { CursorServerError } from "cursor-opencode-provider/errors"
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"

async function* modelParts(
  model: LanguageModelV3,
  options: Parameters<LanguageModelV3["doStream"]>[0]
): AsyncGenerator<LanguageModelV3StreamPart> {
  let current = options
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending: LanguageModelV3StreamPart[] = []
    let emitted = false
    try {
      const result = await model.doStream(current)
      for await (const part of result.stream) {
        if (!emitted && part.type === "stream-start") {
          pending.push(part)
          continue
        }
        emitted = true
        yield* pending.splice(0)
        yield part
      }
      yield* pending
      return
    } catch (error) {
      if (
        attempt !== 0 ||
        emitted ||
        current.providerOptions?.cursor?.maxMode === true ||
        !(error instanceof CursorServerError) ||
        error.code !== "invalid_argument" ||
        !error.message.includes("Max Mode Required")
      )
        throw error
      current = {
        ...current,
        providerOptions: {
          ...current.providerOptions,
          cursor: { ...current.providerOptions?.cursor, maxMode: true },
        },
      }
    }
  }
}

export const cursorModelStream = (
  model: LanguageModelV3,
  options: Parameters<LanguageModelV3["doStream"]>[0]
) => {
  const parts = modelParts(model, options)
  return new ReadableStream<LanguageModelV3StreamPart>({
    async pull(controller) {
      try {
        const next = await parts.next()
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await parts.return(undefined)
    },
  })
}
