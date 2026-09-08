import { expect, type Page } from "@playwright/test"
import { Schema } from "effect"
import {
  LifecycleRecoveryExport,
  LifecycleWorkspaceRow,
} from "@workspace/domain/lifecycle-actions"
import { openToolMenu } from "../../tests/release-smoke/flow-helpers"
import {
  eventually,
  requireValue,
  type LifecycleActionRuntime,
} from "./lifecycle-action-runtime"

async function browserClick(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(
    page.getByRole("button", { name: "Observe", exact: true })
  ).toBeEnabled()
  await expect(page.getByRole("alert")).toHaveCount(0)
}

async function remoteFill(page: Page, selector: string, value: string) {
  await page.getByLabel("CSS selector", { exact: true }).fill(selector)
  await page.getByLabel("Text to enter", { exact: true }).fill(value)
  await browserClick(page, "Enter text")
}

async function remoteClick(page: Page, selector: string) {
  await page.getByLabel("CSS selector", { exact: true }).fill(selector)
  await browserClick(page, "Click element")
}

export async function authenticatedPreview(r: LifecycleActionRuntime) {
  await r.workspacePage()
  const preview = r.preview
  const app = await r.app(preview.url)
  await r.identity(app, preview.check.commit_sha, "preview")
  await app.close()
  await r.page
    .getByRole("region", { name: "Workspace inspector" })
    .getByRole("button", { name: "Preview", exact: true })
    .click()
  const title = `${r.state.marker}-journey`
  await r.page.getByRole("button", { name: "Set policy", exact: true }).click()
  await r.page.getByRole("button", { name: "Add journey", exact: true }).click()
  await r.page
    .getByLabel("Journey name", { exact: true })
    .fill("Authenticated D1 mutation and reload")
  const row = `[data-smoke-todo="${title}"]`
  await r.page
    .getByLabel("Step 1: CSS selector", { exact: true })
    .fill(`${row}[data-smoke-completed="false"]`)
  await r.page.getByLabel("Expected text", { exact: true }).fill(title)
  await r.page
    .getByRole("button", { name: "Add text assertion", exact: true })
    .click()
  await r.page
    .getByLabel("Step 2: CSS selector", { exact: true })
    .fill(`${row}[data-smoke-completed="true"]`)
  await r.page.getByLabel("Expected text", { exact: true }).nth(1).fill(title)
  await r.page
    .getByLabel("Reason for this policy", { exact: true })
    .fill(
      "Verify authenticated D1 changes persist after reload on desktop and mobile for this exact Check attempt."
    )
  await r.page.getByRole("button", { name: "Save policy", exact: true }).click()
  await r.page
    .getByRole("button", { name: "Start browser", exact: true })
    .click()
  await expect(
    r.page.getByRole("button", { name: "Observe", exact: true })
  ).toBeEnabled()
  const takeControl = r.page.getByRole("button", {
    name: "Take control",
    exact: true,
  })
  if (await takeControl.isVisible()) await browserClick(r.page, "Take control")
  await r.page
    .getByLabel("Navigate to path or allowed URL", { exact: true })
    .fill("/sign-in")
  await browserClick(r.page, "Go")
  await remoteFill(r.page, "#email", r.options.appEmail)
  await remoteFill(r.page, "#password", r.password)
  await remoteClick(r.page, 'button[type="submit"]')
  await browserClick(r.page, "Begin attempt")
  for (const viewport of ["desktop", "mobile"]) {
    await r.page
      .getByLabel("Browser Run viewport", { exact: true })
      .selectOption(viewport)
    await expect(
      r.page.getByRole("button", { name: "Observe", exact: true })
    ).toBeEnabled()
    await remoteFill(r.page, '[aria-label="New todo"]', title)
    await remoteClick(r.page, 'button[aria-label="Add todo"]')
    await browserClick(r.page, "Reload")
    await browserClick(r.page, "Verify next assertion")
    await remoteClick(r.page, `[aria-label=${JSON.stringify(title)}]`)
    await browserClick(r.page, "Reload")
    await browserClick(r.page, "Verify next assertion")
    r.assert(
      `Browser Run persisted ${viewport} change`,
      await r.provider.rows(
        preview.databaseId,
        "SELECT title, completed FROM todos WHERE title = ?",
        Schema.JsonObject,
        [title]
      ),
      [{ title, completed: 1 }],
      true
    )
    await remoteClick(
      r.page,
      `button[aria-label=${JSON.stringify(`Delete ${title}`)}]`
    )
  }
  await browserClick(r.page, "Finish journey")
  await expect(
    r.page.getByText("Browser acceptance requirement satisfied", {
      exact: false,
    })
  ).toBeVisible()
  const inspector = r.page.getByRole("region", { name: "Workspace inspector" })
  const text = await inspector.innerText()
  r.assert(
    "Required browser journey passed",
    text.includes("Browser acceptance requirement satisfied"),
    true
  )
  r.assert(
    "Browser evidence is on current attempt",
    text.includes(`attempt ${preview.summary.attempt}`),
    true
  )
  r.assert(
    "Browser evidence identifies current checkpoint",
    text.includes(preview.check.commit_sha.slice(0, 7)),
    true
  )
  await r.save("browser-run-visible.json", {
    text,
    checkId: preview.check.id,
    attempt: preview.summary.attempt,
  })
}

export async function acceptance(r: LifecycleActionRuntime) {
  await r.workspacePage()
  await openToolMenu(r.page)
  await r.page.getByRole("menuitem", { name: "Checks and evidence" }).click()
  await r.page
    .getByRole("region", { name: "Workspace inspector" })
    .getByRole("button", { name: /^Changes/ })
    .click()
  await r.page.getByLabel("Compare").selectOption("branch")
  await r.page.getByRole("button", { name: /^Review ·/ }).click()
  await r.page.getByRole("button", { name: "Approve", exact: true }).click()
  const accept = r.page.getByRole("button", {
    name: "Accept checkpoint",
    exact: true,
  })
  await expect(accept).toBeEnabled()
  await accept.click()
  const rows = await eventually(
    () =>
      r.provider.rows(
        r.state.installationDatabaseId,
        "SELECT id, project_id, status, fork_head, accepted_commit FROM workspace WHERE id = ?",
        LifecycleWorkspaceRow,
        [r.workspace.id]
      ),
    (items) => items[0]?.status === "archived",
    "accepted Workspace is archived"
  )
  const workspace = requireValue(rows[0], "Accepted Workspace missing")
  r.assert(
    "Accepted exact checked commit",
    workspace.accepted_commit,
    r.preview.check.commit_sha,
    true
  )
  r.assert("Workspace terminal status", workspace.status, "archived", true)
  r.state = { ...r.state, workspace }
  await r.settings()
  const downloadPromise = r.page.waitForEvent("download")
  await r.page
    .getByRole("button", { name: "Download repository manifest", exact: true })
    .click()
  const download = await downloadPromise
  const stream = requireValue(
    await download.createReadStream(),
    "Repository export download missing"
  )
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exported = Schema.decodeUnknownSync(LifecycleRecoveryExport)(
    JSON.parse(Buffer.concat(chunks).toString("utf8"))
  )
  const project = requireValue(
    exported.repositories.find((entry) => entry.kind === "project"),
    "Export has no Project Repository"
  )
  r.assert(
    "Project Repository HEAD equals accepted commit",
    project.headCommit,
    workspace.accepted_commit
  )
  await r.save("repository-head.json", project)
  await download.delete()
}
