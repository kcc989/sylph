import { expect, type Page } from "@playwright/test"
import {
  requireValue,
  type LifecycleActionRuntime,
} from "./lifecycle-action-runtime"

export async function writeObject(page: Page, marker: string, version: string) {
  await page
    .getByRole("textbox", { name: "Object body", exact: true })
    .fill(`${marker}-${version}`)
  await page
    .getByRole("textbox", { name: "Object version", exact: true })
    .fill(version)
  await page.getByRole("button", { name: "Save object", exact: true }).click()
  await expect(page.locator("[data-smoke-object]")).toHaveText(
    `${marker}-${version}`
  )
  await page.reload()
  await expect(page.locator("[data-smoke-object-version]")).toHaveText(version)
}

export async function observeObject(
  r: LifecycleActionRuntime,
  page: Page,
  version: string
) {
  r.assert(
    "Browser reads restored R2 body",
    await page.locator("[data-smoke-object]").textContent(),
    `${r.state.marker}-${version}`
  )
  r.assert(
    "Browser reads restored R2 metadata",
    await page.locator("[data-smoke-object-version]").textContent(),
    version
  )
  const actual = await r.provider.object(
    requireValue(r.state.productionBucket, "Production R2 binding missing"),
    "lifecycle-proof.txt"
  )
  r.assert(
    "Provider independently reads R2 body",
    actual.body,
    `${r.state.marker}-${version}`,
    true
  )
  r.assert(
    "Provider independently reads R2 custom metadata",
    actual.customMetadata,
    { version },
    true
  )
  r.assert(
    "Provider independently reads R2 content type",
    actual.httpMetadata.contentType ?? null,
    "text/plain; charset=utf-8",
    true
  )
  r.assert(
    "Provider independently reads R2 cache policy",
    actual.httpMetadata.cacheControl ?? null,
    "private, no-store",
    true
  )
}
