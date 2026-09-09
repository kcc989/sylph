import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const initialSchema = readFileSync(
  new URL("../migrations/0001_initial.sql", import.meta.url),
  "utf8"
)

test("a fresh installation is unclaimed with an empty model policy", () => {
  using database = new Database(":memory:")
  database.exec("PRAGMA foreign_keys = ON")
  database.exec(initialSchema)
  expect(database.query("SELECT * FROM installation").all()).toEqual([
    {
      id: "default",
      organization_id: null,
      claimed_by_user_id: null,
      claimed_at: null,
      created_at: expect.any(Number),
      model_policy: JSON.stringify({ models: [], defaultModel: null }),
    },
  ])
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([])
  expect(database.query("PRAGMA integrity_check").get()).toEqual({
    integrity_check: "ok",
  })
  expect(
    database
      .query(
        "SELECT name, dflt_value FROM pragma_table_info('deployment') WHERE name IN ('managed_release', 'capture_evidence') ORDER BY name"
      )
      .all()
  ).toEqual([
    { name: "capture_evidence", dflt_value: "0" },
    { name: "managed_release", dflt_value: "0" },
  ])
  expect(() =>
    database.exec(
      "INSERT INTO project_auth_secret (project_id, encrypted, iv) VALUES ('missing', 'secret', 'iv')"
    )
  ).toThrow("FOREIGN KEY constraint failed")
})

test("fresh resource schema permits reviewed retirement and prevents duplicate claims", () => {
  using database = new Database(":memory:")
  database.exec("PRAGMA foreign_keys = ON")
  database.exec(initialSchema)
  database.exec(`
    INSERT INTO user (id, name, email) VALUES ('admin', 'Admin', 'admin@example.com');
    INSERT INTO organization (id, name, slug) VALUES ('org', 'Organization', 'org');
    INSERT INTO project (id, organization_id, owner_user_id, name, slug, artifact_repo_id, artifact_repo, artifact_remote)
    VALUES ('project', 'org', 'admin', 'Project', 'project', 'repo', 'repo', 'https://example.com/repo.git');
    INSERT INTO project_resource (account_id, project_id, scope, kind, name, resource_id, state)
    VALUES ('account', 'project', 'production', 'd1', 'existing-db', 'existing-id', 'active');
    INSERT INTO project_resource_operation (account_id, project_id, scope, run_id, plan_json, status)
    VALUES ('account', 'project', 'production', 'run', '[]', 'complete');
  `)
  expect(
    database
      .query("SELECT resource_id, purpose, state FROM project_resource")
      .get()
  ).toEqual({
    resource_id: "existing-id",
    purpose: "application",
    state: "active",
  })
  database.exec("UPDATE project_resource SET state = 'retired'")
  database.exec("UPDATE project_resource_operation SET status = 'maintaining'")
  expect(() =>
    database.exec(
      "INSERT INTO project_resource (account_id, project_id, scope, kind, name, resource_id) VALUES ('account', 'project', 'other', 'd1', 'alias', 'existing-id')"
    )
  ).toThrow("UNIQUE constraint failed")
  expect(database.query("PRAGMA foreign_key_check").all()).toEqual([])
  expect(database.query("PRAGMA integrity_check").get()).toEqual({
    integrity_check: "ok",
  })
})
