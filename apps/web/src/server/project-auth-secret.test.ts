import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { projectAuthSecret } from "./project-auth-secret"

test("Project secrets survive retries, isolate Projects, and stay encrypted", async () => {
  const sqlite = new Database(":memory:")
  sqlite.exec(
    await Bun.file(
      new URL(
        "../../../../packages/db/migrations/0001_initial.sql",
        import.meta.url
      )
    ).text()
  )
  sqlite.exec(
    "INSERT INTO user (id, name, email) VALUES ('owner', 'Owner', 'owner@example.com')"
  )
  sqlite.exec(
    "INSERT INTO organization (id, name, slug) VALUES ('org', 'Organization', 'org')"
  )
  sqlite.exec(
    "INSERT INTO project (id, organization_id, owner_user_id, name, slug, artifact_repo_id, artifact_repo, artifact_remote) VALUES ('one', 'org', 'owner', 'One', 'one', 'one', 'one', 'https://example.com/one'), ('two', 'org', 'owner', 'Two', 'two', 'two', 'two', 'https://example.com/two')"
  )
  const database = {
    prepare: (sql: string) => ({
      bind: (...values: string[]) => ({
        first: async <T>() => sqlite.query<T, string[]>(sql).get(...values),
        run: async () => sqlite.query(sql).run(...values),
      }),
    }),
  }
  const key = "test-encryption-key"
  const [first, concurrent] = await Promise.all([
    projectAuthSecret(database, "one", key),
    projectAuthSecret(database, "one", key),
  ])
  expect(first).toMatch(/^[a-f0-9]{64}$/)
  expect(concurrent).toBe(first)
  expect(await projectAuthSecret(database, "one", key)).toBe(first)
  expect(await projectAuthSecret(database, "two", key)).not.toBe(first)
  expect(
    JSON.stringify(sqlite.query("SELECT * FROM project_auth_secret").all())
  ).not.toContain(first)
  await expect(
    projectAuthSecret(database, "one", "wrong-key")
  ).rejects.toBeDefined()
  sqlite.close()
})
