import { expect, type Page } from "@playwright/test"

export const waitForHydration = async (page: Page) => {
  await page.waitForFunction(() => !("$_TSR" in window))
}

export const openToolMenu = async (page: Page) => {
  const openInspector = page.getByRole("button", { name: "Open inspector" })
  if (await openInspector.isVisible()) await openInspector.click()
  await page.getByRole("button", { name: "More inspection tools" }).click()
}

export const verifyMarkerJourney = async (page: Page, marker: string) => {
  await page
    .getByRole("region", { name: "Workspace inspector" })
    .getByRole("button", { name: "Preview", exact: true })
    .click()
  await page.getByRole("button", { name: "Set policy", exact: true }).click()
  await page.getByRole("button", { name: "Add journey", exact: true }).click()
  await page
    .getByLabel("Journey name", { exact: true })
    .fill("Current Preview marker")
  await page.getByLabel("Step 1: CSS selector", { exact: true }).fill("body")
  await page.getByLabel("Expected text", { exact: true }).fill(marker)
  await page
    .getByLabel("Reason for this policy", { exact: true })
    .fill(
      "Verify the generated marker in the current Check attempt at desktop and mobile sizes."
    )
  await page.getByRole("button", { name: "Save policy", exact: true }).click()
  const act = async (name: string) => {
    await page.getByRole("button", { name, exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Observe", exact: true })
    ).toBeEnabled()
    await expect(page.getByRole("alert")).toHaveCount(0)
  }
  await act("Start browser")
  await act("Begin attempt")
  for (const viewport of ["desktop", "mobile"]) {
    await page
      .getByLabel("Browser Run viewport", { exact: true })
      .selectOption(viewport)
    await expect(
      page.getByRole("button", { name: "Observe", exact: true })
    ).toBeEnabled()
    await act("Verify next assertion")
  }
  await act("Finish journey")
  await expect(
    page.getByText("Browser acceptance requirement satisfied", { exact: false })
  ).toBeVisible()
}

export const finishWorkspaceTurn = async (
  page: Page,
  allowPriorErrors = false
) => {
  await expect
    .poll(
      async () => {
        const permission = page.getByRole("button", { name: "Always allow" })
        if ((await permission.count()) > 0) {
          await permission.first().click()
          return false
        }
        if (
          (await page.getByText("Agent working", { exact: true }).count()) > 0
        ) {
          return false
        }
        await page.waitForTimeout(1_000)
        return (
          (await permission.count()) === 0 &&
          (await page.getByText("Agent working", { exact: true }).count()) === 0
        )
      },
      { timeout: 15 * 60 * 1000 }
    )
    .toBe(true)
  const assistantError = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Assistant error", exact: true }),
  })
  if (allowPriorErrors) return assistantError.allTextContents()

  await expect(
    assistantError,
    "The agent must complete without a provider or runtime error"
  ).toHaveCount(0)
  return []
}

export const expectExpandableToolCalls = async (page: Page) => {
  const earlier = page.getByRole("button", {
    name: "Earlier messages",
    exact: true,
  })
  for (
    let pageCount = 0;
    pageCount < 20 && (await earlier.count());
    pageCount++
  ) {
    const previous = await page.getByRole("log").innerText()
    await earlier.click()
    await expect(
      page.getByRole("button", { name: "Loading messages…", exact: true })
    ).toHaveCount(0)
    await expect
      .poll(() => page.getByRole("log").innerText())
      .not.toBe(previous)
  }
  await expect(earlier).toHaveCount(0)
  const groupToggle = page.getByRole("button", {
    name: /^Toggle \d+ tool calls:/,
  })
  const completedCalls = page.locator('button[aria-label$=", completed"]')
  if (await groupToggle.count()) {
    const group = groupToggle.first().locator("..")
    const groupedCalls = group.locator('button[aria-label$=", completed"]')
    await expect(groupedCalls.first()).toBeHidden()
    await groupToggle.first().click()
    await expect(groupedCalls.first()).toBeVisible()
    expect(await groupedCalls.count()).toBeGreaterThanOrEqual(2)
  }

  for (const toggle of await groupToggle.all())
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click()
  const writeCall = completedCalls
    .filter({ hasText: /^(Wrote |Edited |Applied patch)/ })
    .first()
  await expect(writeCall).toBeVisible()
  await writeCall.click()
  await expect(
    writeCall.locator("..").getByRole("heading", { name: "Input", exact: true })
  ).toBeVisible()
  const shellCall = completedCalls.filter({ hasText: /^Ran command$/ }).first()
  await expect(shellCall).toBeVisible()
  await shellCall.click()
  await expect(
    shellCall
      .locator("..")
      .getByRole("heading", { name: "Output", exact: true })
  ).toBeVisible()
}
