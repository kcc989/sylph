import type { Page } from "@cloudflare/puppeteer"
import {
  WorkspaceBrowserFailure,
  browserViewportSize,
  type BrowserViewport,
  type WorkspaceBrowserAction,
  type WorkspaceBrowserAssertion,
} from "@workspace/domain"
import { Context, Effect, Layer } from "effect"

import { browserNavigationGuard } from "./browser-navigation-guard"
import { browserSessionOwner } from "./browser-session-owner"

import { browserTargetUrl, bounded } from "./workspace-browser"
import { browserEvidenceSelector } from "./workspace-ci-browser"

export const browserIdleTimeout = 600_000
const actionTimeout = 15_000

export type BrowserObservation = {
  url: string
  markdown: string
  accessibility: string
  screenshot?: Uint8Array
  viewport?: BrowserViewport
  pageId?: string
  pages?: ReadonlyArray<{ id: string; url: string }>
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

export type BrowserConnectionOptions = {
  allowedOrigins: ReadonlyArray<string>
  viewport: BrowserViewport
  pageId?: string
  captureMode?: "screenshots" | "accessibility"
}

export class BrowserRunClient extends Context.Service<
  BrowserRunClient,
  {
    connect(
      previewUrl: string,
      sessionId?: string,
      options?: BrowserConnectionOptions
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

const actOnPage = async (
  page: Page,
  action: WorkspaceBrowserAction,
  domOnly: boolean
) => {
  switch (action.type) {
    case "click_point": {
      if (domOnly)
        throw new Error(
          "Pointer clicks require screenshot evidence. Use a selector under the DOM-only policy."
        )
      const viewport = page.viewport()
      if (
        !viewport ||
        action.x >= viewport.width ||
        action.y >= viewport.height
      )
        throw new Error(
          "Click is outside the visible viewport. Scroll and observe before clicking."
        )
      await page.mouse.click(action.x, action.y)
      return
    }
    case "type_text":
      await page.keyboard.type(action.value)
      return
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
        if (action.type === "click") {
          if (domOnly)
            await element.evaluate((node) => {
              if (
                !(node instanceof HTMLElement) ||
                node.matches(":disabled") ||
                node.getClientRects().length === 0
              )
                throw new Error(
                  "The selected control is not available for activation"
                )
              node.focus()
              node.click()
            })
          else await element.click()
        }
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
      if (domOnly)
        await page.evaluate(({ x, y }) => window.scrollBy(x, y), {
          x: action.x,
          y: action.y,
        })
      else await page.mouse.wheel({ deltaX: action.x, deltaY: action.y })
      return
    case "wait": {
      if (domOnly) {
        const result = await page.waitForFunction(
          ({ selector, state }) => {
            const node = document.querySelector(selector)
            const visible =
              node !== null &&
              node.getClientRects().length > 0 &&
              getComputedStyle(node).visibility !== "hidden"
            return state === "hidden"
              ? !visible
              : state === "visible"
                ? visible
                : node !== null
          },
          { timeout: actionTimeout, polling: 100 },
          { selector: action.selector, state: action.state }
        )
        await result.dispose()
        return
      }
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

export const browserRunLayer = (
  binding: Pick<BrowserRun, "fetch">,
  trace: (phase: string) => Promise<void> = async () => {}
) => {
  const endpoint = {
    fetch: Object.assign(binding.fetch.bind(binding), globalThis.fetch),
  }
  const owner = browserSessionOwner(
    async (policy: {
      previewUrl: string
      allowedOrigins: ReadonlyArray<string>
    }) => {
      const { default: puppeteer } = await import("@cloudflare/puppeteer")
      const browser = await puppeteer.launch(endpoint, {
        keep_alive: browserIdleTimeout,
      })
      try {
        const checkUrl = (url: string) => browserTargetUrl({ ...policy, url })
        const guard = await browserNavigationGuard(browser, checkUrl, trace)
        return {
          id: browser.sessionId(),
          browser,
          guard,
          checkUrl,
          connected: () => browser.connected,
          async close() {
            try {
              if (browser.connected) await browser.close()
            } finally {
              await browser.disconnect()
            }
          },
        }
      } catch (error) {
        await browser.close()
        throw error
      }
    },
    browserIdleTimeout
  )
  return Layer.succeed(BrowserRunClient, {
    close: Effect.fn("BrowserRunClient.close")((sessionId: string) =>
      Effect.tryPromise({
        try: async () => {
          if (await owner.close(sessionId)) return
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
      (
        previewUrl: string,
        sessionId?: string,
        options?: BrowserConnectionOptions
      ) =>
        Effect.tryPromise({
          try: async () => {
            await trace("connect")
            const retained = await owner.acquire(
              { previewUrl, allowedOrigins: options?.allowedOrigins ?? [] },
              sessionId
            )
            const { browser, guard, checkUrl } = retained
            try {
              await trace("pages")
              const pages = await browser.pages()
              let page = pages[0] ?? (await guard.newPage())
              const pageId = async (target: Page) => {
                const session = await guard.prepare(target)
                return (await session.send("Target.getTargetInfo")).targetInfo
                  .targetId
              }
              if (options?.pageId) {
                const selected = await Promise.all(
                  pages.map(async (candidate) => ({
                    page: candidate,
                    id: await pageId(candidate),
                  }))
                )
                const match = selected.find(
                  (candidate) => candidate.id === options.pageId
                )
                if (match) page = match.page
              }
              let viewport = options?.viewport ?? "desktop"
              const prepare = async (target: Page) => {
                await guard.prepare(target)
                target.setDefaultTimeout(actionTimeout)
                target.setDefaultNavigationTimeout(actionTimeout)
                await target.setViewport(browserViewportSize(viewport))
                await target.bringToFront()
              }
              await trace("viewport")
              await prepare(page)
              await trace("connected")
              const ensureAllowed = async () => {
                await guard.check()
                for (const target of await browser.pages()) {
                  if (target.url() !== "about:blank") checkUrl(target.url())
                }
              }
              return {
                id: browser.sessionId(),
                async navigate(url) {
                  checkUrl(url)
                  await page.goto(url, {
                    waitUntil: "domcontentloaded",
                    timeout: actionTimeout,
                  })
                  await ensureAllowed()
                },
                async verify(commit) {
                  await trace("verify-identity")
                  const marker = await page
                    .waitForSelector(browserEvidenceSelector(commit), {
                      timeout: actionTimeout,
                    })
                    .catch(() => null)
                  if (!marker) {
                    const actual = await page.evaluate(() => ({
                      title: document.title,
                      checkpoint:
                        document
                          .querySelector("[data-sylph-checkpoint]")
                          ?.getAttribute("data-sylph-checkpoint") ?? null,
                      deployment:
                        document
                          .querySelector("[data-sylph-deployment]")
                          ?.getAttribute("data-sylph-deployment") ?? null,
                    }))
                    throw new Error(
                      `The Preview did not render Checkpoint ${commit}: ${JSON.stringify(actual)}`
                    )
                  }
                  await marker.dispose()
                },
                async act(action) {
                  await ensureAllowed()
                  if (action.type === "viewport") {
                    viewport = action.viewport
                    await prepare(page)
                  } else if (action.type === "popup") {
                    checkUrl(action.url)
                    page = await guard.newPage()
                    await prepare(page)
                    await page.goto(action.url, {
                      waitUntil: "domcontentloaded",
                      timeout: actionTimeout,
                    })
                  } else if (action.type === "switch_page") {
                    const candidates = await Promise.all(
                      (await browser.pages()).map(async (target) => ({
                        page: target,
                        id: await pageId(target),
                      }))
                    )
                    const selected = candidates.find(
                      (target) => target.id === action.pageId
                    )
                    if (!selected)
                      throw new Error(
                        "This browser page was closed. Observe the current pages before acting."
                      )
                    page = selected.page
                    await prepare(page)
                  } else
                    await actOnPage(
                      page,
                      action,
                      options?.captureMode === "accessibility"
                    )
                  await ensureAllowed()
                },
                async observe(fullPage) {
                  await trace("observe-policy")
                  await ensureAllowed()
                  await page.bringToFront()
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
                  await ensureAllowed()
                  await trace("observe-dimensions")
                  const dimensions = await page.evaluate(() => ({
                    width: innerWidth,
                    height: innerHeight,
                  }))
                  const expected = browserViewportSize(viewport)
                  if (
                    dimensions.width !== expected.width ||
                    dimensions.height !== expected.height
                  )
                    throw new Error(
                      `Viewport verification failed: expected ${expected.width}×${expected.height}, received ${dimensions.width}×${dimensions.height}`
                    )
                  await trace("observe-content")
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
                  await trace("observe-accessibility")
                  const evidenceSession = await guard.prepare(page)
                  const accessibility = JSON.stringify(
                    await evidenceSession.send(
                      "Accessibility.getFullAXTree",
                      undefined,
                      { timeout: actionTimeout }
                    )
                  )
                  let screenshot: Uint8Array | undefined
                  if (options?.captureMode !== "accessibility") {
                    await trace("observe-screenshot")
                    const bounds = fullPage
                      ? (
                          await evidenceSession.send(
                            "Page.getLayoutMetrics",
                            undefined,
                            { timeout: actionTimeout }
                          )
                        ).cssContentSize
                      : { x: 0, y: 0, ...expected }
                    const capture = await evidenceSession.send(
                      "Page.captureScreenshot",
                      {
                        format: "png",
                        fromSurface: fullPage,
                        captureBeyondViewport: fullPage,
                        clip: { ...bounds, scale: 1 },
                      },
                      { timeout: actionTimeout }
                    )
                    screenshot = Uint8Array.from(
                      atob(capture.data),
                      (character) => character.charCodeAt(0)
                    )
                    const header = new DataView(screenshot.buffer)
                    if (
                      screenshot.byteLength < 24 ||
                      header.getUint32(0) !== 0x89504e47 ||
                      (!fullPage &&
                        (header.getUint32(16) !== expected.width ||
                          header.getUint32(20) !== expected.height))
                    )
                      throw new Error(
                        "The browser screenshot did not match the verified viewport."
                      )
                  }
                  await trace("observe-complete")
                  await ensureAllowed()
                  return {
                    url: page.url(),
                    markdown: bounded(content, 24_000),
                    accessibility,
                    screenshot,
                    viewport,
                    pageId: await pageId(page),
                    pages: await Promise.all(
                      (await browser.pages()).map(async (target) => ({
                        id: await pageId(target),
                        url: target.url(),
                      }))
                    ),
                  }
                },
                async disconnect() {
                  try {
                    await guard.check()
                    owner.release(retained)
                  } catch (error) {
                    await owner.close(retained.id)
                    throw error
                  }
                },
                async close() {
                  await owner.close(retained.id)
                },
              } satisfies BrowserConnection
            } catch (error) {
              await owner.close(retained.id)
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
}
