import { Schema } from "effect"

import {
  OpenCodeCredential,
  type OpenCodeKeyConfiguration,
} from "@workspace/domain"

const decodeOpenCodeCredentialPromise =
  Schema.decodeUnknownPromise(OpenCodeCredential)

export const normalizeProviderApiKey = (value: string) => {
  const trimmed = value.trim()
  const first = trimmed.at(0)
  const last = trimmed.at(-1)

  if (
    trimmed.length >= 2 &&
    ((first === '"' && last === '"') || (first === "'" && last === "'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

export const encodeKeyCredential = (
  key: string,
  configuration?: OpenCodeKeyConfiguration
) =>
  JSON.stringify({
    type: "key",
    key: normalizeProviderApiKey(key),
    configuration,
  })

export const decodeStoredCredential = async (
  authMethod: string,
  plaintext: string
): Promise<OpenCodeCredential> => {
  if (authMethod === "chatgpt-subscription") {
    return decodeOpenCodeCredentialPromise(JSON.parse(plaintext))
  }

  try {
    const credential = await decodeOpenCodeCredentialPromise(
      JSON.parse(plaintext)
    )
    return credential.type === "key"
      ? { ...credential, key: normalizeProviderApiKey(credential.key) }
      : credential
  } catch {
    return decodeOpenCodeCredentialPromise({
      type: "key",
      key: normalizeProviderApiKey(plaintext),
    })
  }
}
