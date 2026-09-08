import type { Browser, CDPSession, Page } from "@cloudflare/puppeteer"

export const browserNavigationGuard = async (
  browser: Browser,
  checkUrl: (url: string) => string,
  trace: (phase: string) => Promise<void> = async () => {}
) => {
  await trace("guard-root")
  const root = await browser.target().createCDPSession()
  const { browserContextId } = await root.send("Target.createBrowserContext", {
    disposeOnDetach: true,
  })
  for (const page of await browser.pages()) await page.close()
  const connection = root.connection()
  if (!connection) throw new Error("Browser navigation guard has no connection")
  const sessions = new Set<CDPSession>()
  const pending = new Set<Promise<void>>()
  const targets = new Set<Promise<void>>()
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
      const ready = watch(session)
        .then(async () => {
          await Promise.all(pending)
          if (unavailable) await browser.close()
          else {
            await session.send("Runtime.runIfWaitingForDebugger", undefined, {
              timeout: 15_000,
            })
          }
        })
        .catch((error) => {
          unavailable = true
          failureDetail = error instanceof Error ? error.message : String(error)
        })
        .finally(() => {
          targets.delete(ready)
        })
      targets.add(ready)
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
      throw new Error(`The browser could not guard a page: ${failureDetail}`)
    await trace("guard-resume")
    await session.send("Runtime.runIfWaitingForDebugger", undefined, {
      timeout: 15_000,
    })
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
    return session
  }
  await trace("guard-pages")
  while (targets.size) await Promise.all(targets)
  for (const page of await browser.pages()) await prepare(page)
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
      while (targets.size) await Promise.all(targets)
      await Promise.all(pending)
      if (unavailable)
        throw new Error(
          `The browser navigation guard lost its connection: ${failureDetail}`
        )
      if (blocked) {
        throw new Error(blocked)
      }
    },
  }
}
