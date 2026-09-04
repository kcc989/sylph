import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { schema } from "@workspace/db"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { saveProviderConnection } from "./provider-connection-store"
import { decryptCredential } from "./credentials.server"

const fixture = () => {
  const sqlite = new Database(":memory:")
  const migrations = new URL(
    "../../../../packages/db/migrations/",
    import.meta.url
  )
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql") && name.slice(0, 4) <= "0011")
    .sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), "utf8"))
  }
  const database = drizzle(
    async (query, parameters, method) => {
      expect(parameters.length).toBeLessThanOrEqual(100)
      const statement = sqlite.query(query)
      if (method === "run") {
        statement.run(...parameters)
        return { rows: [] }
      }
      const rows = statement.values(...parameters)
      return { rows: method === "get" ? (rows[0] ?? []) : rows }
    },
    { schema }
  )
  return { sqlite, database }
}

const model = (modelId: string) => ({
  providerId: "openrouter",
  modelId,
  name: modelId,
})

describe("Provider connection persistence", () => {
  test("keeps Personal and Organization credentials, catalogs, and preferences separate", async () => {
    const { sqlite, database } = fixture()
    try {
      const input = {
        database,
        organizationId: "organization",
        userId: "user",
        providerId: "openrouter",
        authMethod: "api-key" as const,
        encryptionSecret: "test-secret",
        recommendedModelId: null,
      }
      await saveProviderConnection({
        ...input,
        scope: "user",
        credential: "personal-key",
        models: [model("personal")],
      })
      await saveProviderConnection({
        ...input,
        scope: "organization",
        credential: "shared-key",
        models: [model("shared")],
      })
      await saveProviderConnection({
        ...input,
        scope: "user",
        authMethod: "chatgpt-subscription",
        credential: "refreshed-subscription",
        models: [model("replacement")],
      })
      const personal = await database
        .select()
        .from(schema.userOpenCodeConnection)
        .get()
      const organization = await database
        .select()
        .from(schema.openCodeConnection)
        .get()
      expect(personal?.authMethod).toBe("chatgpt-subscription")
      expect(organization?.authMethod).toBe("api-key")
      if (!personal || !organization) throw new Error("Connections missing")
      expect(
        await decryptCredential(
          personal.encryptedCredential,
          personal.encryptionIv,
          "test-secret"
        )
      ).toBe("refreshed-subscription")
      expect(
        await decryptCredential(
          organization.encryptedCredential,
          organization.encryptionIv,
          "test-secret"
        )
      ).toBe("shared-key")
      expect(
        (await database.select().from(schema.userProviderModel)).map(
          (row) => row.modelId
        )
      ).toEqual(["replacement"])
      expect(
        (await database.select().from(schema.organizationProviderModel)).map(
          (row) => row.modelId
        )
      ).toEqual(["shared"])
      expect(
        (await database.select().from(schema.userModelPreference).get())
          ?.modelId
      ).toBe("replacement")
      expect(
        (await database.select().from(schema.organizationModelPreference).get())
          ?.modelId
      ).toBe("shared")
    } finally {
      sqlite.close()
    }
  })
  test("normalizes catalogs and batches large writes within D1 limits", async () => {
    const { sqlite, database } = fixture()
    try {
      const models = Array.from({ length: 45 }, (_, index) =>
        model(`model-${index}`)
      )
      const count = await saveProviderConnection({
        database,
        organizationId: "organization",
        userId: "user",
        providerId: "openrouter",
        authMethod: "api-key",
        encryptionSecret: "test-secret",
        recommendedModelId: "model-20",
        scope: "user",
        credential: "key",
        models: [
          ...models,
          model("model-0"),
          { ...model("wrong"), providerId: "other" },
        ],
      })
      expect(count).toBe(45)
      expect(
        await database.select().from(schema.userProviderModel)
      ).toHaveLength(45)
      expect(
        (await database.select().from(schema.userModelPreference).get())
          ?.modelId
      ).toBe("model-20")
    } finally {
      sqlite.close()
    }
  })
})
