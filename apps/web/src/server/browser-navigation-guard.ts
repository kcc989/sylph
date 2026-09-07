import type { Browser, CDPSession, Page } from "@cloudflare/puppeteer"

export const browserNavigationGuard = async (
  browser: Browser,
  checkUrl: (url: string) => string,
  trace: (phase: string) => Promise<void> = async () => {}
) => {
  await trace("guard-root")
  const root = await browser.target().createCDPSession()
  const connection = root.connection()
  if (!connection) throw new Error("Browser navigation guard has no connection")
  const sessions = new Set<CDPSession>()
  const pending = new Set<Promise<void>>()
  let blocked: string | undefined
  let unavailable = false
  let failureDetail = ""
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
      .send(
        "Fetch.enable",
        { patterns: [{ resourceType: "Document", requestStage: "Request" }] },
        { timeout: 15_000 }
      )
      .then(() => undefined)
      .catch((error) => {
        unavailable = true
        failureDetail = error instanceof Error ? error.message : String(error)
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
        .catch((error) => {
          unavailable = true
          failureDetail = error instanceof Error ? error.message : String(error)
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
  await trace("guard-watch")
  await watch(root)
  await trace("guard-targets")
  for (const target of browser.targets()) {
    if (target.type() !== "page") continue
    await trace("guard-attach-page")
    const session = await target.createCDPSession()
    attach(session)
    await trace("guard-fetch")
    await Promise.all(pending)
    if (unavailable)
      throw new Error(
        `The browser could not guard a frozen page: ${failureDetail}`
      )
    await trace("guard-resume")
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
        `The browser cannot enforce navigation policy; no action is allowed: ${failureDetail}`
      )
    pages.set(page, session)
    await session.send("Page.setWebLifecycleState", { state: "active" })
    return session
  }
  await trace("guard-pages")
  for (const page of await browser.pages()) await prepare(page)
  return {
    prepare,
    async check() {
      await Promise.all(pending)
      if (unavailable)
        throw new Error(
          `The browser navigation guard lost its connection: ${failureDetail}`
        )
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
