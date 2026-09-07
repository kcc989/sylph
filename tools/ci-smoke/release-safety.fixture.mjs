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

const resources = await import("../../apps/web/src/server/project-resources.ts")
let resourcesReserved = false
mock.module("../../apps/web/src/server/project-resources.ts", () => ({
  ...resources,
  resourcePrefix: async () => "sylph-fixture",
  reserveProjectResources: async () => {
    if (process.argv[2] === "resource-conflict")
      throw new Error("Resource already belongs to another Project")
    resourcesReserved = true
  },
  captureProjectResources: async () => [
    {
      account_id: "account-1",
      project_id: "project-1",
      scope: "production",
      kind: "d1",
      name: "sylph-fixture-db",
      resource_id: "db-1",
      generation: null,
      state: "active",
    },
    {
      account_id: "account-1",
      project_id: "project-1",
      scope: "production",
      kind: "d1",
      name: "sylph-fixture-recovery",
      resource_id: "control-1",
      generation: null,
      state: "active",
      purpose: "recovery_control",
    },
  ],
  finishResourceOperation: async () => {},
}))
mock.module("../../apps/web/src/server/project-configuration.ts", () => ({
  readProjectDomain: async () => null,
  projectSecretEnvironment: async () => ({
    SYLPH_PROJECT_SECRETS: JSON.stringify({ API_KEY: "application-secret" }),
  }),
}))

const { CI } = await import("../../apps/web/src/server/workspace-ci.ts")
const mode = process.argv[2]
const store = new Database(":memory:")
store.exec("PRAGMA foreign_keys = ON")
store.exec(
  await Bun.file(
    new URL("../../packages/db/migrations/0001_initial.sql", import.meta.url)
  ).text()
)
store.exec(`
  INSERT INTO user (id, name, email) VALUES ('admin', 'Admin', 'admin@example.com');
  INSERT INTO organization (id, name, slug) VALUES ('org', 'Organization', 'org');
  INSERT INTO project (id, organization_id, owner_user_id, name, slug, artifact_repo_id, artifact_repo, artifact_remote)
  VALUES ('project-1', 'org', 'admin', 'Verified app', 'verified-app', 'repo', 'repo', 'https://example.com/repo.git');
  INSERT INTO workspace (id, project_id, organization_id, owner_user_id, title, base_artifact_repo, workspace_artifact_repo)
  VALUES ('workspace-1', 'project-1', 'org', 'admin', 'Workspace', 'repo', 'workspace-repo');
`)
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
      "INSERT INTO deployment (id, project_id, [commit], status, actor_user_id, recovery_json, production_url, created_at) VALUES ('baseline', 'project-1', ?, 'succeeded', 'admin', ?, 'https://sylph-fixture-app.account.workers.dev', 1)"
    )
    .run(commit, JSON.stringify({ ...point, deploymentId: "baseline" }))
}
if (mode === "restore-prepublication-failure") {
  store
    .query(
      "INSERT INTO deployment (id, project_id, [commit], status, actor_user_id, mutation_started, created_at) VALUES ('failed-before-publish', 'project-1', ?, 'failed', 'admin', 1, 2)"
    )
    .run("b".repeat(40))
}
store
  .query(
    "INSERT INTO deployment (id, project_id, [commit], status, actor_user_id, base_deployment_id, recovery_deployment_id, created_at) VALUES ('deployment-1', 'project-1', ?, 'queued', 'admin', ?, ?, 3)"
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
  CREDENTIAL_ENCRYPTION_KEY: "fixture-installation-key",
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
const url = "https://sylph-fixture-app.account.workers.dev"
const runner = async (options) => {
  commands.push({
    name: options.name,
    resourcesReserved,
    env: options.env,
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
  if (options.name === "resource-plan")
    stdout = `SYLPH_RESOURCE_PLAN=${JSON.stringify([{ kind: "worker", name: "sylph-fixture-app" }])}`
  if (options.name === "release-review")
    stdout = `SYLPH_MIGRATION_REVIEW=${JSON.stringify({ ...identity, compatible: mode !== "incompatible", evidence: "Migration tested with old and new code" })}`
  if (options.name === "release-prepare")
    stdout =
      mode === "missing-backup"
        ? ""
        : `SYLPH_RECOVERY_POINT=${JSON.stringify({ ...point, resources: mode === "missing-inventory" ? [] : mode === "extra-inventory" ? [...point.resources, { ...point.resources[0], id: "extra-db" }] : point.resources, expiresAt: mode === "expired-backup" ? now - 1 : point.expiresAt })}`
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
