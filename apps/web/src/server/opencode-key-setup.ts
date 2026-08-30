import {
  decodeOpenCodeConnectionResultPromise,
  type OpenCodeKeySetupInput,
} from "@workspace/domain"

interface OpenCodeKeySetupRuntime {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
}

export const discoverOpenCodeKeyModels = async (
  runtime: OpenCodeKeySetupRuntime,
  input: OpenCodeKeySetupInput
) => {
  const response = await runtime.fetch("https://workspace/connect/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })

  if (!response.ok) throw new Error(await response.text())
  return decodeOpenCodeConnectionResultPromise(await response.json())
}
