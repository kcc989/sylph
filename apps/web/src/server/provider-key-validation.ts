import type { OpenCodeKeyProviderId } from "@workspace/domain"

export type ProviderApiKeyValidationFailure = "rejected" | "unavailable"

export class ProviderApiKeyValidationError extends Error {
  constructor(readonly failure: ProviderApiKeyValidationFailure) {
    super(failure)
  }
}

interface ProviderApiKeyValidationInput {
  readonly providerId: OpenCodeKeyProviderId
  readonly apiKey: string
}

type ProviderApiKeyRequest = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

export const validateProviderApiKey = async (
  input: ProviderApiKeyValidationInput,
  request: ProviderApiKeyRequest = fetch
) => {
  if (input.providerId !== "openrouter") return

  let response: Response
  try {
    response = await request("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${input.apiKey}` },
    })
  } catch {
    throw new ProviderApiKeyValidationError("unavailable")
  }

  if (!response.ok) {
    throw new ProviderApiKeyValidationError("rejected")
  }
}
