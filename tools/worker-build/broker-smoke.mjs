import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

export const verifyDeploymentBroker = async (runtime) => {
  console.log("Checking authorized deployment broker with D1")
  const database = await runtime.getD1Database("DB", "web")
  const migration = await readFile(
    "packages/db/migrations/0001_initial.sql",
    "utf8"
  )
  await database.batch(
    migration
      .split(";")
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => database.prepare(sql))
  )
  const plan = JSON.stringify([
    { kind: "d1", name: "sylph-fixture-db" },
    { kind: "worker", name: "sylph-fixture-web" },
  ])
  const token = `sylph-cap-${"a".repeat(64)}`
  const hash = createHash("sha256").update(token).digest("hex")
  await database.batch([
    database.prepare(
      "INSERT INTO user (id, name, email) VALUES ('fixture', 'Fixture', 'fixture@example.test')"
    ),
    database.prepare(
      "INSERT INTO organization (id, name, slug) VALUES ('fixture', 'Fixture', 'fixture')"
    ),
    database.prepare(
      "INSERT INTO project (id, organization_id, owner_user_id, name, slug, artifact_repo_id, artifact_repo, artifact_remote) VALUES ('fixture', 'fixture', 'fixture', 'Fixture', 'fixture', 'fixture', 'fixture', 'fixture')"
    ),
    database
      .prepare(
        "INSERT INTO project_resource_operation (account_id, project_id, scope, run_id, plan_json, status) VALUES ('account', 'fixture', 'preview', 'run', ?, 'deploying')"
      )
      .bind(plan),
    database
      .prepare(
        "INSERT INTO project_deployment_capability (id, token_hash, project_id, account_id, scope, run_id, plan_json, expires_at) VALUES ('lease', ?, 'fixture', 'account', 'preview', 'run', ?, ?)"
      )
      .bind(hash, plan, Date.now() + 60_000),
  ])
  const options = { headers: { Authorization: `Bearer ${token}` } }
  const response = await runtime.dispatchFetch(
    "https://fixture.test/api/project-deployment/accounts/account/d1/database?name=sylph-fixture-db&page=1",
    options
  )
  assert.equal(response.status, 200, await response.clone().text())
  assert.deepEqual((await response.json()).result, [])
  const redirect = await runtime.dispatchFetch(
    "https://fixture.test/api/project-deployment/accounts/account/d1/database?name=redirect",
    options
  )
  assert.equal(redirect.status, 302)
  assert.equal(redirect.headers.get("Location"), null)
  assert.equal((await redirect.text()).includes("fixture-owner-token"), false)
  const form = new FormData()
  form.set(
    "metadata",
    JSON.stringify({
      main_module: "main.js",
      containers: [],
      migrations: {
        new_classes: [],
        new_sqlite_classes: [],
        deleted_classes: [],
        renamed_classes: [],
        transferred_classes: [],
      },
    })
  )
  form.set(
    "main.js",
    new File(
      ["export default { fetch() { return new Response('fixture') } }"],
      "main.js",
      { type: "application/javascript+module" }
    )
  )
  const encoded = new Response(form)
  const created = await runtime.dispatchFetch(
    "https://fixture.test/api/project-deployment/accounts/account/workers/scripts/sylph-fixture-web",
    {
      headers: {
        ...options.headers,
        "Content-Type": encoded.headers.get("Content-Type"),
      },
      method: "PUT",
      body: await encoded.arrayBuffer(),
    }
  )
  assert.equal(created.status, 200, await created.clone().text())
  assert.equal(
    (
      await database
        .prepare(
          "SELECT resource_id FROM project_deployment_resource WHERE kind = 'worker'"
        )
        .first()
    ).resource_id,
    "sylph-fixture-web"
  )
  const stateUrl =
    "https://fixture.test/api/project-deployment/state/stacks/sylph-fixture/stages/preview/resources/Database"
  const absent = await runtime.dispatchFetch(stateUrl, options)
  assert.equal(absent.status, 200)
  assert.equal(await absent.json(), null)
  const written = await runtime.dispatchFetch(stateUrl, {
    ...options,
    method: "PUT",
    body: JSON.stringify({ status: "created", id: "database" }),
  })
  assert.equal(written.status, 200, await written.clone().text())
  const restored = await runtime.dispatchFetch(stateUrl, options)
  assert.deepEqual(await restored.json(), { status: "created", id: "database" })
}
