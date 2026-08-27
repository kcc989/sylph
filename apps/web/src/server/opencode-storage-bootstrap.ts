interface SqlCursor {
  toArray(): Array<Record<string, SqlStorageValue>>
}

interface SqlStorage {
  exec(query: string, ...bindings: SqlStorageValue[]): SqlCursor
}

interface OpenCodeStorage {
  sql: SqlStorage
}

const sylphTablePrefix = "app_"
const hiddenSylphTablePrefix = "_app_"

const quotedIdentifier = (name: string) => {
  if (!/^_?app_[a-z0-9_]+$/.test(name)) {
    throw new Error(`Unsupported Sylph storage table: ${name}`)
  }
  return `"${name}"`
}

const storageTables = (storage: OpenCodeStorage) =>
  storage.sql
    .exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .toArray()
    .map((table) => String(table["name"]))

const renameTable = (storage: OpenCodeStorage, from: string, to: string) => {
  storage.sql.exec(
    `ALTER TABLE ${quotedIdentifier(from)} RENAME TO ${quotedIdentifier(to)}`
  )
}

const restoreHiddenSylphTables = (storage: OpenCodeStorage) => {
  const tables = new Set(storageTables(storage))
  for (const hiddenName of tables) {
    if (!hiddenName.startsWith(hiddenSylphTablePrefix)) continue
    const visibleName = hiddenName.slice(1)
    if (tables.has(visibleName)) {
      throw new Error(
        `Sylph storage contains both ${visibleName} and ${hiddenName}`
      )
    }
    renameTable(storage, hiddenName, visibleName)
  }
}

export const createOpenCodeWithStorageBootstrap = async <Result>(
  storage: OpenCodeStorage,
  create: () => Promise<Result>
) => {
  const tables = new Set(storageTables(storage))
  const hasOpenCodeSchema = tables.has("session") || tables.has("session_v2")

  if (hasOpenCodeSchema) {
    restoreHiddenSylphTables(storage)
    return create()
  }

  for (const visibleName of tables) {
    if (!visibleName.startsWith(sylphTablePrefix)) continue
    const hiddenName = `_${visibleName}`
    if (tables.has(hiddenName)) {
      throw new Error(
        `Sylph storage contains both ${visibleName} and ${hiddenName}`
      )
    }
    renameTable(storage, visibleName, hiddenName)
  }

  try {
    return await create()
  } finally {
    restoreHiddenSylphTables(storage)
  }
}
