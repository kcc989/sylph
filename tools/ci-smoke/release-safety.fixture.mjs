import { mock } from "bun:test"
import { Database } from "bun:sqlite"
import { withRecoveryGate } from "../../packages/cloudflare-recovery/src/worker.ts"

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
  reserveProjectResources: async (_database, credentials, owner, plan) => {
    if (process.argv[2] === "resource-conflict")
      throw new Error("Resource already belongs to another Project")
    store
      .query(
        "INSERT INTO project_resource_operation (account_id, project_id, scope, run_id, plan_json, status) VALUES (?, ?, ?, ?, ?, 'deploying')"
      )
      .run(
        credentials.accountId,
        owner.projectId,
        owner.scope,
        owner.runId,
        JSON.stringify(plan)
      )
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
  removePreviewResources: async () => {},
}))
mock.module("../../apps/web/src/server/project-configuration.ts", () => ({
  readProjectDomain: async () => null,
  projectSecretEnvironment: async () => ({
    SYLPH_PROJECT_SECRETS: JSON.stringify({ API_KEY: "application-secret" }),
  }),
}))

const { capabilityHash } =
  await import("../../apps/web/src/server/deployment-broker.ts")
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
const basic = mode.startsWith("basic")
const checkpoint = mode === "checks-only"
const preview = mode.startsWith("preview")
const captureEvidence =
  mode === "basic-evidence" ||
  mode === "preview-evidence" ||
  (!basic && !checkpoint && !preview)
const managedRelease = !basic && !checkpoint && !preview
store
  .query(
    "UPDATE deployment SET managed_release = ?, capture_evidence = ? WHERE id = 'deployment-1'"
  )
  .run(managedRelease ? 1 : 0, captureEvidence ? 1 : 0)
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
const gate = new Database(":memory:")
gate.exec(
  await Bun.file(
    new URL(
      "../../packages/cloudflare-recovery/src/control.sql",
      import.meta.url
    )
  ).text()
)
const gateEnvironment = {
  SYLPH_RECOVERY_VERIFY_TOKEN: "",
  SYLPH_RECOVERY_CONTROL: {
    prepare(sql) {
      return {
        first: async () => gate.query(sql).get(),
        run: async () => gate.query(sql).run(),
      }
    },
  },
}
const gateContext = { props: {}, exports: {}, tracing: {} }
const gatedApplication = withRecoveryGate(
  async () =>
    new Response(
      `<main data-sylph-checkpoint="${commit}" data-sylph-deployment="production">Application</main>`,
      { headers: { "Content-Type": "text/html" } }
    ),
  async () =>
    mode === "private-probe-failure"
      ? new Response("Verification unavailable", { status: 503 })
      : Response.json({
          checkpoint: commit,
          deployment: "production",
          releaseId: identity.deploymentId,
        })
)
const observations = []
const gateOwner = () =>
  gate.query("SELECT owner FROM sylph_recovery_gate WHERE id = 1").get().owner
const probeApplication = async (privateProbe) => {
  const response = await gatedApplication(
    new Request(
      privateProbe
        ? "https://sylph-fixture-app.account.workers.dev/__sylph/release-verify"
        : "https://sylph-fixture-app.account.workers.dev/",
      privateProbe
        ? {
            headers: {
              Authorization: `Bearer ${gateEnvironment.SYLPH_RECOVERY_VERIFY_TOKEN}`,
            },
          }
        : {}
    ),
    gateEnvironment,
    gateContext
  )
  observations.push({
    action: privateProbe ? "private-probe" : "public-page",
    status: response.status,
    owner: gateOwner(),
  })
  return response
}
const commands = []
const artifacts = []
let selector = null
const environment = {
  DB: database,
  WORKSPACES: {
    idFromName: (id) => id,
    get: () => ({
      applyCheckUpdate: async () => {},
      expireCheckPreview: async () => {},
    }),
  },
  SYLPH_URL: "https://fixture.sylph.example",
  CLOUDFLARE_ACCOUNT_ID: "account-1",
  CREDENTIAL_ENCRYPTION_KEY: "fixture-installation-key",
  CI_VERIFICATION_CONCURRENCY: "1",
  BROWSER: {
    quickAction: async (_action, input) => {
      selector = input.waitForSelector.selector
      const response = await probeApplication(false)
      const html = await response.text()
      if (
        !response.ok ||
        !html.includes(`data-sylph-checkpoint="${commit}"`) ||
        !html.includes('data-sylph-deployment="production"')
      )
        throw new Error(
          "The public application page is not available with the required deployment identity"
        )
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
  const capability = options.env?.CLOUDFLARE_API_TOKEN
    ? store
        .query(
          "SELECT c.id FROM project_deployment_capability c JOIN project_resource_operation o ON o.project_id = c.project_id AND o.account_id = c.account_id AND o.scope = c.scope AND o.run_id = c.run_id WHERE c.token_hash = ? AND c.revoked = 0 AND c.expires_at > ? AND c.plan_json = o.plan_json AND o.status = 'deploying'"
        )
        .get(await capabilityHash(options.env.CLOUDFLARE_API_TOKEN), Date.now())
    : null
  commands.push({
    name: options.name,
    command: options.command,
    capabilityVerified: capability !== null,
    resourcesReserved,
    env: options.env,
    cloudflareCredentials: options.cloudflareCredentials,
    sourceControlCredentials: options.sourceControlCredentials,
    secrets: options.secrets,
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
  if (options.name === "release-prepare") {
    gateEnvironment.SYLPH_RECOVERY_VERIFY_TOKEN =
      options.env.SYLPH_RECOVERY_VERIFY_TOKEN
    gate
      .query("UPDATE sylph_recovery_gate SET owner = ? WHERE id = 1")
      .run(identity.deploymentId)
    const blocked = await probeApplication(false)
    if (blocked.status !== 503)
      throw new Error("Application gate did not pause ordinary requests")
  }
  if (options.name.startsWith("production-journey")) {
    const response = await probeApplication(true)
    if (!response.ok) throw new Error("Private application verification failed")
    const actual = await response.json()
    if (
      actual.checkpoint !== commit ||
      actual.releaseId !== identity.deploymentId
    )
      throw new Error("Private deployment identity mismatch")
  }
  if (options.name === "release-resume") {
    gate
      .query(
        "UPDATE sylph_recovery_gate SET owner = NULL WHERE id = 1 AND owner = ?"
      )
      .run(identity.deploymentId)
    observations.push({ action: "resume", owner: gateOwner() })
  }
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
  if (options.name === "preview") stdout = `SYLPH_PREVIEW_URL=${url}`
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
      deploymentId: checkpoint || preview ? null : "deployment-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      checkpointId: null,
      kind: checkpoint ? "checkpoint" : preview ? "preview" : "production",
      managedRelease,
      captureEvidence,
      attempt: 1,
      createdAt: now,
    },
  },
  {
    do: async (_name, options, body) => (body ?? options)(),
    sleep: async () => {},
  },
  { runner }
)
console.log(
  JSON.stringify({
    commands,
    artifacts,
    selector,
    observations,
    gateOwner: gateOwner(),
    capabilities: store
      .query(
        "SELECT project_id, scope, run_id, revoked FROM project_deployment_capability"
      )
      .all(),
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
