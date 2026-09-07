import { InstallationGithubApp } from "@workspace/domain"
import { Schema } from "effect"
import { decryptCredential, encryptCredential } from "./credentials.server"

interface InstallationStatement {
  bind(...values: (string | number | null)[]): InstallationStatement
  first<Result>(): Promise<Result | null>
  run(): Promise<{ meta: { changes: number } }>
}

export interface InstallationDatabase {
  prepare(query: string): InstallationStatement
}

export type InstallationGithubBindings = {
  DB: InstallationDatabase
  CREDENTIAL_ENCRYPTION_KEY: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
}

export const readInstallationGithub = async (
  bindings: InstallationGithubBindings
) => {
  const saved = await bindings.DB.prepare(
    "SELECT encrypted, iv FROM installation_github_app WHERE id = 'default'"
  ).first<{ encrypted: string; iv: string }>()
  if (saved) {
    return Schema.decodeUnknownSync(InstallationGithubApp)(
      JSON.parse(
        await decryptCredential(
          saved.encrypted,
          saved.iv,
          bindings.CREDENTIAL_ENCRYPTION_KEY
        )
      )
    )
  }
  return {
    clientId: bindings.GITHUB_CLIENT_ID,
    clientSecret: bindings.GITHUB_CLIENT_SECRET,
    appUrl: "",
  }
}

export const saveInstallationGithub = async (
  bindings: InstallationGithubBindings,
  input: InstallationGithubApp
) => {
  const encoded = Schema.encodeSync(InstallationGithubApp)(input)
  const saved = await encryptCredential(
    JSON.stringify(encoded),
    bindings.CREDENTIAL_ENCRYPTION_KEY
  )
  const result = await bindings.DB.prepare(
    "INSERT INTO installation_github_app (id, encrypted, iv) SELECT 'default', ?, ? WHERE EXISTS (SELECT 1 FROM installation WHERE id = 'default' AND claimed_by_user_id IS NULL) ON CONFLICT(id) DO UPDATE SET encrypted = excluded.encrypted, iv = excluded.iv"
  )
    .bind(saved.encrypted, saved.iv)
    .run()
  if (result.meta.changes !== 1)
    throw new Error("This Installation has already been claimed")
}
