import type { WorkspaceRuntimeEvent } from "@workspace/domain"

const encoder = new TextEncoder()

const encodeEvent = (event: WorkspaceRuntimeEvent) =>
  encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)

export const createWorkspaceEventStream = (
  events: AsyncIterable<WorkspaceRuntimeEvent>
) => {
  const iterator = events[Symbol.asyncIterator]()

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) {
          controller.close()
          return
        }
        controller.enqueue(encodeEvent(next.value))
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}

export const workspaceEventResponse = (
  events: AsyncIterable<WorkspaceRuntimeEvent>
) =>
  new Response(createWorkspaceEventStream(events), {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
    },
  })
