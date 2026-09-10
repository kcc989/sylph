import type { Page } from "@playwright/test"

export const browserToolCallsForTurn = (page: Page, prompt: string) =>
  page
    .locator("[data-message-id]")
    .filter({ has: page.getByText(prompt, { exact: true }) })
    .last()
    .locator("xpath=following-sibling::*")
    .getByRole("button", {
      name: /^(Opened .+ in the Preview|Opened the Preview in the browser|Started browser session|Observed browser|Navigated Preview), completed$/,
    })
