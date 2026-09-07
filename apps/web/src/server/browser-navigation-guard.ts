import type { Browser, CDPSession, Page } from "@cloudflare/puppeteer"

export const browserNavigationGuard = async (
  browser: Browser,
  checkUrl: (url: string) => string
) => {
  const root = await browser.target().createCDPSession()
  const connection = root.connection()
  if (!connection) throw new Error("Browser navigation guard has no connection")
  const sessions = new Set<CDPSession>()
  const pending = new Set<Promise<void>>()
  let blocked: string | undefined
  let unavailable = false
  const attach = (session: CDPSession) => {
    if (sessions.has(session)) return
    sessions.add(session)
    session.on("Fetch.requestPaused", (request) => {
      let allowed = true
      if (request.resourceType === "Document") {
        try {
          checkUrl(request.request.url)
        } catch {
          allowed = false
          blocked =
            "Navigation outside the Preview and configured OAuth origins was blocked."
        }
      }
      const response = allowed
        ? session.send("Fetch.continueRequest", {
            requestId: request.requestId,
          })
        : session.send("Fetch.failRequest", {
            requestId: request.requestId,
            errorReason: "BlockedByClient",
          })
      void response
        .then(async () => {
          if (!allowed) await session.send("Page.close")
        })
        .catch(() => {
          if (allowed) unavailable = true
        })
    })
    const ready = session
      .send("Fetch.enable", {
        patterns: [{ resourceType: "Document", requestStage: "Request" }],
      })
      .then(() => undefined)
      .catch(() => {
        unavailable = true
      })
      .finally(() => {
        pending.delete(ready)
      })
    pending.add(ready)
  }
  const watch = async (parent: CDPSession) => {
    parent.on("Target.attachedToTarget", (event) => {
      const session = connection.session(event.sessionId)
      if (!session) {
        unavailable = true
        return
      }
      if (event.targetInfo.type === "page") attach(session)
      void watch(session)
        .then(async () => {
          await Promise.all(pending)
          if (unavailable) await browser.close()
          else {
            if (event.targetInfo.type === "page")
              await session.send(
                "Page.setWebLifecycleState",
                { state: "active" },
                { timeout: 15_000 }
              )
            await session.send("Runtime.runIfWaitingForDebugger", undefined, {
              timeout: 15_000,
            })
          }
        })
        .catch(() => {
          unavailable = true
        })
    })
    await parent.send(
      "Target.setAutoAttach",
      {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [
          { type: parent === root ? "tab" : "page", exclude: false },
          { exclude: true },
        ],
      },
      { timeout: 15_000 }
    )
  }
  await watch(root)
  for (const target of browser.targets()) {
    if (target.type() !== "page") continue
    const session = await target.createCDPSession()
    attach(session)
    await Promise.all(pending)
    if (unavailable)
      throw new Error("The browser could not guard a frozen page.")
    await session.send(
      "Page.setWebLifecycleState",
      { state: "active" },
      { timeout: 15_000 }
    )
  }
  const pages = new Map<Page, CDPSession>()
  const prepare = async (page: Page) => {
    const existing = pages.get(page)
    if (existing) return existing
    const session = await page.createCDPSession()
    attach(session)
    await Promise.all(pending)
    if (unavailable)
      throw new Error(
        "The browser cannot enforce navigation policy; no action is allowed."
      )
    pages.set(page, session)
    await session.send("Page.setWebLifecycleState", { state: "active" })
    return session
  }
  for (const page of await browser.pages()) await prepare(page)
  return {
    prepare,
    async check() {
      await Promise.all(pending)
      if (unavailable)
        throw new Error("The browser navigation guard lost its connection.")
      if (blocked) {
        const message = blocked
        blocked = undefined
        throw new Error(message)
      }
    },
    async disconnect() {
      try {
        for (const page of await browser.pages()) {
          const session = await prepare(page)
          await session.send("Page.stopLoading")
          await session.send("Page.setWebLifecycleState", { state: "frozen" })
        }
      } catch (error) {
        await browser.close()
        throw error
      } finally {
        await root.detach()
        await browser.disconnect()
      }
    },
  }
}
