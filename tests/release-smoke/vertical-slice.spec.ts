import { expect, test, type Page } from "@playwright/test"
import { mkdir, writeFile, chmod } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { browserToolCallsForTurn } from "./browser-evidence"
import {
  waitForHydration,
  openToolMenu,
  finishWorkspaceTurn as completeWorkspaceTurn,
  expectExpandableToolCalls,
  verifyMarkerJourney,
} from "./flow-helpers"

const requiredEnvironment = (name: string) => {
  const value = process.env[name]?.trim()

  if (!value) throw new Error(`${name} is required for the release smoke test`)

  return value
}

const baseURL = requiredEnvironment("SYLPH_SMOKE_BASE_URL").replace(/\/$/, "")
const adminEmail = requiredEnvironment("SYLPH_SMOKE_ADMIN_EMAIL")
const claimSecret = requiredEnvironment("INSTALLATION_CLAIM_SECRET")
const openRouterKey = requiredEnvironment("OPENROUTER_API_KEY")
const organizationName =
  process.env.SYLPH_SMOKE_ORGANIZATION_NAME?.trim() || "Sylph Release Smoke"
const projectName =
  process.env.SYLPH_SMOKE_PROJECT_NAME?.trim() || "Release Smoke Vertical Slice"
const modelName =
  process.env.SYLPH_SMOKE_MODEL_NAME?.trim() || "DeepSeek V4 Flash 0731"
const resumeClaimedInstallation =
  process.env.SYLPH_SMOKE_RESUME_CLAIMED === "true"
const resumeWorkspaceUrl = process.env.SYLPH_SMOKE_WORKSPACE_URL
const authenticationState = resolve(
  process.env.SYLPH_SMOKE_AUTH_STATE ??
    resolve(process.cwd(), "playwright/.auth/release-smoke.json")
)
const todoD1 = process.env.SYLPH_SMOKE_TODO_D1 === "true"
const verificationOnly = process.env.SYLPH_SMOKE_VERIFY_ONLY === "true"
const budgetedRun = process.env.SYLPH_SMOKE_GROK_BUDGET === "true"
const proofFile = "RELEASE_SMOKE_PROOF.txt"
const resumeProofMarker = process.env.SYLPH_SMOKE_PROOF_MARKER?.trim()
const proofMarker = resumeProofMarker || `sylph-release-smoke-${Date.now()}`

const finishWorkspaceTurn = async (page: Page) => {
  const errors = await completeWorkspaceTurn(page, Boolean(resumeWorkspaceUrl))
  if (resumeWorkspaceUrl)
    await test.info().attach("prior-turn-errors", {
      body: JSON.stringify(errors),
      contentType: "application/json",
    })
}

const expectCheckAndBrowserToolCalls = async (page: Page, prompt: string) => {
  const browserCall = browserToolCallsForTurn(page, prompt).last()
  await expect(browserCall).toBeVisible()
  await browserCall.click()
  await expect(
    browserCall.locator("..").getByRole("link").first()
  ).toBeVisible()
}

test("setup through eviction recovery", async ({ page, browser }, testInfo) => {
  if (todoD1) test.setTimeout(30 * 60 * 1000)
  testInfo.annotations.push({ type: "baseURL", description: baseURL })
  const workspaceSocketUrls: string[] = []

  page.on("websocket", (socket) => {
    const url = new URL(socket.url())

    if (/\/api\/workspaces\/[^/]+\/socket$/.test(url.pathname)) {
      workspaceSocketUrls.push(socket.url())
    }
  })

  await test.step("setup and claim the fresh Installation", async () => {
    await page.goto(`/?smoke=${proofMarker}`)
    await waitForHydration(page)
    const magicLink = page.getByRole("button", {
      name: "Send test magic link",
    })

    const magicAuthentication = process.env.SYLPH_SMOKE_AUTH_MODE === "magic"
    await expect(magicLink).toBeVisible({ visible: magicAuthentication })
    if (magicAuthentication) {
      await page.getByLabel("Email").fill(adminEmail)
      await magicLink.click()
      const localMagicLink = page.getByRole("link", {
        name: "Open local test magic link",
      })
      await expect(localMagicLink).toBeVisible()
      await localMagicLink.click()
      await page.waitForURL(
        (url) => url.origin === new URL(baseURL).origin && url.pathname === "/"
      )
      await page.goto("/setup")
    } else {
      await page.goto("/setup")
      const github = page.getByRole("button", { name: "Continue with GitHub" })
      if (await github.isVisible()) {
        await github.click()
        if (new URL(page.url()).origin !== new URL(baseURL).origin) {
          process.stdout.write(
            "Complete GitHub authentication in the opened browser window.\n"
          )
        }
        await page.waitForURL(`${baseURL}/setup`, {
          timeout:
            testInfo.project.use.headless === false
              ? 10 * 60 * 1000
              : 60 * 1000,
        })
      }
    }

    await waitForHydration(page)
    if (!magicAuthentication) {
      await mkdir(dirname(authenticationState), {
        recursive: true,
        mode: 0o700,
      })
      await writeFile(
        authenticationState,
        JSON.stringify(await page.context().storageState()),
        { mode: 0o600 }
      )
      await chmod(authenticationState, 0o600)
    }
    const claimHeading = page.getByRole("heading", {
      name: "Claim this Installation",
    })
    const claimedHeading = page.getByRole("heading", {
      name: "Installation claimed",
    })
    await expect(claimHeading.or(claimedHeading)).toBeVisible()

    if (await claimedHeading.isVisible()) {
      expect(resumeClaimedInstallation).toBe(true)
      await page.getByRole("button", { name: "Continue" }).click()
      await page.waitForURL(/\/admin$/)
    } else {
      await page.getByLabel("Organization name").fill(organizationName)
      await page.getByLabel("Confirm Admin email").fill(adminEmail)
      await page.getByLabel("Setup code").fill(claimSecret)
      await page.getByRole("button", { name: "Claim Installation" }).click()
      await page.waitForURL(/\/admin\?onboarding=1$/)
    }
    await waitForHydration(page)
  })

  await test.step("connect OpenRouter", async () => {
    await page.goto("/projects/new?onboarding=1")
    await waitForHydration(page)

    if (await page.getByLabel("Project name").isVisible()) return

    await page.goto("/admin?onboarding=1")
    await waitForHydration(page)
    await page.getByRole("tab", { name: "Organization" }).click()
    if (
      !(await page
        .getByRole("heading", { name: "OpenRouter", exact: true })
        .count())
    ) {
      const chooseProvider = page.getByRole("heading", {
        name: "Choose a provider",
      })
      await expect
        .poll(
          async () => {
            if (await chooseProvider.isVisible()) return true
            await page.getByRole("button", { name: "Add provider" }).click()
            return chooseProvider.isVisible()
          },
          { timeout: 60 * 1000 }
        )
        .toBe(true)
      await page.getByRole("button", { name: /OpenRouter/ }).click()
      await page.getByLabel("OpenRouter API key").fill(openRouterKey)
      await page.getByRole("button", { name: "Connect provider" }).click()
    }
    await page.getByRole("button", { name: "Configure models" }).click()
    await page
      .getByRole("textbox", { name: "Search available models" })
      .fill(modelName)
    await page.getByRole("checkbox", { name: modelName, exact: true }).check()
    await page.getByRole("button", { name: "Save models", exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Configure models" })
    ).toBeVisible()
    await page.goto("/projects/new?onboarding=1")
    await page.waitForURL(/\/projects\/new\?onboarding=1$/)
    await waitForHydration(page)
  })

  await test.step("create a Project and its initial Workspace", async () => {
    if (resumeWorkspaceUrl) {
      const destination = new URL(resumeWorkspaceUrl)
      expect(destination.origin).toBe(new URL(baseURL).origin)
      expect(destination.pathname).toMatch(
        /^\/projects\/[^/]+\/workspaces\/[^/]+$/
      )
      await page.goto(destination.href)
    } else {
      await page.getByLabel("Project name").fill(projectName)
      await page.getByRole("button", { name: "Create Project" }).click()
      await page.waitForURL(/\/projects\/[^/]+\/workspaces\/[^/?]+/, {
        timeout: 3 * 60 * 1000,
      })
    }
    await waitForHydration(page)
    if (resumeProofMarker) await finishWorkspaceTurn(page)
    await expect(
      page.getByRole("textbox", { name: "Message the agent" })
    ).toBeEnabled()
    await expect.poll(() => workspaceSocketUrls.length).toBeGreaterThan(0)
    await page
      .getByRole("combobox", { name: "Model and thinking settings" })
      .click()
    await page
      .getByRole("option", { name: `${modelName}, OpenRouter`, exact: true })
      .click()
    const workspaceUrl = page.url()
    await page.keyboard.press("Control+K")
    const palette = page.getByRole("dialog", { name: "Command palette" })
    await expect(palette).toBeVisible()
    await palette
      .getByPlaceholder("Search Projects, Workspaces, Issues, and commands…")
      .fill(projectName)
    await palette
      .getByRole("option")
      .filter({ hasText: `${projectName} ·` })
      .click()
    await expect(page).toHaveURL(
      (url) =>
        url.origin === new URL(workspaceUrl).origin &&
        url.pathname === new URL(workspaceUrl).pathname
    )
  })

  await test.step("resize and switch the workspace inspector", async () => {
    const composer = page.getByRole("textbox", { name: "Message the agent" })
    const inspector = page.getByRole("region", { name: "Workspace inspector" })
    await composer.fill("Preserve this draft")
    const handle = page.getByRole("separator", {
      name: "Resize workspace tool pane",
    })
    const before = await inspector.boundingBox()
    await handle.focus()
    await page.keyboard.press("ArrowLeft")
    await expect
      .poll(async () => (await inspector.boundingBox())?.width)
      .not.toBe(before?.width)
    await page.getByRole("button", { name: "Expand inspector" }).click()
    await expect(composer).toBeHidden()
    await page.getByRole("button", { name: "Restore conversation" }).click()
    await expect(composer).toHaveValue("Preserve this draft")
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole("button", { name: "Inspect", exact: true }).click()
    await expect(inspector).toBeVisible()
    await expect
      .poll(async () => (await inspector.boundingBox())?.width)
      .toBe(390)
    await page
      .getByRole("button", { name: "Conversation", exact: true })
      .click()
    await expect(composer).toHaveValue("Preserve this draft")
    await composer.clear()
    await page.setViewportSize({ width: 1600, height: 1000 })
  })

  await test.step("build a deployable proof project", async () => {
    if (!resumeProofMarker) {
      await page
        .getByRole("textbox", { name: "Message the agent" })
        .fill(
          `Use the existing Project template and keep its stack and Alchemy deployment scripts. ${todoD1 ? "Build a working todo list at /. Store todos in the template Cloudflare D1 database, in a table named todos with title and completed columns. Use server operations for create, list, complete, and delete; do not store todos in browser storage or memory. Use an accessible textbox labelled New todo, a button Add todo, and for each todo a checkbox labelled with its title and a button labelled Delete followed by its title. Make the app usable without sign-in for this disposable smoke test. Apply the table migration during the Alchemy preview deployment. Use native write/edit tools and the native shell tool to run node --version, bun --version, git diff and bun install, then meaningful project tests. Keep dependencies compatible with the template. Add an executable shell script smoke-shell.sh that prints SYLPH_SANDBOX_OK and execute it using the shell tool. Do not replace testing with unconditional success. " : ""}Create ${proofFile} containing exactly ${proofMarker}. Add that marker to the root page. The root HTML must render SYLPH_CHECKPOINT=<the deployed checkpoint> and SYLPH_DEPLOYMENT=<preview or production>, using the deployment's actual runtime values. Render a visible element with both data-sylph-checkpoint and data-sylph-deployment attributes on that same element, populated from those exact runtime values. Keep meaningful typecheck, lint, test, build, sylph:preview and sylph:deploy scripts. Read back the files you changed and inspect the workspace diff before your final reply. Do not run a Check or create a Checkpoint.`
        )
      await page.getByRole("button", { name: "Send message" }).click()
      await expect(
        page.getByText("Agent working", { exact: true })
      ).toBeVisible()
    }
    await finishWorkspaceTurn(page)
    await expectExpandableToolCalls(page)
  })

  await test.step("checkpoint and verify the Workspace", async () => {
    const inspector = page.getByRole("region", { name: "Workspace inspector" })
    await openToolMenu(page)
    await page.getByRole("menuitem", { name: "Files", exact: true }).click()
    await inspector.getByRole("button", { name: proofFile }).click()
    await expect(inspector).toContainText(proofMarker)
    await openToolMenu(page)
    await page.getByRole("menuitem", { name: "Deployments" }).click()
    await expect(inspector).toContainText("Project Deployments")
    await inspector.getByRole("button", { name: /^Changes/ }).click()
    await page.getByLabel("Compare").selectOption("working")
    const checkpoint = page.getByRole("button", {
      name: "Checkpoint",
      exact: true,
    })
    if (!resumeProofMarker || (await checkpoint.isEnabled())) {
      await expect(checkpoint).toBeEnabled()
      await checkpoint.click()
    }
    await openToolMenu(page)
    await page.getByRole("menuitem", { name: "Checks and evidence" }).click()
    const checks = inspector
    await inspector
      .getByRole("button", { name: "Run checks", exact: true })
      .click()
    await expect
      .poll(() => checks.getByText("passed", { exact: true }).count(), {
        timeout: 10 * 60 * 1000,
      })
      .toBeGreaterThanOrEqual(5)
    await inspector
      .getByRole("checkbox", { name: "Capture browser evidence", exact: true })
      .check()
    await inspector
      .getByRole("button", { name: "Create Preview", exact: true })
      .click()
    await expect(checks.getByText("passed", { exact: true })).toHaveCount(9, {
      timeout: 10 * 60 * 1000,
    })
    await expect(checks.getByText(/^(queued|running|failed)$/)).toHaveCount(0)
    await expect(checks).toContainText("Evidence captured")
    await inspector.getByRole("button", { name: /^Changes/ }).click()
    await page.getByLabel("Compare").selectOption("branch")
    await page.getByRole("button", { name: /^Review ·/ }).click()
    if (!verificationOnly)
      await page.getByRole("button", { name: "Approve", exact: true }).click()
    const socketCount = workspaceSocketUrls.length
    await page.reload()
    await expect
      .poll(() => workspaceSocketUrls.length)
      .toBeGreaterThan(socketCount)
  })

  if (todoD1)
    await test.step("verify todos persist in D1 across independent browser sessions", async () => {
      await page
        .getByRole("region", { name: "Workspace inspector" })
        .getByRole("button", { name: "Preview", exact: true })
        .click()
      const preview = await page
        .getByLabel("Preview URL", { exact: true })
        .inputValue()
      expect(preview).toMatch(/^https:\/\//)
      const title = `Persistent ${proofMarker}-${Date.now()}`
      const first = await browser.newContext()
      const second = await browser.newContext()
      const app = await first.newPage()
      const other = await second.newPage()
      const api = async (
        path: string,
        body?: { sql: string; params: string[] }
      ) => {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${requiredEnvironment("CLOUDFLARE_ACCOUNT_ID")}/${path}`,
          {
            method: body ? "POST" : "GET",
            headers: {
              Authorization: `Bearer ${requiredEnvironment("CF_TOKEN")}`,
              "Content-Type": "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
          }
        )
        expect(response.ok).toBe(true)
        return response.json()
      }
      const worker = new URL(preview).hostname.split(".")[0]
      const settings = await api(`workers/scripts/${worker}/settings`)
      const binding = settings.result.bindings.find(
        (item: { type: string }) => item.type === "d1"
      )
      expect(binding?.id).toBeTruthy()
      const rows = async () => {
        const result = await api(`d1/database/${binding.id}/query`, {
          sql: "SELECT title, completed FROM todos WHERE title = ?",
          params: [title],
        })
        expect(result.success).toBe(true)
        return result.result[0].results
      }
      try {
        await app.goto(preview)
        await app
          .getByRole("textbox", { name: "New todo", exact: true })
          .fill(title)
        await app.getByRole("button", { name: "Add todo", exact: true }).click()
        await expect(
          app.getByRole("checkbox", { name: title, exact: true })
        ).toBeVisible()
        await expect.poll(rows).toEqual([{ title, completed: 0 }])
        await app.reload()
        await expect(
          app.getByRole("checkbox", { name: title, exact: true })
        ).not.toBeChecked()
        await other.goto(preview)
        await other.getByRole("checkbox", { name: title, exact: true }).click()
        await expect(
          other.getByRole("checkbox", { name: title, exact: true })
        ).toBeChecked()
        await expect.poll(rows).toEqual([{ title, completed: 1 }])
        await app.reload()
        await expect(
          app.getByRole("checkbox", { name: title, exact: true })
        ).toBeChecked()
        await testInfo.attach("d1-todo", {
          body: JSON.stringify({
            preview,
            databaseId: binding.id,
            rows: await rows(),
          }),
          contentType: "application/json",
        })
        await testInfo.attach("todo-app", {
          body: await app.screenshot(),
          contentType: "image/png",
        })
        await other
          .getByRole("button", { name: `Delete ${title}`, exact: true })
          .click()
        await expect.poll(rows).toEqual([])
        await app.reload()
        await expect(
          app.getByRole("checkbox", { name: title, exact: true })
        ).toHaveCount(0)
      } finally {
        await first.close()
        await second.close()
      }
    })

  await test.step("evict, restart, and recover the durable Workspace", async () => {
    await page.getByRole("button", { name: "More workspace actions" }).click()
    await page.getByRole("menuitem", { name: "Restart runtime" }).click()
    await expect(
      page.getByRole("textbox", { name: "Message the agent" })
    ).toBeEnabled({
      timeout: 3 * 60 * 1000,
    })
    if (budgetedRun) {
      const inspector = page.getByRole("region", {
        name: "Workspace inspector",
      })
      await openToolMenu(page)
      await page.getByRole("menuitem", { name: "Files", exact: true }).click()
      await inspector
        .getByRole("button", { name: proofFile, exact: true })
        .click()
      await expect(inspector).toContainText(proofMarker)
      return
    }
    await page
      .getByRole("textbox", { name: "Message the agent" })
      .fill(
        `Read ${proofFile} and reply with its exact contents. Do not change any files.`
      )
    await page.getByRole("button", { name: "Send message" }).click()
    await expect(page.getByText("Agent working", { exact: true })).toBeVisible()
    await finishWorkspaceTurn(page)
    await expect(page.locator("article").last()).toContainText(proofMarker)
  })

  if (!budgetedRun)
    await test.step("verify browser tool details", async () => {
      await page
        .getByRole("region", { name: "Workspace inspector" })
        .getByRole("button", { name: "Preview", exact: true })
        .click()
      await page
        .getByRole("button", { name: "Browser Run", exact: true })
        .click()
      const release = page.getByRole("button", {
        name: "Release to agent",
        exact: true,
      })
      if (await release.count()) {
        await release.click()
        await expect(
          page.getByRole("button", { name: "Take control", exact: true })
        ).toBeEnabled()
      }
      const prompt = `Browser verification request ${crypto.randomUUID()}. Open the current Preview in the browser and verify that it contains ${proofMarker}. Do not change any files.`
      await page
        .getByRole("textbox", { name: "Message the agent" })
        .fill(prompt)
      await page.getByRole("button", { name: "Send message" }).click()
      await expect(
        page.getByText("Agent working", { exact: true })
      ).toBeVisible()
      await finishWorkspaceTurn(page)
      await expectCheckAndBrowserToolCalls(page, prompt)
    })

  if (!verificationOnly)
    await test.step("accept and archive the Workspace", async () => {
      await verifyMarkerJourney(page, proofMarker)
      await page
        .getByRole("region", { name: "Workspace inspector" })
        .getByRole("button", { name: /^Changes/ })
        .click()
      await page.getByLabel("Compare").selectOption("branch")
      const accept = page.getByRole("button", { name: "Accept checkpoint" })
      await expect(accept).toBeEnabled()
      const acceptanceResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().startsWith(`${baseURL}/_serverFn/`)
      )
      await accept.click()
      const accepted = await acceptanceResponse
      expect(accepted.ok()).toBe(true)
      await accepted.finished()
      await page.goto("/")
      await expect
        .poll(
          async () => {
            await page.reload()
            return page.getByText("archived", { exact: true }).count()
          },
          { timeout: 3 * 60 * 1000 }
        )
        .toBeGreaterThan(0)
    })

  await testInfo.attach("release-smoke-evidence", {
    body: JSON.stringify(
      {
        baseURL,
        finalURL: page.url(),
        organizationName,
        projectName,
        modelName,
        verificationOnly,
        acceptanceVerified: !verificationOnly,
        proofFile,
        proofMarker,
      },
      null,
      2
    ),
    contentType: "application/json",
  })
})
