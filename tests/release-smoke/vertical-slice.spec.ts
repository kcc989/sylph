import { expect, test } from "@playwright/test"
import { mkdir } from "node:fs/promises"
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
const authenticationState = resolve(
  process.env.SYLPH_SMOKE_AUTH_STATE ??
    resolve(process.cwd(), "playwright/.auth/release-smoke.json")
)
const proofFile = "RELEASE_SMOKE_PROOF.txt"
const proofMarker = `sylph-release-smoke-${Date.now()}`

const waitForHydration = async (page: Parameters<typeof test>[0]["page"]) => {
  await page.waitForFunction(() => !("$_TSR" in window))
}

const openToolMenu = async (page: Parameters<typeof test>[0]["page"]) => {
  const openToolTab = page.getByRole("button", { name: "Open tool tab" })
  if (!(await openToolTab.isVisible())) {
    await page.getByRole("button", { name: "Open tool sidebar" }).click()
  }
  await openToolTab.click()
}

const finishWorkspaceTurn = async (
  page: Parameters<typeof test>[0]["page"]
) => {
  await expect(page.getByText("Agent working", { exact: true })).toBeVisible()
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
      { timeout: 5 * 60 * 1000 }
    )
    .toBe(true)
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
    await page.goto("/")
    await waitForHydration(page)
    const magicLink = page.getByRole("button", {
      name: "Send test magic link",
    })

    if (await magicLink.isVisible()) {
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
        await page.waitForURL(`${baseURL}/setup`, { timeout: 10 * 60 * 1000 })
      }
    }

    await waitForHydration(page)
    await mkdir(dirname(authenticationState), { recursive: true })
    await page.context().storageState({ path: authenticationState })
    const claim = page.getByRole("heading", {
      name: "Claim this Installation",
    })

    if (await claim.isVisible()) {
      await page.getByLabel("Organization name").fill(organizationName)
      await page.getByLabel("Confirm Admin email").fill(adminEmail)
      await page.getByLabel("Installation claim secret").fill(claimSecret)
      await page.getByRole("button", { name: "Claim Installation" }).click()
      await page.waitForURL(/\/admin\?onboarding=1$/)
    } else {
      await expect(
        page.getByRole("heading", { name: "Installation claimed" })
      ).toBeVisible()
      await page.getByRole("button", { name: "Continue" }).click()
      await page.waitForURL(/\/admin$/)
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
    await page.getByLabel("Project name").fill(projectName)
    await page.getByRole("button", { name: "Create Project" }).click()
    await page.waitForURL(/\/projects\/[^/]+\/workspaces\/[^/?]+/)
    await waitForHydration(page)
    await expect(
      page.getByRole("textbox", { name: "Message the agent" })
    ).toBeEnabled()
    await expect.poll(() => workspaceSocketUrls.length).toBeGreaterThan(0)
    await page.getByRole("combobox", { name: "Model for next turn" }).click()
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
      .filter({ hasText: `${projectName} · ready` })
      .click()
    await expect(page).toHaveURL(workspaceUrl)
  })

  await test.step("build a deployable proof project", async () => {
    await page
      .getByRole("textbox", { name: "Message the agent" })
      .fill(
        `Build a minimal Cloudflare Worker project. Create ${proofFile} containing exactly ${proofMarker}. The root response must contain that marker plus SYLPH_CHECKPOINT=<the deployed checkpoint> and SYLPH_DEPLOYMENT=<preview or production>. Add meaningful typecheck, lint, test, build, sylph:preview, and sylph:deploy package scripts, source, tests, TypeScript configuration, and Wrangler configuration. The preview script must deploy a checkpoint-specific Worker, pass SYLPH_CHECKPOINT and SYLPH_DEPLOYMENT as Worker vars, wait until the URL returns the exact values, then print SYLPH_PREVIEW_URL. The production script must print SYLPH_PRODUCTION_URL. Do not run a Check.`
      )
    await page.getByRole("button", { name: "Send message" }).click()
    await finishWorkspaceTurn(page)
  })

  await test.step("checkpoint and verify the Workspace", async () => {
    await openToolMenu(page)
    await page.getByRole("menuitem", { name: "Files" }).click()
    await page.getByRole("button", { name: proofFile }).click()
    await expect(page.getByRole("tabpanel", { name: "Files" })).toContainText(
      proofMarker
    )
    await openToolMenu(page)
    await page.getByRole("menuitem", { name: "Deployments" }).click()
    await expect(
      page.getByRole("tabpanel", { name: "Deployments" })
    ).toContainText("Project Deployments")
    const checkpoint = page.getByRole("button", { name: "Checkpoint" })
    await expect(checkpoint).toBeEnabled()
    await checkpoint.click()
    const checks = page.getByRole("tabpanel", { name: "Checks" })
    await expect(checks).toContainText("Evidence captured", {
      timeout: 10 * 60 * 1000,
    })
    await expect(checks.getByText("passed", { exact: true })).toHaveCount(7)
    await openToolMenu(page)
    await page.getByRole("menuitem", { name: "Review" }).click()
    await page.getByRole("button", { name: "Approve", exact: true }).click()
    const socketCount = workspaceSocketUrls.length
    await page.reload()
    await expect
      .poll(() => workspaceSocketUrls.length)
      .toBeGreaterThan(socketCount)
    await expect(page.getByRole("button", { name: "Accept" })).toBeEnabled()
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

  await test.step("accept and archive the Workspace", async () => {
    const accept = page.getByRole("button", { name: "Accept" })
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
