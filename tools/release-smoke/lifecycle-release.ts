import { expect } from "@playwright/test"
import { Schema } from "effect"
import { CloudflareDeployments } from "@workspace/domain/project-operations"
import { jsonPointer } from "./lifecycle"
import {
  ProjectDeployInput,
  DeploymentDataRestore,
  DeploymentJourney,
  DeploymentRecoveryPoint,
} from "@workspace/domain/deployments"
import {
  LifecycleReleaseEnvelope,
  LifecycleWireObject,
  LifecycleWireScalar,
  LifecycleCheckRow,
  LifecycleDeploymentRow,
} from "@workspace/domain/lifecycle-actions"
import {
  eventually,
  requireValue,
  type LifecycleActionRuntime,
} from "./lifecycle-action-runtime"

export const deploymentRows = (r: LifecycleActionRuntime) =>
  r.provider.rows(
    r.state.installationDatabaseId,
    'SELECT id, "commit", status, production_url, failure_details, recovery_deployment_id, recovery_json, verification_json, restore_json FROM deployment WHERE project_id = ? ORDER BY created_at DESC',
    LifecycleDeploymentRow,
    [r.project.id]
  )

export function requireReleaseRequest(
  body: string | null,
  projectId: string,
  commit: string,
  recoveryId?: string
) {
  const envelope = Schema.decodeUnknownSync(LifecycleReleaseEnvelope)(
    JSON.parse(requireValue(body, "Missing product release request body"))
  )
  const dataIndex = envelope.t.p.k.indexOf("data")
  const data = Schema.decodeUnknownSync(LifecycleWireObject)(
    envelope.t.p.v[dataIndex]
  )
  if (
    new Set(data.p.k).size !== data.p.k.length ||
    data.p.k.length !== data.p.v.length
  )
    throw new Error("Malformed product release fields")
  const decoded = Object.fromEntries(
    data.p.k.map((key, index) => {
      const scalar = Schema.decodeUnknownSync(LifecycleWireScalar)(
        data.p.v[index]
      )
      return [
        key,
        scalar.t === 1 ? scalar.s : scalar.s === 1 ? undefined : scalar.s === 2,
      ]
    })
  )
  const input = Schema.decodeUnknownSync(ProjectDeployInput)(decoded)
  if (
    input.projectId !== projectId ||
    input.commit !== commit ||
    input.confirmedCommit !== commit ||
    input.recoveryDeploymentId !== recoveryId ||
    (recoveryId && input.confirmedDataLoss !== true)
  )
    throw new Error(
      "Product release request differs from the reviewed commit and recovery ID"
    )
}

export async function deploy(
  r: LifecycleActionRuntime,
  recoveryId?: string,
  expectedStatus = "succeeded"
) {
  await r.settings()
  const before = await deploymentRows(r)
  const existing = new Set(before.map((item) => item.id))
  const commit = requireValue(
    r.workspace.accepted_commit,
    "Accept the Checkpoint before releasing"
  )
  if (recoveryId) {
    const index = before.findIndex((item) => item.id === recoveryId)
    if (index < 0)
      throw new Error("Reviewed recovery deployment is no longer listed")
    const history = r.page.getByRole("region", {
      name: "Deployment history",
      exact: true,
    })
    await expect(history.locator("article")).toHaveCount(before.length)
    await history
      .locator("article")
      .nth(index)
      .getByRole("button", { name: "Recover code and data", exact: true })
      .click()
  } else {
    const production = r.page.getByRole("region", {
      name: "Production",
      exact: true,
    })
    const row = production
      .locator("div.border-b")
      .filter({ hasText: commit.slice(0, 7) })
    await row.getByRole("button", { name: /^(Deploy|Redeploy)$/ }).click()
  }
  let requestChecked = false
  await r.page.route("**/_serverFn/**", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    try {
      requireReleaseRequest(
        route.request().postData(),
        r.project.id,
        commit,
        recoveryId
      )
      requestChecked = true
      await route.continue()
    } catch {
      await route.abort("blockedbyclient")
    }
  })
  try {
    await r.page
      .getByRole("button", {
        name: recoveryId
          ? "Confirm restore and data loss"
          : /^Confirm (deploy|redeploy)$/,
        exact: true,
      })
      .click()
    await expect.poll(() => requestChecked, { timeout: 10_000 }).toBe(true)
    const rows = await eventually(
      () => deploymentRows(r),
      (items) =>
        items.some(
          (item) =>
            !existing.has(item.id) &&
            ["succeeded", "failed"].includes(item.status)
        ),
      "production deployment reaches terminal status"
    )
    r.assert(
      "Product submitted the reviewed release target",
      requestChecked,
      true
    )
    const deployment = requireValue(
      rows.find((item) => !existing.has(item.id)),
      "New deployment missing"
    )
    r.state = { ...r.state, deployments: [...r.state.deployments, deployment] }
    r.assert("Deployment result", deployment.status, expectedStatus, true)
    r.assert("Released exact accepted commit", deployment.commit, commit, true)
    r.assert(
      "Selected recovery point",
      deployment.recovery_deployment_id,
      recoveryId ?? null,
      true
    )
    const ci = requireValue(
      (
        await r.provider.rows(
          r.state.installationDatabaseId,
          "SELECT id, workspace_id, workflow_instance_id, commit_sha, status, summary_json FROM ci_runs WHERE id = ?",
          LifecycleCheckRow,
          [deployment.id]
        )
      )[0],
      "Production Check missing"
    )
    const workflow = await eventually(
      () => r.provider.workflow(r.state.workflowName, ci.workflow_instance_id),
      (status) => ["complete", "errored", "terminated"].includes(status),
      "release Workflow completion"
    )
    r.assert(
      "Release Workflow completed its failure or success reporting",
      workflow,
      "complete",
      true
    )
    if (expectedStatus === "succeeded") {
      const journey = Schema.decodeUnknownSync(DeploymentJourney)(
        JSON.parse(
          requireValue(
            deployment.verification_json,
            "Deployment has no verified journey"
          )
        )
      )
      r.assert(
        "Production journey binds deployment",
        journey.deploymentId,
        deployment.id,
        true
      )
      r.assert("Production journey binds commit", journey.commit, commit, true)
      if (recoveryId) {
        const restore = Schema.decodeUnknownSync(DeploymentDataRestore)(
          JSON.parse(
            requireValue(deployment.restore_json, "Restore receipt missing")
          )
        )
        r.assert(
          "Restore names selected recovery deployment",
          restore.recoveryDeploymentId,
          recoveryId,
          true
        )
      }
    }
    await r.page.unroute("**/_serverFn/**")
    await r.settings()
    return deployment
  } finally {
    await r.page.unroute("**/_serverFn/**")
  }
}

export async function secret(
  r: LifecycleActionRuntime,
  name: string,
  value: string | null
) {
  await r.settings()
  if (value === null) {
    await r.page
      .getByRole("button", {
        name: `Remove ${name} from production`,
        exact: true,
      })
      .click()
    await expect(
      r.page.getByRole("button", {
        name: `Remove ${name} from production`,
        exact: true,
      })
    ).toHaveCount(0)
  } else {
    await r.page
      .getByLabel("Environment", { exact: true })
      .selectOption("production")
    await r.page.getByLabel("Secret name", { exact: true }).fill(name)
    await r.page.getByLabel("Secret value", { exact: true }).fill(value)
    await r.page
      .getByRole("button", { name: "Save secret", exact: true })
      .click()
    await expect(
      r.page.getByLabel("Secret value", { exact: true })
    ).toHaveValue("")
  }
}

export async function productionRelease(r: LifecycleActionRuntime) {
  await secret(r, "SMOKE_REVISION", "before")
  const initial = await deploy(r)
  const url = requireValue(initial.production_url, "Production URL unavailable")
  let app = await r.app(url, true)
  await r.identity(app, initial.commit, "production")
  const title = `${r.state.marker}-recovery`
  await app.getByRole("textbox", { name: "New todo", exact: true }).fill(title)
  await app.getByRole("button", { name: "Add todo", exact: true }).click()
  await expect(
    app.getByRole("checkbox", { name: title, exact: true })
  ).toBeVisible()
  await app.close()
  const worker = new URL(url).hostname.split(".")[0]
  const settings = await r.provider.settings(worker)
  const database = requireValue(
    settings.bindings.find((item) => item.name === "DB")?.id,
    "Production D1 binding unavailable"
  )
  r.state = {
    ...r.state,
    productionDatabaseId: database,
    productionWorker: worker,
  }
  r.assert(
    "Production persisted pre-restore data",
    await r.provider.rows(
      database,
      "SELECT title, completed FROM todos WHERE title = ?",
      Schema.JsonObject,
      [title]
    ),
    [{ title, completed: 0 }],
    true
  )
  await secret(r, "SMOKE_REVISION", "after")
  const released = await deploy(r)
  const recovery = Schema.decodeUnknownSync(DeploymentRecoveryPoint)(
    JSON.parse(
      requireValue(
        released.recovery_json,
        "Second release has no recovery point"
      )
    )
  )
  r.assert(
    "Recovery point uses paired prior code",
    recovery.baseCommit,
    initial.commit,
    true
  )
  r.state = { ...r.state, recovery }
  app = await r.app(url)
  await r.identity(app, released.commit, "production")
  r.assert(
    "Current deployed application secret version",
    await app.locator("[data-smoke-secret]").textContent(),
    "after"
  )
  await app.getByRole("checkbox", { name: title, exact: true }).check()
  await app.reload()
  r.assert(
    "Pre-undo browser value",
    await app.getByRole("checkbox", { name: title, exact: true }).isChecked(),
    true
  )
  r.assert(
    "Pre-undo D1 value",
    await r.provider.rows(
      database,
      "SELECT title, completed FROM todos WHERE title = ?",
      Schema.JsonObject,
      [title]
    ),
    [{ title, completed: 1 }],
    true
  )
  await app.close()
}

export async function deliberateFailure(r: LifecycleActionRuntime) {
  const previous = r.deployment
  const worker = requireValue(
    r.state.productionWorker,
    "Production Worker missing"
  )
  const readIdentity = async () =>
    Schema.decodeUnknownSync(CloudflareDeployments)(
      jsonPointer(
        await r.provider.read(`workers/scripts/${worker}/deployments`),
        "/result"
      )
    ).deployments[0]
  const identity = requireValue(
    await readIdentity(),
    "Active Worker deployment missing"
  )
  const bindings = await r.provider.settings(worker)
  const control = requireValue(
    bindings.bindings.find(
      (binding) => binding.name === "SYLPH_RECOVERY_CONTROL"
    )?.id,
    "Recovery control database missing"
  )
  await secret(r, "SMOKE_FAIL_RELEASE", "yes")
  const failed = await deploy(r, undefined, "failed")
  r.assert(
    "Failure comes from the bounded deployment command",
    failed.failure_details?.includes("SYLPH_EXPECTED_RELEASE_FAILURE") ?? false,
    true,
    true
  )
  r.assert(
    "Failure saved a real recovery point",
    failed.recovery_json !== null,
    true,
    true
  )
  const app = await r.context.newPage()
  const response = await app.goto(
    requireValue(previous.production_url, "Previous production URL missing")
  )
  r.assert(
    "Failed release keeps application writes paused",
    response?.status() ?? null,
    503,
    true
  )
  r.assert(
    "Maintenance response permits a later retry",
    response?.headers()["retry-after"] ?? null,
    "30"
  )
  await expect(app.locator("body")).toContainText(
    "Application maintenance is in progress"
  )
  r.assert(
    "Failed release preserves the deployed Worker version",
    await readIdentity(),
    identity,
    true
  )
  r.assert(
    "Failed release owns the drained recovery gate",
    await r.provider.rows(
      control,
      "SELECT owner, active FROM sylph_recovery_gate WHERE id = 1",
      Schema.JsonObject
    ),
    [{ owner: failed.id, active: 0 }],
    true
  )
  const database = requireValue(
    r.state.productionDatabaseId,
    "Production database missing"
  )
  const title = `${r.state.marker}-recovery`
  r.assert(
    "Failed deployment did not rewind data",
    await r.provider.rows(
      database,
      "SELECT title, completed FROM todos WHERE title = ?",
      Schema.JsonObject,
      [title]
    ),
    [{ title, completed: 1 }],
    true
  )
  await app.close()
  await secret(r, "SMOKE_FAIL_RELEASE", null)
}

export async function restore(r: LifecycleActionRuntime, undo: boolean) {
  const recoveryId = undo
    ? r.deployment.id
    : requireValue(r.state.recovery, "Release recovery point missing")
        .deploymentId
  const result = await deploy(r, recoveryId)
  const app = await r.app(
    requireValue(result.production_url, "Restored production URL missing")
  )
  await r.identity(app, result.commit, "production")
  const title = `${r.state.marker}-recovery`
  await app.reload()
  r.assert(
    undo
      ? "Undo restores pre-restore browser value"
      : "Restore rewinds browser value",
    await app.getByRole("checkbox", { name: title, exact: true }).isChecked(),
    undo
  )
  r.assert(
    "Paired application secret version",
    await app.locator("[data-smoke-secret]").textContent(),
    undo ? "after" : "before"
  )
  r.assert(
    "Provider D1 independently verifies application recovery",
    await r.provider.rows(
      requireValue(r.state.productionDatabaseId, "Production D1 missing"),
      "SELECT title, completed FROM todos WHERE title = ?",
      Schema.JsonObject,
      [title]
    ),
    [{ title, completed: undo ? 1 : 0 }],
    true
  )
  const checkbox = app.getByRole("checkbox", { name: title, exact: true })
  await checkbox.setChecked(!undo)
  await app.reload()
  r.assert(
    "Recovered application accepts and persists authenticated mutation",
    await checkbox.isChecked(),
    !undo
  )
  r.assert(
    "Recovered mutation reached D1",
    await r.provider.rows(
      requireValue(r.state.productionDatabaseId, "Production D1 missing"),
      "SELECT title, completed FROM todos WHERE title = ?",
      Schema.JsonObject,
      [title]
    ),
    [{ title, completed: undo ? 0 : 1 }],
    true
  )
  await checkbox.setChecked(undo)
  await app.reload()
  r.assert(
    "Recovery fixture returned to observed restored value",
    await checkbox.isChecked(),
    undo
  )
  const bindings = await r.provider.settings(
    requireValue(r.state.productionWorker, "Production Worker missing")
  )
  r.assert(
    "Restored Worker retains application D1 identity",
    bindings.bindings.find((item) => item.name === "DB")?.id ?? null,
    r.state.productionDatabaseId ?? null,
    true
  )
  await app.close()
}
