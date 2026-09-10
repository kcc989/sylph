import { expect, test } from "@playwright/test"
import { browserToolCallsForTurn } from "./browser-evidence"

test("earlier browser success cannot satisfy a new Turn", async ({ page }) => {
  await page.setContent(`
    <div role="log">
      <div data-message-id="old"><article><button aria-label="Observed browser, completed">Observed browser</button><a href="/old-evidence">Old screenshot</a></article></div>
      <div data-message-id="request"><article><p>Verify current browser request</p></article></div>
      <div data-message-id="failure"><article><button aria-label="Started browser session, error">Started browser session</button></article></div>
    </div>
  `)
  await expect(
    browserToolCallsForTurn(page, "Verify current browser request")
  ).toHaveCount(0)
})

test("current Turn browser success is found inside a tool group", async ({
  page,
}) => {
  await page.setContent(`
    <div role="log">
      <div data-message-id="old"><article><button aria-label="Observed browser, completed">Observed browser</button></article></div>
      <div data-message-id="request"><article><p>Verify current browser request</p></article></div>
      <div data-message-id="group"><div><article><button aria-label="Started browser session, completed">Started browser session</button><a href="/current-evidence">Current screenshot</a></article></div></div>
    </div>
  `)
  const calls = browserToolCallsForTurn(page, "Verify current browser request")
  await expect(calls).toHaveCount(1)
  await expect(calls.locator("..").getByRole("link")).toHaveAttribute(
    "href",
    "/current-evidence"
  )
})
