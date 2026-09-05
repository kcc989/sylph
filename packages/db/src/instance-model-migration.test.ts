import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"

const migrations = new URL("../migrations/", import.meta.url)
const migration = readFileSync(
  new URL("0020_instance_models.sql", migrations),
  "utf8"
)

test("migration enables only the existing instance default and leaves fresh instances empty", () => {
  using database = new Database(":memory:")
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql") && name < "0020")
    .sort()) {
    database.exec(readFileSync(new URL(name, migrations), "utf8"))
  }
  database.exec(
    "UPDATE installation SET organization_id = 'existing' WHERE id = 'default'"
  )
  database.exec(
    "INSERT INTO organization_model_preference (organization_id, provider_id, model_id, configured_by_user_id) VALUES ('existing', 'openrouter', 'chosen-model', 'admin'), ('other', 'openrouter', 'other-model', 'admin')"
  )
  database.exec(migration)
  const row = database
    .query<{ model_policy: string }, []>(
      "SELECT model_policy FROM installation WHERE id = 'default'"
    )
    .get()
  expect(JSON.parse(row?.model_policy ?? "null")).toEqual({
    models: [{ providerId: "openrouter", modelId: "chosen-model" }],
    defaultModel: { providerId: "openrouter", modelId: "chosen-model" },
  })
  database.exec("INSERT INTO installation (id) VALUES ('fresh')")
  const fresh = database
    .query<{ model_policy: string }, []>(
      "SELECT model_policy FROM installation WHERE id = 'fresh'"
    )
    .get()
  expect(JSON.parse(fresh?.model_policy ?? "null")).toEqual({
    models: [],
    defaultModel: null,
  })
})
