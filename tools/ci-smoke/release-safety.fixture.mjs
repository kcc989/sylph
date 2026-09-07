import { mock } from "bun:test"
import { Database } from "bun:sqlite"

mock.module("@cloudflare/ci", () => ({
  CIWorkflow: class {
    constructor(environment) {
      this.env = environment
    }
    run(event, step, ci) {
      return this.pipeline(event, step, ci)
    }
  },
  isCiRunnerFailure: () => false,
}))
mock.module("../../apps/web/src/server/project-auth-secret.ts", () => ({
  projectAuthSecret: async () => "test-secret",
}))

const { CI } = await import("../../apps/web/src/server/workspace-ci.ts")
const mode = process.argv[2]
const store = new Database(":memory:")
store.exec(`
  CREATE TABLE project (id TEXT PRIMARY KEY, slug TEXT);
  INSERT INTO project VALUES ('project-1', 'verified-app');
  CREATE TABLE deployment (id TEXT PRIMARY KEY, project_id TEXT, [commit] TEXT, status TEXT, production_url TEXT, actor_user_id TEXT, failure_details TEXT, started_at INTEGER, completed_at INTEGER, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE ci_runs (id TEXT PRIMARY KEY, project_id TEXT, workspace_id TEXT, agent_session_id TEXT, workflow_instance_id TEXT, commit_sha TEXT, kind TEXT, status TEXT, summary_json TEXT, started_at INTEGER, finished_at INTEGER, created_at INTEGER, updated_at INTEGER);
`)
store.exec(
  await Bun.file(
    new URL(
      "../../packages/db/migrations/0024_release_safety.sql",
      import.meta.url
    )
  ).text()
)
const commit = "a".repeat(40)
const recovering = mode.startsWith("restore")
const identity = {
  deploymentId: "deployment-1",
  projectId: "project-1",
  commit,
  baseCommit: recovering ? commit : null,
}
const now = Date.now()
const point = {
  ...identity,
  capturedAt: now,
  expiresAt: now + 3_600_000,
  writesPaused: true,
  inventoryComplete: true,
  resources: [
    {
      id: "db-1",
      kind: "database",
      backupRef: "opaque-backup-1",
      restoreVerifiedAt: now - 1000,
    },
  ],
}
if (recovering) {
  store
    .query(
      "INSERT INTO deployment (id, project_id, [commit], status, recovery_json, created_at) VALUES ('baseline', 'project-1', ?, 'succeeded', ?, 1)"
    )
    .run(commit, JSON.stringify({ ...point, deploymentId: "baseline" }))
}
store
  .query(
    "INSERT INTO deployment (id, project_id, [commit], status, base_deployment_id, recovery_deployment_id, created_at) VALUES ('deployment-1', 'project-1', ?, 'queued', ?, ?, 2)"
  )
  .run(commit, recovering ? "baseline" : null, recovering ? "baseline" : null)
const database = {
  prepare(sql) {
    return {
      bind(...parameters) {
        return {
          first: async () => store.query(sql).get(...parameters),
          run: async () => {
            if (
              mode === "backup-save-failure" &&
              sql.includes("SET recovery_json")
            )
              throw new Error("Storage unavailable")
            return {
              meta: { changes: store.query(sql).run(...parameters).changes },
            }
          },
        }
      },
    }
  },
}
const commands = []
const artifacts = []
let selector = null
const environment = {
  DB: database,
  CLOUDFLARE_ACCOUNT_ID: "account-1",
  CI_VERIFICATION_CONCURRENCY: "1",
  BROWSER: {
    quickAction: async (_action, input) => {
      selector = input.waitForSelector.selector
      if (mode === "browser-failure")
        throw new Error("Production marker missing")
      return Response.json({
        result: { screenshot: btoa("image"), accessibilityTree: {} },
      })
    },
  },
  CHECK_EVIDENCE: {
    put: async (key) => {
      artifacts.push(key)
    },
  },
}
const url = "https://app.account.workers.dev"
const runner = async (options) => {
  commands.push({
    name: options.name,
    deployment: store
      .query(
        "SELECT status, recovery_json, verification_json FROM deployment WHERE id = 'deployment-1'"
      )
      .get(),
  })
  if (mode === "restore-failure" && options.name === "data-restore")
    throw new Error("Restore failed")
  if (mode === "resume-failure" && options.name === "release-resume")
    throw new Error("Resume failed")
  let stdout = ""
  if (options.name === "release-review")
    stdout = `SYLPH_MIGRATION_REVIEW=${JSON.stringify({ ...identity, compatible: mode !== "incompatible", evidence: "Migration tested with old and new code" })}`
  if (options.name === "release-prepare")
    stdout =
      mode === "missing-backup"
        ? ""
        : `SYLPH_RECOVERY_POINT=${JSON.stringify({ ...point, expiresAt: mode === "expired-backup" ? now - 1 : point.expiresAt })}`
  if (options.name === "production") stdout = `SYLPH_PRODUCTION_URL=${url}`
  if (options.name.startsWith("production-journey"))
    stdout = `SYLPH_PRODUCTION_JOURNEY=${JSON.stringify({ deploymentId: identity.deploymentId, commit: mode === "wrong-commit" ? "b".repeat(40) : commit, url, passed: true, journeys: ["Create, read, update, and delete an authenticated record"] })}`
  if (options.name === "data-restore")
    stdout = `SYLPH_DATA_RESTORED=${JSON.stringify({ deploymentId: identity.deploymentId, recoveryDeploymentId: "baseline", commit, restored: true, resources: mode === "restore-incomplete" ? [] : ["database:db-1"] })}`
  if (
    mode === "live-journey-failure" &&
    options.name === "production-journey-live"
  )
    throw new Error("Live journey failed")
  return { runner, logs: { stdout, stderr: "" } }
}
await new CI(environment).run(
  {
    instanceId: "instance-1",
    payload: {
      provider: "cloudflare-artifacts",
      providerData: { namespace: "test" },
      event: { type: "push" },
      owner: "test",
      repo: "app",
      sha: commit,
      trigger: "push",
      ref: "refs/heads/main",
      checkRunId: "deployment-1",
      deploymentId: "deployment-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      checkpointId: null,
      kind: "production",
      attempt: 1,
      createdAt: now,
    },
  },
  { do: async (_name, body) => body() },
  { runner }
)
console.log(
  JSON.stringify({
    commands,
    artifacts,
    selector,
    deployment: store
      .query("SELECT * FROM deployment WHERE id = 'deployment-1'")
      .get(),
    check: {
      ...JSON.parse(
        store
          .query("SELECT summary_json FROM ci_runs WHERE id = 'deployment-1'")
          .get().summary_json
      ),
      ...store
        .query("SELECT status FROM ci_runs WHERE id = 'deployment-1'")
        .get(),
    },
  })
)
