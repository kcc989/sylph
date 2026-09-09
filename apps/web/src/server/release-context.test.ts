import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { releaseContextSql } from "./release-reservation"

test("published identity keeps commit and URL together across failed releases", () => {
  const database = new Database(":memory:")
  database.exec(
    "CREATE TABLE deployment (id TEXT, project_id TEXT, [commit] TEXT, status TEXT, production_url TEXT, recovery_deployment_id TEXT, recovery_json TEXT, created_at INTEGER, mutation_started INTEGER, managed_release INTEGER DEFAULT 0, capture_evidence INTEGER DEFAULT 0)"
  )
  const insert = database.query(
    "INSERT INTO deployment (id, project_id, [commit], status, production_url, created_at, mutation_started) VALUES (?, 'project', ?, ?, ?, ?, ?)"
  )
  insert.run(
    "live-a",
    "a".repeat(40),
    "succeeded",
    "https://a.example.com",
    1,
    1
  )
  insert.run("failed-b", "b".repeat(40), "failed", null, 2, 1)
  insert.run("recovery", "a".repeat(40), "running", null, 3, 0)
  const read = () =>
    database
      .query<
        { base_commit: string | null; base_url: string | null },
        [string, string]
      >(releaseContextSql)
      .get("recovery", "project")
  expect(read()).toMatchObject({
    base_commit: "a".repeat(40),
    base_url: "https://a.example.com",
  })
  database
    .query("UPDATE deployment SET production_url = ? WHERE id = 'failed-b'")
    .run("https://b.example.com")
  expect(read()).toMatchObject({
    base_commit: "b".repeat(40),
    base_url: "https://b.example.com",
  })
  database.exec("UPDATE deployment SET production_url = NULL")
  expect(read()).toMatchObject({ base_commit: null, base_url: null })
  database.close()
})
