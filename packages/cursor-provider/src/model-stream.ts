import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"

async function* modelParts(
  model: LanguageModelV3,
  options: Parameters<LanguageModelV3["doStream"]>[0]
): AsyncGenerator<LanguageModelV3StreamPart> {
  const result = await model.doStream(options)
  yield* result.stream
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
        controller.enqueue({ type: "error", error })
        controller.close()
      }
    },
    async cancel() {
      await parts.return(undefined)
    },
  })
}
