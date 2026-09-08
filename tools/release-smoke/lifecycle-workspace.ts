import { writeObject } from "./lifecycle-objects"
import { expect } from "@playwright/test"
import { Schema } from "effect"
import { CiRunSummary } from "@workspace/domain/checks"
import {
  LifecycleCheckRow,
  LifecycleOwnerRow,
  LifecycleProjectRow,
  LifecycleWorkspaceRow,
  type LifecyclePreview,
} from "@workspace/domain/lifecycle-actions"
import {
  expectExpandableToolCalls,
  finishWorkspaceTurn,
  openToolMenu,
  waitForHydration,
} from "../../tests/release-smoke/flow-helpers"
import {
  environment,
  eventually,
  requireValue,
  type LifecycleActionRuntime,
} from "./lifecycle-action-runtime"

export async function freshSetup(r: LifecycleActionRuntime) {
  const prior = await r.provider.rows(
    r.state.installationDatabaseId,
    "SELECT id FROM installation WHERE claimed_at IS NOT NULL",
    Schema.JsonObject
  )
  r.assert("Fresh Installation is unclaimed", prior.length, 0, true)
  await r.page.goto(
    environment("SYLPH_SMOKE_AUTH_MODE") === "magic" ? "/" : "/setup"
  )
  await waitForHydration(r.page)
  if (environment("SYLPH_SMOKE_AUTH_MODE") === "magic") {
    await r.page
      .getByLabel("Email", { exact: true })
      .fill(environment("SYLPH_SMOKE_ADMIN_EMAIL"))
    await r.page.getByRole("button", { name: "Send test magic link" }).click()
    await r.page
      .getByRole("link", { name: "Open local test magic link" })
      .click()
    await r.page.waitForURL(
      (url) => url.origin === new URL(r.baseURL).origin && url.pathname === "/"
    )
    await r.page.goto("/setup")
  } else {
    const github = r.page.getByRole("button", { name: "Continue with GitHub" })
    if (await github.isVisible()) await github.click()
    await r.page
      .getByRole("heading", { name: "Claim this Installation" })
      .waitFor({ timeout: 600_000 })
  }
  await expect(
    r.page.getByRole("heading", { name: "Claim this Installation" })
  ).toBeVisible()
  await r.page.getByLabel("Organization name").fill(r.options.organizationName)
  await r.page
    .getByLabel("Confirm Admin email")
    .fill(environment("SYLPH_SMOKE_ADMIN_EMAIL"))
  await r.page
    .getByLabel("Setup code", { exact: true })
    .fill(environment("INSTALLATION_CLAIM_SECRET"))
  await r.page.getByRole("button", { name: "Claim Installation" }).click()
  await r.page.waitForURL(/\/admin\?onboarding=1$/)
  const owner = requireValue(
    (
      await r.provider.rows(
        r.state.installationDatabaseId,
        "SELECT i.id, i.organization_id, i.claimed_by_user_id, u.email FROM installation i JOIN user u ON u.id = i.claimed_by_user_id WHERE i.claimed_at IS NOT NULL",
        LifecycleOwnerRow
      )
    )[0],
    "Claim has no persisted owner"
  )
  const session = await r.signedIn()
  r.assert(
    "Claimed owner matches session",
    owner.claimed_by_user_id,
    session.user.id,
    true
  )
  r.assert(
    "Claimed email",
    owner.email,
    environment("SYLPH_SMOKE_ADMIN_EMAIL"),
    true
  )
  r.state = { ...r.state, owner }
}

export const nativePrompt = (marker: string) =>
  `Keep the existing template, auth, Alchemy resources and all five release hooks. Build an authenticated D1 todo list at / with table todos(title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0). Require the existing Better Auth session for all todo server operations. Preserve /sign-in with the template account registration and login labels. Give the input aria-label New todo, a button with aria-label Add todo, and each row a checkbox aria-label equal to its title and a button with aria-label Delete <title>. Render each title in a span with data-smoke-todo equal to the title, and data-smoke-completed equal to true or false on the same span, updated from D1. No browser storage or memory persistence. Preserve the exact runtime SYLPH_CHECKPOINT/SYLPH_DEPLOYMENT text and data attributes. Apply additive migrations through Alchemy. Add RELEASE_SMOKE_PROOF.txt containing ${marker}, and show it on /. Use native write/edit tools, read the files back, and native shell tools for node --version, bun --version, git diff, bun install and meaningful project tests. Add and execute smoke-shell.sh which runs the project tests, captures their actual exit status, prints SYLPH_NATIVE_EXIT=<that status> and exits with it. Keep all checks meaningful. After authentication render a span with data-smoke-secret whose text is the server runtime SMOKE_REVISION application binding, or unset when absent; this is a disposable nonsecret version marker used to verify restored secret deployment. Add a tested wrapper around the existing sylph:deploy command: only when SYLPH_DEPLOYMENT is production and JSON.parse(SYLPH_PROJECT_SECRETS).SMOKE_FAIL_RELEASE equals yes, exit 73 with SYLPH_EXPECTED_RELEASE_FAILURE before invoking Alchemy. All other cases must execute the original command and preserve its exit code. Do not change sylph:preview or the five recovery hooks to fake success. Also add an Alchemy-managed FILES R2 application bucket through applicationBucketBindings and preserve the template recovery hooks. After login render a textbox aria-label Object body, a textbox aria-label Object version, and a button aria-label Save object. Save the body to lifecycle-proof.txt in FILES with httpMetadata {contentType: "text/plain; charset=utf-8", cacheControl: "private, no-store"} and customMetadata {version: the submitted Object version}. On page load and after Save object read R2 and show body in [data-smoke-object] and custom version in [data-smoke-object-version]. Require the session on all object operations. Add an authenticated /smoke-health endpoint that normally returns 200 but has a deliberately reproducible defect: when query parameter probe equals ${marker}, return HTTP 500 with text SYLPH_EXPECTED_RUNTIME_FAILURE. Tests must cover normal success and this current defect. Keep the default app and health checks healthy. Do not create a Checkpoint or run a Check.`

export async function prompt(r: LifecycleActionRuntime, text: string) {
  await r.page.getByRole("textbox", { name: "Message the agent" }).fill(text)
  await r.page.getByRole("button", { name: "Send message" }).click()
  await expect(r.page.getByText("Agent working", { exact: true })).toBeVisible()
  await finishWorkspaceTurn(r.page)
}

export async function modelNativeCommands(r: LifecycleActionRuntime) {
  await r.page.goto("/admin?onboarding=1")
  await waitForHydration(r.page)
  await r.page.getByRole("tab", { name: "Organization" }).click()
  if (
    !(await r.page
      .getByRole("heading", { name: "OpenRouter", exact: true })
      .count())
  ) {
    const choose = r.page.getByRole("heading", { name: "Choose a provider" })
    if (!(await choose.isVisible()))
      await r.page.getByRole("button", { name: "Add provider" }).click()
    await r.page.getByRole("button", { name: /OpenRouter/ }).click()
    await r.page
      .getByLabel("OpenRouter API key")
      .fill(environment("OPENROUTER_API_KEY"))
    await r.page.getByRole("button", { name: "Connect provider" }).click()
  }
  await r.page.getByRole("button", { name: "Configure models" }).click()
  await r.page
    .getByRole("textbox", { name: "Search available models" })
    .fill(r.options.modelName)
  await r.page
    .getByRole("checkbox", { name: r.options.modelName, exact: true })
    .check()
  await r.page.getByRole("button", { name: "Save models", exact: true }).click()
  await r.page.goto("/projects/new?onboarding=1")
  await r.page.getByLabel("Project name").fill(r.options.projectName)
  await r.page.getByRole("button", { name: "Create Project" }).click()
  await r.page.waitForURL(/\/projects\/[^/]+\/workspaces\/[^/?]+/, {
    timeout: 180_000,
  })
  const workspaceId = requireValue(
    new URL(r.page.url()).pathname.split("/").at(-1),
    "Missing Workspace URL"
  )
  const workspace = requireValue(
    (
      await r.provider.rows(
        r.state.installationDatabaseId,
        "SELECT id, project_id, status, fork_head, accepted_commit FROM workspace WHERE id = ?",
        LifecycleWorkspaceRow,
        [workspaceId]
      )
    )[0],
    "Workspace missing from D1"
  )
  const project = requireValue(
    (
      await r.provider.rows(
        r.state.installationDatabaseId,
        "SELECT id, slug, template_commit FROM project WHERE id = ?",
        LifecycleProjectRow,
        [workspace.project_id]
      )
    )[0],
    "Project missing from D1"
  )
  r.assert(
    "Project uses approved template",
    project.template_commit,
    r.scenario.identity.templateCommit,
    true
  )
  r.state = { ...r.state, project, workspace, workspaceUrl: r.page.url() }
  await expect(
    r.page.getByRole("textbox", { name: "Message the agent" })
  ).toBeEnabled()
  await r.page
    .getByRole("combobox", { name: "Model and thinking settings" })
    .click()
  await r.page
    .getByRole("option", {
      name: `${r.options.modelName}, OpenRouter`,
      exact: true,
    })
    .click()
  await prompt(r, nativePrompt(r.state.marker))
  await expectExpandableToolCalls(r.page)
  const shellOutputs = r.page
    .locator('button[aria-label$=", completed"]')
    .filter({ hasText: /^Ran command$/ })
  for (const shell of await shellOutputs.all()) {
    if (
      !(await shell
        .locator("..")
        .getByRole("heading", { name: "Output", exact: true })
        .isVisible())
    )
      await shell.click()
  }
  const observed = []
  for (const shell of await shellOutputs.all())
    observed.push(
      await shell
        .locator("..")
        .getByRole("heading", { name: "Output", exact: true })
        .locator("..")
        .locator("pre")
        .innerText()
    )
  await r.save("native-tool-output.json", observed)
  r.assert(
    "Native shell reports actual test exit status",
    observed.some((text) => text.includes("SYLPH_NATIVE_EXIT=0")),
    true
  )
  await openToolMenu(r.page)
  await r.page.getByRole("menuitem", { name: "Files", exact: true }).click()
  const inspector = r.page.getByRole("region", { name: "Workspace inspector" })
  await inspector
    .getByRole("button", { name: "RELEASE_SMOKE_PROOF.txt", exact: true })
    .click()
  await expect(inspector).toContainText(r.state.marker)
  r.assert(
    "Native file contains marker",
    (await inspector.innerText()).includes(r.state.marker),
    true
  )
}

export async function checkpoint(
  r: LifecycleActionRuntime
): Promise<LifecyclePreview> {
  const previous = new Set(r.state.previews.map((item) => item.check.id))
  await openToolMenu(r.page)
  await r.page.getByRole("menuitem", { name: "Checks and evidence" }).click()
  const inspector = r.page.getByRole("region", { name: "Workspace inspector" })
  await inspector.getByRole("button", { name: /^Changes/ }).click()
  await r.page.getByLabel("Compare").selectOption("working")
  await r.page.getByRole("button", { name: "Checkpoint", exact: true }).click()
  const rows = await eventually(
    () =>
      r.provider.rows(
        r.state.installationDatabaseId,
        "SELECT id, workspace_id, workflow_instance_id, commit_sha, status, summary_json FROM ci_runs WHERE workspace_id = ? AND kind = 'checkpoint' ORDER BY created_at DESC",
        LifecycleCheckRow,
        [r.workspace.id]
      ),
    (items) =>
      items.some(
        (item) =>
          !previous.has(item.id) &&
          ["passed", "failed", "cancelled"].includes(item.status)
      ),
    "new Check reaches terminal result"
  )
  const check = requireValue(
    rows.find((item) => !previous.has(item.id)),
    "New Check missing"
  )
  r.assert("Check passed", check.status, "passed", true)
  const summary = Schema.decodeUnknownSync(CiRunSummary)(
    JSON.parse(requireValue(check.summary_json, "Check summary missing"))
  )
  for (const name of [
    "install",
    "typecheck",
    "lint",
    "test",
    "build",
    "preview",
    "browser",
  ])
    r.assert(
      `Check stage ${name}`,
      summary.stages.find((stage) => stage.name === name)?.status ?? null,
      "passed",
      true
    )
  const workflow = await r.provider.workflow(
    r.state.workflowName,
    check.workflow_instance_id
  )
  r.assert(
    "Preview Workflow retains its live Preview",
    ["waiting", "running", "complete"].includes(workflow),
    true,
    true
  )
  const url = requireValue(summary.previewUrl, "Check has no Preview URL")
  const worker = new URL(url).hostname.split(".")[0]
  const bindings = await r.provider.settings(worker)
  const databaseId = requireValue(
    bindings.bindings.find((item) => item.name === "DB")?.id,
    "Preview DB missing"
  )
  const controlDatabaseId = requireValue(
    bindings.bindings.find((item) => item.name === "SYLPH_RECOVERY_CONTROL")
      ?.id,
    "Preview recovery control DB missing"
  )
  const preview = { check, summary, url, worker, databaseId, controlDatabaseId }
  const workspace = requireValue(
    (
      await r.provider.rows(
        r.state.installationDatabaseId,
        "SELECT id, project_id, status, fork_head, accepted_commit FROM workspace WHERE id = ?",
        LifecycleWorkspaceRow,
        [r.workspace.id]
      )
    )[0],
    "Workspace missing"
  )
  r.assert(
    "Check is on current checkpoint",
    workspace.fork_head,
    check.commit_sha,
    true
  )
  r.state = { ...r.state, workspace, previews: [...r.state.previews, preview] }
  await openToolMenu(r.page)
  await r.page.getByRole("menuitem", { name: "Checks and evidence" }).click()
  await expect(inspector.getByText("passed", { exact: true })).toHaveCount(7, {
    timeout: 60_000,
  })
  r.assert(
    "Rendered meaningful checks",
    await inspector.getByText("passed", { exact: true }).count(),
    7
  )
  return preview
}

export async function checks(r: LifecycleActionRuntime) {
  await r.workspacePage()
  await checkpoint(r)
}

export async function concurrentPreviews(r: LifecycleActionRuntime) {
  const first = r.preview
  await r.workspacePage()
  await prompt(
    r,
    `Use native edit to add CONCURRENT_PREVIEW_PROOF.txt containing ${r.state.marker}-second. Read it back. Keep all other files unchanged. Do not create a Checkpoint or run a Check.`
  )
  const second = await checkpoint(r)
  r.assert(
    "Concurrent Preview URLs differ",
    first.url !== second.url,
    true,
    true
  )
  r.assert(
    "Concurrent Worker IDs differ",
    first.worker !== second.worker,
    true,
    true
  )
  r.assert(
    "Concurrent D1 IDs differ",
    first.databaseId !== second.databaseId,
    true,
    true
  )
  r.assert(
    "Concurrent control databases differ",
    first.controlDatabaseId !== second.controlDatabaseId,
    true,
    true
  )
  const left = await r.app(first.url, true)
  const right = await r.app(second.url, true)
  await r.identity(left, first.check.commit_sha, "preview")
  await writeObject(left, r.state.marker, "preview")
  await r.identity(right, second.check.commit_sha, "preview")
  const title = `${r.state.marker}-isolation`
  await left.getByRole("textbox", { name: "New todo", exact: true }).fill(title)
  await left.getByRole("button", { name: "Add todo", exact: true }).click()
  await expect(
    left.getByRole("checkbox", { name: title, exact: true })
  ).toBeVisible()
  await right.reload()
  r.assert(
    "Second Preview cannot read first Preview write",
    await right.getByRole("checkbox", { name: title, exact: true }).count(),
    0
  )
  const sql = "SELECT title, completed FROM todos WHERE title = ?"
  const leftRows = await r.provider.rows(
    first.databaseId,
    sql,
    Schema.JsonObject,
    [title]
  )
  const rightRows = await r.provider.rows(
    second.databaseId,
    sql,
    Schema.JsonObject,
    [title]
  )
  r.assert(
    "First Preview persisted own row",
    leftRows,
    [{ title, completed: 0 }],
    true
  )
  r.assert("Second Preview D1 is isolated", rightRows, [], true)
  await right
    .getByRole("textbox", { name: "New todo", exact: true })
    .fill(title)
  await right.getByRole("button", { name: "Add todo", exact: true }).click()
  await right.getByRole("checkbox", { name: title, exact: true }).check()
  await left.reload()
  r.assert(
    "First Preview unaffected by second Preview write",
    await left.getByRole("checkbox", { name: title, exact: true }).isChecked(),
    false
  )
  r.assert(
    "Second Preview mutation persists independently",
    await r.provider.rows(second.databaseId, sql, Schema.JsonObject, [title]),
    [{ title, completed: 1 }],
    true
  )
  await left.close()
  await right.close()
}
