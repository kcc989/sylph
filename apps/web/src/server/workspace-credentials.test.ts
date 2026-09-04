import { Database, type SQLQueryBindings } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import type { OpenAIOAuthRequestState } from "./opencode-oauth-request"
import { Effect } from "effect"
import { WorkspaceCredentials } from "./workspace-credentials"
import { OpenCodeCredentialReloadRequired } from "./opencode-key-credential"

const fixture = () => {
  const sqlite = new Database(":memory:")
  sqlite.exec(
    "CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT, value TEXT, connector_id TEXT, method_id TEXT, active INTEGER, time_created INTEGER, time_updated INTEGER)"
  )
  const storage = {
    sql: {
      exec: <Row extends Record<string, SqlStorageValue>>(
        query: string,
        ...bindings: SqlStorageValue[]
      ) => {
        const values: SQLQueryBindings[] = bindings.map((value) =>
          value instanceof ArrayBuffer ? new Uint8Array(value) : value
        )
        const rows = sqlite.query<Row, SQLQueryBindings[]>(query).all(...values)
        return { toArray: () => rows }
      },
    },
  }
  const activations: string[] = []
  const source = {
    credential: {
      activate: async ({ credentialID }: { credentialID: string }) => {
        activations.push(credentialID)
        sqlite
          .query("UPDATE credential SET active = (id = ?)")
          .run(credentialID)
      },
      remove: async () => {},
    },
    integration: {
      get: async () => ({ data: { connections: [] } }),
      connect: { key: async () => {} },
    },
    events: {
      subscribe: async function* () {
        yield { type: "server.connected" }
        yield { type: "catalog.updated" }
      },
    },
  }
  const oauth: OpenAIOAuthRequestState = {
    active: false,
    accountID: null,
  }
  const layer = WorkspaceCredentials.layer(
    Promise.resolve(source),
    storage,
    oauth
  )
  const credentials = Effect.runSync(
    Effect.gen(function* () {
      return yield* WorkspaceCredentials
    }).pipe(Effect.provide(layer))
  )
  return { sqlite, storage, source, oauth, activations, credentials }
}

const credential = {
  type: "oauth" as const,
  methodID: "chatgpt-headless",
  access: "access",
  refresh: "refresh",
  expires: 123,
  metadata: { accountID: "account" },
}

describe("Workspace credential installation", () => {
  test("updates the retained subscription and removes the switching credential after catalog activation", async () => {
    const f = fixture()
    try {
      await f.credentials.install("openai", credential)
      await f.credentials.install("openai", {
        ...credential,
        access: "updated",
      })
      const rows = f.sqlite
        .query<{ id: string; value: string; active: number }, []>(
          "SELECT id, value, active FROM credential"
        )
        .all()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.value).toContain("updated")
      expect(rows[0]?.active).toBe(1)
      expect(f.activations[0]).toBe(f.activations[1])
      expect(f.oauth).toEqual({ active: true, accountID: "account" })
    } finally {
      f.sqlite.close()
    }
  })
  test("switching to an API key clears subscription request state", async () => {
    const f = fixture()
    try {
      f.oauth.active = true
      f.oauth.accountID = "account"
      await f.credentials.install("openai", {
        type: "key",
        key: "key",
      })
      expect(f.oauth).toEqual({ active: false, accountID: null })
    } finally {
      f.sqlite.close()
    }
  })
  test("preserves the reload signal for retained credentials", async () => {
    const f = fixture()
    try {
      f.source.integration.connect.key = async () => {
        throw new OpenCodeCredentialReloadRequired()
      }
      await expect(
        f.credentials.install("openai", {
          type: "key",
          key: "key",
        })
      ).rejects.toBeInstanceOf(OpenCodeCredentialReloadRequired)
    } finally {
      f.sqlite.close()
    }
  })
})
