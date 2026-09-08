import type { Browser, CDPSession, Page } from "@cloudflare/puppeteer"

export const browserNavigationGuard = async (
  browser: Browser,
  checkUrl: (url: string) => string,
  trace: (phase: string) => Promise<void> = async () => {}
) => {
  await trace("guard-root")
  const root = await browser.target().createCDPSession()
  let blocked: string | undefined
  let unavailable: string | undefined
  root.on("Fetch.requestPaused", (request) => {
    let allowed = true
    try {
      checkUrl(request.request.url)
    } catch {
      allowed = false
      blocked =
        "Navigation outside the Preview and configured OAuth origins was blocked."
    }
    const response = allowed
      ? root.send("Fetch.continueRequest", { requestId: request.requestId })
      : root.send("Fetch.failRequest", {
          requestId: request.requestId,
          errorReason: "BlockedByClient",
        })
    void response.catch((error) => {
      unavailable = error instanceof Error ? error.message : String(error)
      void browser.close().catch(() => browser.disconnect())
    })
  })
  await trace("guard-browser-fetch")
  await root.send(
    "Fetch.enable",
    {
      patterns: [{ resourceType: "Document", requestStage: "Request" }],
    },
    { timeout: 15_000 }
  )
  const { browserContextId } = await root.send("Target.createBrowserContext", {
    disposeOnDetach: true,
  })
  for (const page of await browser.pages()) await page.close()
  const pages = new Map<Page, CDPSession>()
  const prepare = async (page: Page) => {
    const existing = pages.get(page)
    if (existing) return existing
    const session = await page.createCDPSession()
    pages.set(page, session)
    return session
  }
  return {
    prepare,
    async newPage() {
      const { targetId } = await root.send("Target.createTarget", {
        url: "about:blank",
        browserContextId,
      })
      const target = await browser.waitForTarget(
        async (candidate) => {
          if (candidate.type() !== "page") return false
          const session = await candidate.createCDPSession()
          try {
            return (
              (await session.send("Target.getTargetInfo")).targetInfo
                .targetId === targetId
            )
          } finally {
            await session.detach()
          }
        },
        { timeout: 15_000 }
      )
      const page = await target.page()
      if (!page) throw new Error("The owned browser context has no page")
      await prepare(page)
      return page
    },
    async check() {
      if (blocked) throw new Error(blocked)
      if (unavailable || !browser.connected)
        throw new Error(
          `The browser navigation guard lost its connection: ${unavailable ?? "disconnected"}`
        )
    },
  }
}
