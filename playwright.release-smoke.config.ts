import { defineConfig } from "@playwright/test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const authenticationState = resolve(
  process.cwd(),
  "playwright/.auth/release-smoke.json"
)

export default defineConfig({
  testDir: "tests/release-smoke",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 15 * 60 * 1000,
  expect: { timeout: 60 * 1000 },
  outputDir: "test-results/release-smoke",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/release-smoke" }],
  ],
  use: {
    baseURL: process.env.SYLPH_SMOKE_BASE_URL,
    storageState: existsSync(authenticationState)
      ? authenticationState
      : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1600, height: 1000 },
  },
})
