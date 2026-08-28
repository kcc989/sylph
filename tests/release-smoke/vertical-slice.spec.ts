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
  process.cwd(),
  "playwright/.auth/release-smoke.json"
)
const proofFile = "RELEASE_SMOKE_PROOF.txt"
const proofMarker = `sylph-release-smoke-${Date.now()}`

test("setup through eviction recovery", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "baseURL", description: baseURL })

  await test.step("setup and claim the fresh Installation", async () => {
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
      await mkdir(dirname(authenticationState), { recursive: true })
      await page.context().storageState({ path: authenticationState })
    }

    await expect(
      page.getByRole("heading", { name: "Claim this Installation" })
    ).toBeVisible()
    await page.getByLabel("Organization name").fill(organizationName)
    await page.getByLabel("Confirm Admin email").fill(adminEmail)
    await page.getByLabel("Installation claim secret").fill(claimSecret)
    await page.getByRole("button", { name: "Claim Installation" }).click()
    await page.waitForURL(/\/admin\?onboarding=1$/)
  })

  await test.step("connect OpenRouter and select the release model", async () => {
    await page.getByRole("tab", { name: "Organization" }).click()
    await page.getByRole("button", { name: "Add provider" }).click()
    await page.getByRole("button", { name: /OpenRouter/ }).click()
    await page.getByLabel("OpenRouter API key").fill(openRouterKey)
    await page.getByRole("button", { name: "Connect provider" }).click()
    await expect(
      page.getByRole("region", { name: "Connected AI providers" })
    ).toContainText("OpenRouter")
    await page
      .getByLabel("Organization default model")
      .selectOption({ label: `OpenRouter · ${modelName}` })
  })

  await test.step("create a Project and its initial Workspace", async () => {
    await page.getByRole("link", { name: "New Project" }).click()
    await page.getByLabel("Project name").fill(projectName)
    await page.getByRole("button", { name: "Create Project" }).click()
    await page.waitForURL(/\/projects\/[^/]+\/workspaces\/[^/?]+/)
    await expect(
      page.getByRole("textbox", { name: "Message the agent" })
    ).toBeEnabled()
  })

  await test.step("prompt, approve the mutation, and verify its result", async () => {
    await page
      .getByRole("textbox", { name: "Message the agent" })
      .fill(
        `Create ${proofFile} containing exactly: ${proofMarker}. Do not change any other files.`
      )
    await page.getByRole("button", { name: "Send message" }).click()
    const permission = page.getByRole("heading", {
      name: "Permission requested",
    })
    await expect(permission).toBeVisible()
    await expect(permission.locator("..")).toContainText(proofFile)
    await page.getByRole("button", { name: "Allow once" }).click()
    await expect(page.getByRole("log")).toContainText(proofMarker, {
      timeout: 3 * 60 * 1000,
    })
  })

  await test.step("checkpoint and accept the Workspace", async () => {
    const checkpoint = page.getByRole("button", { name: "Checkpoint" })
    await expect(checkpoint).toBeEnabled()
    await checkpoint.click()
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

  await test.step("evict, restart, and recover the durable Workspace", async () => {
    await page.getByRole("link", { name: projectName }).click()
    await page
      .getByRole("button", { name: "More workspace actions" })
      .press("ArrowDown")
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
    await expect(page.getByRole("log")).toContainText(proofMarker, {
      timeout: 3 * 60 * 1000,
    })
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
