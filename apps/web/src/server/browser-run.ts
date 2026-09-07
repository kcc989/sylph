import type { Page } from "@cloudflare/puppeteer"
import {
  WorkspaceBrowserFailure,
  type WorkspaceBrowserAction,
  type WorkspaceBrowserAssertion,
} from "@workspace/domain"
import { Context, Effect, Layer } from "effect"

import { browserTargetUrl, bounded } from "./workspace-browser"
import { browserEvidenceSelector } from "./workspace-ci-browser"

export const browserIdleTimeout = 600_000
const actionTimeout = 15_000

export type BrowserObservation = {
  url: string
  markdown: string
  accessibility: string
  screenshot: Uint8Array
}

export type BrowserConnection = {
  id: string
  navigate(url: string): Promise<void>
  verify(commit: string): Promise<void>
  act(action: WorkspaceBrowserAction): Promise<void>
  observe(fullPage: boolean): Promise<BrowserObservation>
  disconnect(): Promise<void>
  close(): Promise<void>
}

export class BrowserRunClient extends Context.Service<
  BrowserRunClient,
  {
    connect(
      previewUrl: string,
      sessionId?: string
    ): Effect.Effect<BrowserConnection, WorkspaceBrowserFailure>
    close(sessionId: string): Effect.Effect<void, WorkspaceBrowserFailure>
  }
>()("@sylph/server/BrowserRunClient") {}

const assertPage = async (page: Page, assertion: WorkspaceBrowserAssertion) => {
  const actual = await page.$$eval(
    assertion.selector,
    (elements, type) => {
      if (type === "count") return elements.length
      if (type === "visible" && elements.length === 0) return false
      if (elements.length !== 1)
        throw new Error(`Expected one element, found ${elements.length}`)
      const element = elements[0]
      if (type === "text") return element.textContent?.trim() ?? ""
      if (type === "visible") {
        const style = getComputedStyle(element)
        return (
          element.getClientRects().length > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        )
      }
      if (type === "checked" && element instanceof HTMLInputElement)
        return element.checked
      if (
        type === "value" &&
        (element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement)
      )
        return element.value
      throw new Error(`Element does not support ${type}`)
    },
    assertion.type
  )
  if (actual !== assertion.value) {
    throw new Error(
      `Assertion ${assertion.type} failed for ${assertion.selector}: expected ${JSON.stringify(assertion.value)}, received ${JSON.stringify(actual)}`
    )
  }
}

const uniqueElement = async (page: Page, selector: string) => {
  const elements = await page.$$(selector)
  if (elements.length !== 1) {
    await Promise.all(elements.map((element) => element.dispose()))
    throw new Error(
      `Expected one element for ${selector}, found ${elements.length}`
    )
  }
  return elements[0]
}

const actOnPage = async (page: Page, action: WorkspaceBrowserAction) => {
  switch (action.type) {
    case "reload":
      await page.reload({
        waitUntil: "domcontentloaded",
        timeout: actionTimeout,
      })
      return
    case "click":
    case "fill":
    case "select": {
      const element = await uniqueElement(page, action.selector)
      try {
        if (action.type === "click") await element.click()
        if (action.type === "select") await element.select(...action.values)
        if (action.type === "fill") {
          await element.evaluate((node) => {
            if (
              !(
                node instanceof HTMLInputElement ||
                node instanceof HTMLTextAreaElement
              )
            )
              throw new Error("Fill requires an input or textarea")
            if (node.disabled || node.readOnly)
              throw new Error("The field is not editable")
            node.focus()
            node.select()
          })
          await page.keyboard.press("Backspace")
          await page.keyboard.type(action.value)
        }
      } finally {
        await element.dispose()
      }
      return
    }
    case "press":
      if (action.selector) {
        const element = await uniqueElement(page, action.selector)
        try {
          await element.focus()
        } finally {
          await element.dispose()
        }
      }
      await page.keyboard.press(action.key)
      return
    case "scroll":
      await page.mouse.wheel({ deltaX: action.x, deltaY: action.y })
      return
    case "wait": {
      const element = await page.waitForSelector(action.selector, {
        visible: action.state === "visible",
        hidden: action.state === "hidden",
        timeout: actionTimeout,
      })
      await element?.dispose()
      return
    }
    case "assert":
      await assertPage(page, action.assertion)
      return
    default:
      return
  }
}

export const browserRunLayer = (binding: Pick<BrowserRun, "fetch">) =>
  Layer.succeed(BrowserRunClient, {
    close: Effect.fn("BrowserRunClient.close")((sessionId: string) =>
      Effect.tryPromise({
        try: async () => {
          const { default: puppeteer } = await import("@cloudflare/puppeteer")
          const endpoint = {
            fetch: Object.assign(binding.fetch.bind(binding), globalThis.fetch),
          }
          const sessions = await puppeteer.sessions(endpoint)
          if (!sessions.some((session) => session.sessionId === sessionId))
            return
          const browser = await puppeteer.connect(endpoint, sessionId)
          try {
            await browser.close()
          } finally {
            await browser.disconnect()
          }
        },
        catch: (cause) =>
          new WorkspaceBrowserFailure({
            reason: "unavailable",
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      })
    ),
    connect: Effect.fn("BrowserRunClient.connect")(
      (previewUrl: string, sessionId?: string) =>
        Effect.tryPromise({
          try: async () => {
            const { default: puppeteer } = await import("@cloudflare/puppeteer")
            const endpoint = {
              fetch: Object.assign(
                binding.fetch.bind(binding),
                globalThis.fetch
              ),
            }
            const browser = sessionId
              ? await puppeteer.connect(endpoint, sessionId)
              : await puppeteer.launch(endpoint, {
                  keep_alive: browserIdleTimeout,
                })
            try {
              const pages = await browser.pages()
              if (sessionId && pages.length !== 1)
                throw new Error(
                  "The browser page was closed or additional tabs were opened. Start a new session."
                )
              const page = pages[0] ?? (await browser.newPage())
              page.setDefaultTimeout(actionTimeout)
              page.setDefaultNavigationTimeout(actionTimeout)
              await page.setViewport({ width: 1440, height: 900 })
              let blocked: string | undefined
              const checkUrl = (url: string) =>
                browserTargetUrl({ previewUrl, url })
              await page.setRequestInterception(true)
              page.on("request", (request) => {
                if (request.isInterceptResolutionHandled()) return
                if (request.isNavigationRequest()) {
                  try {
                    checkUrl(request.url())
                  } catch {
                    blocked = "Navigation outside the Preview was blocked"
                    void request.abort().catch(() => undefined)
                    return
                  }
                }
                void request.continue().catch(() => undefined)
              })
              page.on("popup", (popup) => {
                blocked =
                  "Popup journeys are not supported in this browser session"
                void popup?.close().catch(() => undefined)
              })
              const ensureAllowed = () => {
                if (blocked) throw new Error(blocked)
                checkUrl(page.url())
              }
              return {
                id: browser.sessionId(),
                async navigate(url) {
                  checkUrl(url)
                  await page.goto(url, {
                    waitUntil: "domcontentloaded",
                    timeout: actionTimeout,
                  })
                  ensureAllowed()
                },
                async verify(commit) {
                  const marker = await page.waitForSelector(
                    browserEvidenceSelector(commit),
                    { timeout: actionTimeout }
                  )
                  if (!marker)
                    throw new Error(
                      "The Preview did not render the expected Checkpoint identity"
                    )
                  await marker.dispose()
                },
                async act(action) {
                  ensureAllowed()
                  await actOnPage(page, action)
                  ensureAllowed()
                },
                async observe(fullPage) {
                  ensureAllowed()
                  try {
                    await page.waitForNetworkIdle({
                      idleTime: 300,
                      timeout: 3_000,
                    })
                  } catch (error) {
                    if (
                      !(error instanceof Error && error.name === "TimeoutError")
                    )
                      throw error
                  }
                  ensureAllowed()
                  const content = await page.evaluate(() => {
                    const fields = Array.from(
                      document.querySelectorAll(
                        "input, textarea, select, button, a"
                      )
                    )
                      .slice(0, 100)
                      .map((element) => ({
                        tag: element.tagName.toLowerCase(),
                        id: element.id,
                        name: element.getAttribute("name"),
                        type: element.getAttribute("type"),
                        label: element.getAttribute("aria-label"),
                        text: element.textContent?.trim().slice(0, 200),
                      }))
                    return `# ${document.title}\n\n${document.body.innerText.slice(0, 24_000)}\n\nControls (CSS selectors):\n${JSON.stringify(fields)}`
                  })
                  const accessibility = JSON.stringify(
                    await page.accessibility.snapshot()
                  )
                  const screenshot = await page.screenshot({
                    type: "png",
                    fullPage,
                  })
                  ensureAllowed()
                  return {
                    url: page.url(),
                    markdown: bounded(content, 24_000),
                    accessibility,
                    screenshot,
                  }
                },
                async disconnect() {
                  try {
                    if (browser.connected && !page.isClosed())
                      await page.setRequestInterception(false)
                  } finally {
                    await browser.disconnect()
                  }
                },
                close: () => browser.close(),
              } satisfies BrowserConnection
            } catch (error) {
              await browser.close()
              throw error
            }
          },
          catch: (error) =>
            new WorkspaceBrowserFailure({
              reason: "unavailable",
              message: error instanceof Error ? error.message : String(error),
            }),
        })
    ),
  })
