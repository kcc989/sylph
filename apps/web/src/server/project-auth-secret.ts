import { decryptCredential, encryptCredential } from "./credentials.server"

interface ProjectAuthSecretDatabase {
  prepare(sql: string): {
    bind(...values: string[]): {
      first<T>(): Promise<T | null>
      run(): Promise<{ success?: boolean; changes?: number }>
    }
  }
}

interface StoredProjectAuthSecret {
  encrypted: string
  iv: string
}

export const projectAuthSecret = async (
  database: ProjectAuthSecretDatabase,
  projectId: string,
  encryptionKey: string
) => {
  const read = () =>
    database
      .prepare(
        "SELECT encrypted, iv FROM project_auth_secret WHERE project_id = ?"
      )
      .bind(projectId)
      .first<StoredProjectAuthSecret>()
  let stored = await read()
  if (!stored) {
    const secret = Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("")
    const encrypted = await encryptCredential(secret, encryptionKey)
    await database
      .prepare(
        "INSERT INTO project_auth_secret (project_id, encrypted, iv) VALUES (?, ?, ?) ON CONFLICT(project_id) DO NOTHING"
      )
      .bind(projectId, encrypted.encrypted, encrypted.iv)
      .run()
    stored = await read()
  }
  if (!stored)
    throw new Error("The Project authentication secret was not saved")
  return decryptCredential(stored.encrypted, stored.iv, encryptionKey)
}
