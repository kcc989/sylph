import puppeteer from "@cloudflare/puppeteer"

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
