import { defineConfig } from "@playwright/test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const authenticationState = resolve(
  process.env.SYLPH_SMOKE_AUTH_STATE ??
    resolve(process.cwd(), "playwright/.auth/release-smoke.json")
)

export default defineConfig({
  testDir: "tests/release-smoke",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 15 * 60 * 1000,
  expect: { timeout: 60 * 1000 },
  outputDir: process.env.SYLPH_SMOKE_OUTPUT_DIR || "test-results/release-smoke",
  reporter: [
    ["list"],
    ["./tools/release-smoke/reporter.mjs"],
    [
      "html",
      {
        outputFolder:
          process.env.SYLPH_SMOKE_REPORT_DIR ||
          "playwright-report/release-smoke",
        open: "never",
      },
    ],
  ],
  use: {
    baseURL: process.env.SYLPH_SMOKE_BASE_URL,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    storageState:
      process.env.SYLPH_SMOKE_AUTH_MODE !== "magic" &&
      existsSync(authenticationState)
        ? authenticationState
        : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1600, height: 1000 },
  },
})
