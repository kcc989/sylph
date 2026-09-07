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
  expect(() =>
    database.exec(
      "INSERT INTO project_auth_secret (project_id, encrypted, iv) VALUES ('missing', 'secret', 'iv')"
    )
  ).toThrow("FOREIGN KEY constraint failed")
})
