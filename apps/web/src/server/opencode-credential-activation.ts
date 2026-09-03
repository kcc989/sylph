type OpenCodeCatalogEvent = { type: string }

export type OpenCodeCatalogRefresh = {
  events: {
    subscribe: (options?: {
      signal?: AbortSignal
    }) => AsyncIterable<OpenCodeCatalogEvent>
  }
}

type OpenCodeCredentialActivation = OpenCodeCatalogRefresh & {
  credential: {
    activate: (input: { credentialID: string }) => Promise<void>
  }
}

const waitForEvent = async (
  events: AsyncIterator<OpenCodeCatalogEvent>,
  type: string
) => {
  while (true) {
    const event = await events.next()
    if (event.done) throw new Error("OpenCode event stream ended")
    if (event.value.type === type) return
  }
}

const withTimeout = async (promise: Promise<void>, milliseconds: number) => {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("OpenCode catalog did not refresh")),
          milliseconds
        )
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

export const activateCredentialAndWaitForCatalog = async (
  opencode: OpenCodeCredentialActivation,
  credentialID: string,
  timeoutMilliseconds = 5_000
) =>
  updateCredentialAndWaitForCatalog(
    opencode,
    () => opencode.credential.activate({ credentialID }),
    timeoutMilliseconds
  )

export const updateCredentialAndWaitForCatalog = async (
  opencode: OpenCodeCatalogRefresh,
  update: () => Promise<void>,
  timeoutMilliseconds = 5_000
) => {
  const controller = new AbortController()
  const events = opencode.events
    .subscribe({ signal: controller.signal })
    [Symbol.asyncIterator]()

  try {
    await withTimeout(
      waitForEvent(events, "server.connected"),
      timeoutMilliseconds
    )
    await update()
    await withTimeout(
      waitForEvent(events, "catalog.updated"),
      timeoutMilliseconds
    )
  } finally {
    controller.abort()
  }
}
