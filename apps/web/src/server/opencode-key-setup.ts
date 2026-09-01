import {
  decodeOpenCodeConnectionResultPromise,
  type OpenCodeKeySetupInput,
} from "@workspace/domain"

interface OpenCodeKeySetupRuntime {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
}

const credentialReloadRequired = "Workspace runtime credential store refreshed"

const connectKey = (
  runtime: OpenCodeKeySetupRuntime,
  input: OpenCodeKeySetupInput
) =>
  runtime.fetch("https://workspace/connect/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })

export const discoverOpenCodeKeyModels = async (
  runtime: OpenCodeKeySetupRuntime,
  input: OpenCodeKeySetupInput
) => {
  let response = await connectKey(runtime, input)

  if (
    response.status === 409 &&
    (await response.text()) === credentialReloadRequired
  ) {
    await runtime.fetch("https://workspace/evict", { method: "POST" })
    response = await connectKey(runtime, input)
  }

  if (!response.ok) throw new Error(await response.text())
  return decodeOpenCodeConnectionResultPromise(await response.json())
}
