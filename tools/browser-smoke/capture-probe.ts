import puppeteer from "@cloudflare/puppeteer"

export const ownedContextProbe = async (binding: BrowserRun, url: string) => {
  const endpoint = {
    fetch: Object.assign(binding.fetch.bind(binding), globalThis.fetch),
  }
  let browser = await puppeteer.launch(endpoint, { keep_alive: 60_000 })
  const id = browser.sessionId()
  const results: { phase: string; bytes?: number; contexts?: string[] }[] = []
  try {
    const root = await browser.target().createCDPSession()
    const { browserContextId } = await root.send(
      "Target.createBrowserContext",
      {
        disposeOnDetach: true,
      }
    )
    await root.send("Target.createTarget", { url, browserContextId })
    const target = await browser.waitForTarget(
      (target) => target.url() === url,
      {
        timeout: 15_000,
      }
    )
    const page = await target.page()
    if (!page) throw new Error("Owned context has no page")
    await page.setViewport({ width: 800, height: 600 })
    const session = await page.createCDPSession()
    for (const phase of ["owned-initial", "owned-idle"]) {
      if (phase === "owned-idle")
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      const capture = await session.send(
        "Page.captureScreenshot",
        {
          format: "png",
        },
        { timeout: 15_000 }
      )
      results.push({ phase, bytes: capture.data.length })
    }
    await browser.disconnect()
    browser = await puppeteer.connect(endpoint, id)
    const reconnected = await browser.target().createCDPSession()
    const { browserContextIds } = await reconnected.send(
      "Target.getBrowserContexts"
    )
    results.push({ phase: "owner-disconnected", contexts: browserContextIds })
    if (browserContextIds.includes(browserContextId))
      throw new Error("Owned browser context survived its transport owner")
    return results
  } finally {
    await browser.close()
  }
}

export const captureProbe = async (binding: BrowserRun, url: string) => {
  const endpoint = {
    fetch: Object.assign(binding.fetch.bind(binding), globalThis.fetch),
  }
  let browser = await puppeteer.launch(endpoint, { keep_alive: 60_000 })
  const results: { phase: string; bytes?: number; error?: string }[] = []
  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 })
    let session = await page.createCDPSession()
    const capture = async (phase: string) => {
      try {
        const result = await session.send(
          "Page.captureScreenshot",
          { format: "png" },
          { timeout: 15_000 }
        )
        results.push({ phase, bytes: result.data.length })
      } catch (error) {
        results.push({
          phase,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    await capture("before-freeze")
    await session.send("Page.setWebLifecycleState", { state: "frozen" })
    await session.send("Page.setWebLifecycleState", { state: "active" })
    await capture("after-freeze-without-disconnect")
    await page.setViewport({ width: 801, height: 600 })
    await page.setViewport({ width: 800, height: 600 })
    await capture("after-viewport-repaint")
    await session.send("Page.stopLoading")
    await session.send("Page.setWebLifecycleState", { state: "frozen" })
    await session.send("Page.setWebLifecycleState", { state: "active" })
    await capture("after-stop-and-freeze")
    const id = browser.sessionId()
    await session.send("Page.setWebLifecycleState", { state: "frozen" })
    await browser.disconnect()
    browser = await puppeteer.connect(endpoint, id)
    const target = browser.targets().find((target) => target.type() === "page")
    if (!target) throw new Error("The capture probe lost its page")
    session = await target.createCDPSession()
    await session.send("Page.setWebLifecycleState", { state: "active" })
    await capture("after-freeze-and-reconnect")
    return results
  } finally {
    await browser.close()
  }
}
