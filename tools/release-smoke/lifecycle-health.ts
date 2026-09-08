import { expect } from "@playwright/test"
import { Schema } from "effect"
import {
  Incident,
  HealthObservation,
  CloudflareDeployments,
} from "@workspace/domain/project-operations"
import { LifecycleWorkspaceRow } from "@workspace/domain/lifecycle-actions"
import {
  eventually,
  requireValue,
  type LifecycleActionRuntime,
} from "./lifecycle-action-runtime"
import {
  finishWorkspaceTurn,
  expectExpandableToolCalls,
} from "../../tests/release-smoke/flow-helpers"
import { checkpoint, prompt } from "./lifecycle-workspace"
import { authenticatedPreview, acceptance } from "./lifecycle-browser"
import { deploy } from "./lifecycle-release"
import { jsonPointer } from "./lifecycle"

export async function telemetryRepair(r: LifecycleActionRuntime) {
  const deployed = r.deployment
  const worker = requireValue(
    r.state.productionWorker,
    "Production Worker missing"
  )
  const app = await r.app(
    requireValue(deployed.production_url, "Production URL missing")
  )
  const probeUrl = new URL(
    `/smoke-health?probe=${encodeURIComponent(r.state.marker)}`,
    app.url()
  ).href
  const started = Date.now()
  const response = await app.goto(probeUrl)
  r.assert(
    "Authenticated request reproduces runtime defect",
    response?.status() ?? null,
    500
  )
  await expect(app.locator("body")).toContainText(
    "SYLPH_EXPECTED_RUNTIME_FAILURE"
  )
  const browserRequestId = requireValue(
    response?.headers()["cf-ray"]?.split("-")[0],
    "Runtime response has no Cloudflare request ID"
  )
  await app.close()
  const identity = Schema.decodeUnknownSync(CloudflareDeployments)(
    jsonPointer(
      await r.provider.read(`workers/scripts/${worker}/deployments`),
      "/result"
    )
  ).deployments[0]
  const version = requireValue(
    identity?.versions[0]?.version_id,
    "Worker version missing"
  )
  const telemetry = await eventually(
    async () =>
      r.provider.telemetry({
        queryId: crypto.randomUUID(),
        timeframe: { from: started - 1000, to: Date.now() },
        limit: 100,
        dry: true,
        view: "events",
        parameters: {
          filters: [
            {
              key: "$workers.scriptName",
              operation: "eq",
              type: "string",
              value: worker,
            },
            {
              key: "$workers.scriptVersion.id",
              operation: "eq",
              type: "string",
              value: version,
            },
            {
              key: "$metadata.type",
              operation: "eq",
              type: "string",
              value: "cf-worker-event",
            },
          ],
        },
      }),
    (result) =>
      result.run.status === "COMPLETED" &&
      Boolean(
        result.events?.events?.some(
          (event) =>
            event.$metadata.statusCode === 500 &&
            event.timestamp >= started &&
            event.$workers?.requestId === browserRequestId
        )
      ),
    "provider records real runtime failure"
  )
  const failure = requireValue(
    telemetry.events?.events?.find(
      (event) =>
        event.$metadata.statusCode === 500 &&
        event.timestamp >= started &&
        event.$workers?.requestId === browserRequestId
    ),
    "Runtime failure event missing"
  )
  const requestId = requireValue(
    failure.$workers?.requestId,
    "Provider failure request ID missing"
  )
  r.assert(
    "Provider event matches the exact failing browser request",
    requestId,
    browserRequestId,
    true
  )
  r.assert(
    "Provider failure belongs to deployed version",
    failure.$workers?.scriptVersion?.id ?? null,
    version,
    true
  )
  let lastCollection = 0
  const incidents = await eventually(
    async () => {
      if (Date.now() - lastCollection >= 60_000) {
        await r.settings()
        await r.page
          .getByRole("button", { name: "Collect health", exact: true })
          .click()
        lastCollection = Date.now()
      }
      return r.provider.rows(
        r.state.installationDatabaseId,
        "SELECT id, deployment_id, commit, kind, status, first_seen, last_seen, observation_json, workspace_id, issue_id FROM project_incident WHERE deployment_id = ? AND kind = 'errors'",
        Incident,
        [deployed.id]
      )
    },
    (rows) =>
      rows.some((row) =>
        Schema.decodeUnknownSync(HealthObservation)(
          JSON.parse(row.observation_json)
        ).evidence.some((event) => event.requestId === requestId)
      ),
    "product observes same provider error",
    900_000
  )
  const incident = requireValue(
    incidents.find((row) =>
      Schema.decodeUnknownSync(HealthObservation)(
        JSON.parse(row.observation_json)
      ).evidence.some((event) => event.requestId === requestId)
    ),
    "Correlated incident missing"
  )
  r.assert(
    "Incident binds failing deployed commit",
    incident.commit,
    deployed.commit,
    true
  )
  await r.settings()
  const health = r.page.getByRole("region", {
    name: "Production health",
    exact: true,
  })
  const row = health
    .getByRole("listitem")
    .filter({ hasText: `Commit ${deployed.commit}` })
    .filter({ hasText: "Production errors" })
  await expect(row).toHaveCount(1)
  await row
    .getByRole("button", { name: "Create repair Workspace", exact: true })
    .click()
  await row
    .getByRole("link", { name: "Open repair Workspace", exact: true })
    .click()
  await r.page.waitForURL(/\/workspaces\/[^/?]+/)
  const workspaceId = requireValue(
    new URL(r.page.url()).pathname.split("/").at(-1),
    "Repair Workspace URL missing"
  )
  const workspace = requireValue(
    (
      await r.provider.rows(
        r.state.installationDatabaseId,
        "SELECT id, project_id, status, fork_head, accepted_commit, repair_commit FROM workspace WHERE id = ?",
        LifecycleWorkspaceRow,
        [workspaceId]
      )
    )[0],
    "Repair Workspace missing"
  )
  r.assert(
    "Repair starts from actual deployed commit",
    workspace.repair_commit ?? null,
    deployed.commit,
    true
  )
  r.assert(
    "Repair has a separate inference budget",
    workspace.id !== r.workspace.id,
    true,
    true
  )
  r.state = { ...r.state, workspace, workspaceUrl: r.page.url() }
  await expect
    .poll(
      async () =>
        (await r.page.getByText("Agent working", { exact: true }).count()) >
          0 ||
        (await r.page.locator('button[aria-label$=", completed"]').count()) > 0,
      { timeout: 180_000 }
    )
    .toBe(true)
  await finishWorkspaceTurn(r.page)
  await prompt(
    r,
    `Complete the repair for the observed /smoke-health?probe=${r.state.marker} failure. That exact authenticated request must now return HTTP 200 with SYLPH_RUNTIME_REPAIRED. Add and run a regression test that fails before your fix and passes afterward. Preserve auth, todo and R2 behavior, release hooks, identity rendering and the release failure wrapper. Do not create a Checkpoint or run a Check.`
  )
  await expectExpandableToolCalls(r.page)
  const preview = await checkpoint(r)
  r.assert(
    "Repair changes deployed source",
    preview.check.commit_sha !== deployed.commit,
    true,
    true
  )
  const repaired = await r.app(preview.url, true)
  const previewResponse = await repaired.goto(
    new URL(
      `/smoke-health?probe=${encodeURIComponent(r.state.marker)}`,
      preview.url
    ).href
  )
  r.assert(
    "Checked repair fixes exact failing request",
    previewResponse?.status() ?? null,
    200
  )
  await expect(repaired.locator("body")).toContainText("SYLPH_RUNTIME_REPAIRED")
  await repaired.close()
  await authenticatedPreview(r)
  await acceptance(r)
  const release = await deploy(r)
  const production = await r.app(
    requireValue(release.production_url, "Repaired production URL missing")
  )
  await r.identity(production, release.commit, "production")
  const fixed = await production.goto(probeUrl)
  r.assert(
    "Released repair fixes original production request",
    fixed?.status() ?? null,
    200
  )
  await expect(production.locator("body")).toContainText(
    "SYLPH_RUNTIME_REPAIRED"
  )
  await production.close()
  await r.save("repaired-incident.json", {
    incidentId: incident.id,
    requestId,
    failingCommit: deployed.commit,
    repairedCommit: release.commit,
    deploymentId: release.id,
    workspaceId,
  })
}
