import { expect } from "@playwright/test"
import { Schema } from "effect"
import {
  ProjectResourceOperation,
  StoredProjectResource,
} from "@workspace/domain/project-resources"
import {
  LifecycleProjectRow,
  LifecycleActionBlocked,
} from "@workspace/domain/lifecycle-actions"
import {
  eventually,
  requireValue,
  type LifecycleActionRuntime,
} from "./lifecycle-action-runtime"

const inventory = (r: LifecycleActionRuntime, projectId = r.project.id) =>
  r.provider.rows(
    r.state.installationDatabaseId,
    "SELECT account_id, project_id, scope, kind, name, resource_id, generation, purpose, state FROM project_resource WHERE project_id = ? ORDER BY scope, kind, name",
    StoredProjectResource,
    [projectId]
  )

export async function ownershipConflict(r: LifecycleActionRuntime) {
  const before = await inventory(r)
  const selected = before.filter(
    (item) =>
      item.scope === "production" &&
      item.state === "active" &&
      item.purpose !== "recovery_control"
  )
  if (!selected.length)
    throw new Error("No owned production resources to challenge")
  const database = requireValue(
    r.state.productionDatabaseId,
    "Production database missing"
  )
  const dataBefore = await r.provider.rows(
    database,
    "SELECT title, completed FROM todos ORDER BY title",
    Schema.JsonObject
  )
  await r.page.goto("/projects/new")
  await r.page
    .getByLabel("Project name")
    .fill(`${r.options.projectName} ownership challenger`)
  await r.page.getByRole("button", { name: "Create Project" }).click()
  await r.page.waitForURL(/\/projects\/[^/]+\/workspaces\/[^/?]+/, {
    timeout: 180_000,
  })
  const slug = requireValue(
    new URL(r.page.url()).pathname.split("/")[2],
    "Challenger Project URL missing"
  )
  const challenger = requireValue(
    (
      await r.provider.rows(
        r.state.installationDatabaseId,
        "SELECT id, slug, template_commit FROM project WHERE slug = ?",
        LifecycleProjectRow,
        [slug]
      )
    )[0],
    "Challenger Project missing"
  )
  await r.page.goto(`${r.baseURL}/projects/${challenger.slug}/settings`)
  await r.page.getByText("Manage production resources", { exact: true }).click()
  await r.page.getByLabel("Existing resource plan", { exact: true }).fill(
    JSON.stringify(
      selected.map((item) => ({
        kind: item.kind,
        name: item.name,
        purpose: item.purpose,
        adopted: true,
      }))
    )
  )
  await r.page
    .getByRole("button", { name: "Review action", exact: true })
    .click()
  const alert = r.page.getByRole("alert")
  await expect(alert).toContainText(/already has an ownership claim/i)
  r.assert(
    "Competing adoption rejected by ownership check",
    /already has an ownership claim/i.test(await alert.innerText()),
    true
  )
  r.assert(
    "Existing ownership records unchanged",
    await inventory(r),
    before,
    true
  )
  r.assert(
    "Challenger claimed no resources",
    await inventory(r, challenger.id),
    [],
    true
  )
  r.assert(
    "Existing application data unchanged",
    await r.provider.rows(
      database,
      "SELECT title, completed FROM todos ORDER BY title",
      Schema.JsonObject
    ),
    dataBefore,
    true
  )
  const settings = await r.provider.settings(
    requireValue(r.state.productionWorker, "Production Worker missing")
  )
  r.assert(
    "Provider still binds original database",
    settings.bindings.find((item) => item.name === "DB")?.id ?? null,
    database,
    true
  )
  await r.save("challenger.json", challenger)
}

export async function partialFailureCleanup(r: LifecycleActionRuntime) {
  const scope = requireValue(
    r.options.cleanupScope ??
      (r.state.previews[0]
        ? `preview:${r.state.previews[0].check.id}:${r.state.previews[0].summary.attempt}`
        : undefined),
    "Set options.cleanupScope to an observed failed Preview scope after a controlled provider deletion failure. Sylph has no public fault-injection control; do not edit its ownership or operation rows to create one."
  )
  if (
    !r.state.previews.some(
      (item) => scope === `preview:${item.check.id}:${item.summary.attempt}`
    )
  )
    throw new Error("Cleanup scope is not one of this run's observed Previews")
  const operationSql =
    "SELECT * FROM project_resource_operation WHERE project_id = ? AND scope = ?"
  const operation = requireValue(
    (
      await r.provider.rows(
        r.state.installationDatabaseId,
        operationSql,
        ProjectResourceOperation,
        [r.project.id, scope]
      )
    )[0],
    "No operation exists for selected Preview scope"
  )
  if (operation.status !== "cleanup_failed")
    throw new LifecycleActionBlocked({
      message: `Selected Preview is ${operation.status}. Exercise a controlled provider deletion failure and wait for the original Workflow retries to stop before retrying cleanup.`,
    })
  const originalWorkflow = await r.provider.workflow(
    r.state.workflowName,
    operation.run_id
  )
  if (!["complete", "errored", "terminated"].includes(originalWorkflow))
    throw new LifecycleActionBlocked({
      message:
        "The original Preview Workflow is still retrying cleanup. Wait for its terminal state.",
    })
  const before = await inventory(r)
  const selected = before.filter((item) => item.scope === scope)
  const deleted = selected.filter((item) => item.state === "deleted")
  const remaining = selected.filter(
    (item) => item.state !== "deleted" && item.purpose !== "recovery_control"
  )
  if (!deleted.length || !remaining.length)
    throw new LifecycleActionBlocked({
      message:
        "This is not a partial cleanup: need provider-confirmed removed and remaining application resources in the same failed operation.",
    })
  const live = requireValue(
    r.state.productionDatabaseId,
    "Production D1 missing"
  )
  const bucket = requireValue(r.state.productionBucket, "Production R2 missing")
  const retainedObject = await r.provider.object(bucket, "lifecycle-proof.txt")
  const retainedRows = await r.provider.rows(
    live,
    "SELECT title, completed FROM todos ORDER BY title",
    Schema.JsonObject
  )
  const retained = before.filter(
    (item) => item.scope !== scope || item.purpose === "recovery_control"
  )
  await r.provider.assertResourceStates(deleted, true)
  await r.provider.assertResourceStates(remaining, false)
  r.assert(
    "Persisted partial cleanup has an actual failure",
    Boolean(operation.error),
    true,
    true
  )
  await r.settings()
  const heading = r.page.getByRole("heading", { name: scope, exact: true })
  const section = heading.locator("../../..")
  await section
    .getByRole("button", { name: "Retry cleanup", exact: true })
    .click()
  await section
    .getByRole("button", {
      name: "Delete remaining Preview resources",
      exact: true,
    })
    .click()
  const result = await eventually(
    () =>
      r.provider.rows(
        r.state.installationDatabaseId,
        operationSql,
        ProjectResourceOperation,
        [r.project.id, scope]
      ),
    (rows) => rows[0]?.status === "complete" || rows[0]?.status === "deleted",
    "retry cleanup finishes"
  )
  const after = await inventory(r)
  const removed = after.filter(
    (item) => item.scope === scope && item.purpose !== "recovery_control"
  )
  r.assert(
    "All selected application resource rows are deleted",
    removed.map((item) => item.state),
    removed.map(() => "deleted"),
    true
  )
  await r.provider.assertResourceStates(removed, true)
  await r.provider.assertResourceStates(
    retained.filter((item) => item.state === "active"),
    false
  )
  r.assert(
    "Other ownership records remain intact",
    after.filter(
      (item) => item.scope !== scope || item.purpose === "recovery_control"
    ),
    retained,
    true
  )
  r.assert(
    "Production data remains intact",
    await r.provider.rows(
      live,
      "SELECT title, completed FROM todos ORDER BY title",
      Schema.JsonObject
    ),
    retainedRows,
    true
  )
  r.assert(
    "Cleanup retains production R2 body and metadata",
    await r.provider.object(bucket, "lifecycle-proof.txt"),
    retainedObject,
    true
  )
  r.assert(
    "Cleanup retains recovery control metadata",
    result[0]?.status ?? null,
    selected.some((item) => item.purpose === "recovery_control")
      ? "complete"
      : "deleted",
    true
  )
  await r.settings()
  const text = await r.page
    .getByRole("region", { name: "Cloudflare resources", exact: true })
    .innerText()
  r.assert(
    "Resource inventory renders cleanup result",
    text.includes("deleted"),
    true
  )
}
