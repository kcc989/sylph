import {
  decodeOpenCodeCredentialPromise,
  type OpenCodeCredential,
  type OpenCodeKeyConfiguration,
} from "@workspace/domain"

export const encodeKeyCredential = (
  key: string,
  configuration?: OpenCodeKeyConfiguration
) => JSON.stringify({ type: "key", key, configuration })

export const decodeStoredCredential = async (
  authMethod: string,
  plaintext: string
): Promise<OpenCodeCredential> => {
  if (authMethod === "chatgpt-subscription") {
    return decodeOpenCodeCredentialPromise(JSON.parse(plaintext))
  }

  try {
    return await decodeOpenCodeCredentialPromise(JSON.parse(plaintext))
  } catch {
    return decodeOpenCodeCredentialPromise({ type: "key", key: plaintext })
  }
}
