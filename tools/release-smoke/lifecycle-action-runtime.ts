import { randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import { Schema } from "effect"
import {
  LifecycleActionBlocked,
  LifecycleActionState,
  LifecycleSession,
  type LifecycleAssertion,
} from "@workspace/domain/lifecycle-actions"
import {
  DeployedSmokeIdentity,
  LifecycleBrowserEvidence,
  LifecycleScenario,
  type LifecyclePath,
} from "@workspace/domain/lifecycle-proof"
import { redactLifecycleError } from "./lifecycle-errors"
import { LifecycleProvider } from "./lifecycle-provider"
import { waitForHydration } from "../../tests/release-smoke/flow-helpers"

export const environment = (key: string) => {
  const value = process.env[key]
  if (!value) throw new Error(`Missing ${key}`)
  return value
}

export const requireValue = <T>(
  value: T | null | undefined,
  message: string
): T => {
  if (value === null || value === undefined)
    throw new LifecycleActionBlocked({ message })
  return value
}

export async function eventually<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  message: string,
  timeout = 600_000
): Promise<T> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await read()
    if (ready(value)) return value
    await new Promise((done) => setTimeout(done, 1500))
  }
  throw new Error(`Timed out: ${message}`)
}

export class LifecycleActionRuntime {
  readonly assertions: LifecycleAssertion[] = []
  readonly providerAssertions: LifecycleAssertion[] = []
  constructor(
    readonly scenario: LifecycleScenario,
    readonly path: LifecyclePath,
    readonly directory: string,
    readonly baseURL: string,
    readonly provider: LifecycleProvider,
    readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
    public state: LifecycleActionState,
    readonly password: string
  ) {}

  get options() {
    return requireValue(
      this.scenario.options,
      "Recreate this scenario with smoke:lifecycle create and --options"
    )
  }
  get project() {
    return requireValue(
      this.state.project,
      "Run fresh-setup and model-native-commands first"
    )
  }
  get workspace() {
    return requireValue(this.state.workspace, "Run model-native-commands first")
  }
  get preview() {
    return requireValue(this.state.previews.at(-1), "Run checks first")
  }
  get deployment() {
    return requireValue(
      this.state.deployments
        .filter((item) => item.status === "succeeded")
        .at(-1),
      "Run production-release first"
    )
  }
  get settingsURL() {
    return `${this.baseURL}/projects/${this.project.slug}/settings`
  }
  assert(
    name: string,
    observed: Schema.Json,
    expected: Schema.Json,
    provider = false
  ) {
    const assertion = { name, observed, expected }
    const assertions = provider ? this.providerAssertions : this.assertions
    assertions.push(assertion)
    expect(observed, name).toEqual(expected)
  }
  async save(name: string, value: Schema.Json) {
    await writeFile(
      resolve(this.directory, name),
      JSON.stringify(value, null, 2),
      { mode: 0o600 }
    )
  }
  async signedIn() {
    const response = await this.context.request.get(
      `${this.baseURL}/api/auth/get-session`
    )
    expect(response.ok()).toBe(true)
    const session = Schema.decodeUnknownSync(LifecycleSession)(
      await response.json()
    )
    this.assert(
      "Installation session owner",
      session.user.email,
      environment("SYLPH_SMOKE_ADMIN_EMAIL")
    )
    return session
  }
  async settings() {
    await this.page.goto(this.settingsURL)
    await waitForHydration(this.page)
  }
  async workspacePage() {
    await this.page.goto(
      requireValue(
        this.state.workspaceUrl,
        "Workspace URL has not been observed"
      )
    )
    await waitForHydration(this.page)
  }
  async identity(
    page: Page,
    checkpoint: string,
    deployment: "preview" | "production"
  ) {
    const marker = page.locator(
      "[data-sylph-checkpoint][data-sylph-deployment]"
    )
    await expect(marker).toBeVisible()
    this.assert(
      "Rendered checkpoint",
      await marker.getAttribute("data-sylph-checkpoint"),
      checkpoint
    )
    this.assert(
      "Rendered deployment",
      await marker.getAttribute("data-sylph-deployment"),
      deployment
    )
    await expect(marker).toContainText(`SYLPH_CHECKPOINT=${checkpoint}`)
    await expect(marker).toContainText(`SYLPH_DEPLOYMENT=${deployment}`)
  }
  async app(url: string, createAccount = false) {
    const page = await this.context.newPage()
    await page.goto(`${url}/sign-in`)
    await waitForHydration(page)
    if (createAccount) {
      await page
        .getByRole("button", { name: "New here? Create an account" })
        .click()
      await page.getByLabel("Name", { exact: true }).fill("Lifecycle proof")
    }
    await page.getByLabel("Email", { exact: true }).fill(this.options.appEmail)
    await page.getByLabel("Password", { exact: true }).fill(this.password)
    await page
      .getByRole("button", {
        name: createAccount ? "Create account" : "Sign in",
        exact: true,
      })
      .click()
    await page.waitForURL(
      (location) =>
        location.origin === new URL(url).origin && location.pathname === "/"
    )
    const response = await this.context.request.get(
      `${url}/api/auth/get-session`
    )
    expect(response.ok()).toBe(true)
    const session = Schema.decodeUnknownSync(LifecycleSession)(
      await response.json()
    )
    this.assert(
      "Application authenticated email",
      session.user.email,
      this.options.appEmail
    )
    return page
  }
}

export async function runLifecycleAction(
  path: LifecyclePath,
  action: (runtime: LifecycleActionRuntime) => Promise<void>
) {
  const directory = resolve(environment("SYLPH_LIFECYCLE_OUTPUT"))
  const scenario = Schema.decodeUnknownSync(LifecycleScenario)(
    JSON.parse(await readFile(environment("SYLPH_LIFECYCLE_SCENARIO"), "utf8"))
  )
  if (path !== environment("SYLPH_LIFECYCLE_PHASE"))
    throw new Error("Action does not match selected phase")
  const baseURL = environment("SYLPH_SMOKE_BASE_URL").replace(/\/$/, "")
  const identityResponse = await fetch(`${baseURL}/__sylph/smoke-identity`, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  })
  if (!identityResponse.ok) throw new Error("Installation identity unavailable")
  const identity = Schema.decodeUnknownSync(DeployedSmokeIdentity)(
    await identityResponse.json()
  )
  expect(identity).toEqual(scenario.identity)
  const provider = new LifecycleProvider(
    scenario.accountId,
    environment("CLOUDFLARE_API_TOKEN")
  )
  const settings = await provider.settings(
    new URL(baseURL).hostname.split(".")[0]
  )
  const database = requireValue(
    settings.bindings.find((item) => item.name === "DB" && item.type === "d1")
      ?.id,
    "Installation DB binding unavailable"
  )
  const workflowName = requireValue(
    settings.bindings.find((item) => item.name === "CI_WORKFLOW")
      ?.workflow_name,
    "Installation CI_WORKFLOW binding unavailable"
  )
  const stateFile = resolve(dirname(directory), "state.json")
  let state: LifecycleActionState
  if (path === "fresh-setup") {
    state = {
      identity,
      installationDatabaseId: database,
      workflowName,
      marker: `${identity.stage}-proof`,
      previews: [],
      deployments: [],
    }
  } else {
    state = Schema.decodeUnknownSync(LifecycleActionState)(
      JSON.parse(await readFile(stateFile, "utf8"))
    )
    expect(state.identity).toEqual(identity)
    expect(state.installationDatabaseId).toBe(database)
  }
  const authFile = resolve(dirname(directory), "auth.json")
  const passwordFile = resolve(dirname(directory), "app-password")
  let password: string
  if (path === "fresh-setup") {
    password = Buffer.from(randomBytes(32)).toString("base64url")
    await writeFile(passwordFile, password, { flag: "wx", mode: 0o600 })
  } else password = await readFile(passwordFile, "utf8")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const browser = await chromium.launch({
    headless: process.env.SYLPH_SMOKE_HEADED !== "true",
  })
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1600, height: 1000 },
    storageState:
      path === "fresh-setup" ? process.env.SYLPH_SMOKE_AUTH_STATE : authFile,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  const runtime = new LifecycleActionRuntime(
    scenario,
    path,
    directory,
    baseURL,
    provider,
    browser,
    context,
    page,
    state,
    password
  )
  try {
    if (path !== "fresh-setup") await runtime.signedIn()
    await action(runtime)
    await runtime.signedIn()
    await page.screenshot({
      path: resolve(directory, "product.png"),
      fullPage: true,
    })
    const evidence = Schema.decodeUnknownSync(LifecycleBrowserEvidence)({
      identity,
      path,
      scope: "deployed",
      authenticated: true,
      checkpoint:
        runtime.state.workspace?.accepted_commit ??
        runtime.state.workspace?.fork_head ??
        null,
      assertions: runtime.assertions,
    })
    await runtime.save("browser.json", evidence)
  } catch (error) {
    const message = redactLifecycleError(
      error instanceof Error ? error.message : "Action failed",
      [
        password,
        ...Object.entries(process.env).flatMap(([key, value]) =>
          /(?:TOKEN|SECRET|KEY|PASSWORD)$/.test(key) && value ? [value] : []
        ),
      ]
    )
    await runtime.save("failure.json", {
      outcome: error instanceof LifecycleActionBlocked ? "blocked" : "failed",
      message,
    })
    throw new Error(message)
  } finally {
    await runtime.save("provider.json", {
      identity,
      path,
      requests: provider.requests,
      assertions: runtime.providerAssertions,
    })
    await runtime.save(
      "state-after.json",
      Schema.encodeSync(LifecycleActionState)(runtime.state)
    )
    await writeFile(
      stateFile,
      JSON.stringify(
        Schema.encodeSync(LifecycleActionState)(runtime.state),
        null,
        2
      ),
      { mode: 0o600 }
    )
    await writeFile(authFile, JSON.stringify(await context.storageState()), {
      mode: 0o600,
    })
    await browser.close()
  }
}
