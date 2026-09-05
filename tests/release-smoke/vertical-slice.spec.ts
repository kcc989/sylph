import { expect, test, type Page } from "@playwright/test"
import { mkdir, writeFile, chmod } from "node:fs/promises"
import { dirname, resolve } from "node:path"

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
const proofFile = "RELEASE_SMOKE_PROOF.txt"
const resumeProofMarker = process.env.SYLPH_SMOKE_PROOF_MARKER?.trim()
const proofMarker = resumeProofMarker || `sylph-release-smoke-${Date.now()}`

const waitForHydration = async (page: Page) => {
  await page.waitForFunction(() => !("$_TSR" in window))
}

const openToolMenu = async (page: Page) => {
  const openInspector = page.getByRole("button", { name: "Open inspector" })
  if (await openInspector.isVisible()) await openInspector.click()
  await page.getByRole("button", { name: "More inspection tools" }).click()
}

const finishWorkspaceTurn = async (page: Page) => {
  await expect
    .poll(
      async () => {
        const permission = page.getByRole("button", { name: "Allow once" })
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
      { timeout: 5 * 60 * 1000 }
    )
    .toBe(true)
  const assistantError = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Assistant error", exact: true }),
  })
  await expect(
    assistantError,
    "The agent must complete without a provider or runtime error"
  ).toHaveCount(0)
}

const expectExpandableToolCalls = async (page: Page) => {
  const groupToggle = page.getByRole("button", {
    name: /^Toggle \d+ tool calls$/,
  })
  const completedCalls = page.locator('button[aria-label$=", completed"]')
  if (await groupToggle.count()) {
    const group = groupToggle.first().locator("..")
    const groupedCalls = group.locator('button[aria-label$=", completed"]')
    await expect(groupedCalls.first()).toBeHidden()
    await groupToggle.first().click()
    await expect(groupedCalls.first()).toBeVisible()
    expect(await groupedCalls.count()).toBeGreaterThan(5)
  }

  const writeCall = completedCalls.filter({ hasText: "Wrote " }).first()
  await expect(writeCall).toBeVisible()
  const writeDetail = writeCall.locator("..")
  await expect(writeDetail.getByText("Content", { exact: true })).toBeHidden()
  await writeCall.click()
  await expect(writeDetail.getByText("Content", { exact: true })).toBeVisible()

  const diffCall = completedCalls.filter({ hasText: /^Diff / }).first()
  await expect(diffCall).toBeVisible()
  await diffCall.click()
  await expect(diffCall.locator("..").locator("section").first()).toBeVisible()
}

const expectCheckAndBrowserToolCalls = async (page: Page) => {
  const checkCall = page
    .getByRole("button", {
      name: "Read check status, completed",
    })
    .last()
  await expect(checkCall).toBeVisible()
  await checkCall.click()
  await expect(
    checkCall.locator("..").getByText(/Checkpoint check/)
  ).toBeVisible()

  const browserCall = page
    .getByRole("button", {
      name: /^Opened .+ in the Preview, completed$/,
    })
    .last()
  await expect(browserCall).toBeVisible()
  await browserCall.click()
  await expect(
    browserCall.locator("..").getByRole("link").first()
  ).toBeVisible()
}

test("setup through eviction recovery", async ({ page }, testInfo) => {
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
      await page.getByLabel("Installation claim secret").fill(claimSecret)
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
          `Use the existing Project template and keep its stack and Alchemy deployment scripts. Create ${proofFile} containing exactly ${proofMarker}. Add that marker to the root page. The root HTML must render SYLPH_CHECKPOINT=<the deployed checkpoint> and SYLPH_DEPLOYMENT=<preview or production>, using the deployment's actual runtime values. Render a visible element with both data-sylph-checkpoint and data-sylph-deployment attributes on that same element, populated from those exact runtime values. Keep meaningful typecheck, lint, test, build, sylph:preview and sylph:deploy scripts. Read back the files you changed and inspect the workspace diff before your final reply. Do not run a Check or create a Checkpoint.`
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
    await inspector.getByRole("button", { name: "Files", exact: true }).click()
    await inspector.getByRole("button", { name: proofFile }).click()
    await expect(inspector).toContainText(proofMarker)
    await openToolMenu(page)
    await page.getByRole("menuitem", { name: "Deployments" }).click()
    await expect(inspector).toContainText("Project Deployments")
    await inspector.getByRole("button", { name: /^Changes/ }).click()
    await page.getByLabel("Compare").selectOption("working")
    const checkpoint = page.getByRole("button", { name: "Checkpoint" })
    if (!resumeProofMarker || (await checkpoint.isEnabled())) {
      await expect(checkpoint).toBeEnabled()
      await checkpoint.click()
    }
    await openToolMenu(page)
    await page.getByRole("menuitem", { name: "Checks and evidence" }).click()
    const checks = inspector
    await expect
      .poll(
        async () => {
          if (await checks.getByText("failed", { exact: true }).count())
            return "failed"
          return (await checks.getByText("passed", { exact: true }).count()) ===
            7
            ? "passed"
            : "running"
        },
        { timeout: 10 * 60 * 1000 }
      )
      .not.toBe("running")
    await expect(checks).toContainText("Evidence captured")
    await expect(checks.getByText("passed", { exact: true })).toHaveCount(7)
    await inspector.getByRole("button", { name: /^Changes/ }).click()
    await page.getByLabel("Compare").selectOption("branch")
    await page.getByRole("button", { name: /^Review ·/ }).click()
    await page.getByRole("button", { name: "Approve", exact: true }).click()
    const socketCount = workspaceSocketUrls.length
    await page.reload()
    await expect
      .poll(() => workspaceSocketUrls.length)
      .toBeGreaterThan(socketCount)
    await expect(
      page.getByRole("button", { name: "Accept checkpoint" })
    ).toBeEnabled()
  })

  await test.step("evict, restart, and recover the durable Workspace", async () => {
    const articleCount = await page.locator("article").count()
    await page.getByRole("button", { name: "More workspace actions" }).click()
    await page.getByRole("menuitem", { name: "Restart runtime" }).click()
    await expect(
      page.getByRole("textbox", { name: "Message the agent" })
    ).toBeEnabled({
      timeout: 3 * 60 * 1000,
    })
    await page
      .getByRole("textbox", { name: "Message the agent" })
      .fill(
        `Read ${proofFile} and reply with its exact contents. Do not change any files.`
      )
    await page.getByRole("button", { name: "Send message" }).click()
    await expect
      .poll(() => page.locator("article").count(), {
        timeout: 3 * 60 * 1000,
      })
      .toBeGreaterThan(articleCount + 1)
    await expect(page.locator("article").last()).toContainText(proofMarker)
  })

  await test.step("verify Check and browser tool details", async () => {
    await page
      .getByRole("textbox", { name: "Message the agent" })
      .fill(
        `Read the latest Check status. Then open the current Preview in the browser and verify that it contains ${proofMarker}. Do not change any files.`
      )
    await page.getByRole("button", { name: "Send message" }).click()
    await finishWorkspaceTurn(page)
    await expectCheckAndBrowserToolCalls(page)
  })

  await test.step("accept and archive the Workspace", async () => {
    await page
      .getByRole("region", { name: "Workspace inspector" })
      .getByRole("button", { name: /^Changes/ })
      .click()
    await page.getByLabel("Compare").selectOption("branch")
    const accept = page.getByRole("button", { name: "Accept checkpoint" })
    await expect(accept).toBeEnabled()
    await accept.click()
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
        proofFile,
        proofMarker,
      },
      null,
      2
    ),
    contentType: "application/json",
  })
})
