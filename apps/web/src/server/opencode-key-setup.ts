import {
  decodeOpenCodeConnectionResultPromise,
  encodeOpenCodeKeySetupInputSync,
  failureMessage,
  type OpenCodeConnectionResult,
  type OpenCodeKeySetupInput,
} from "@workspace/domain"

interface OpenCodeKeySetupRuntime {
  readonly connectKey: (
    input: typeof OpenCodeKeySetupInput.Encoded
  ) => Promise<typeof OpenCodeConnectionResult.Encoded>
  readonly evict: () => Promise<void>
}

const credentialReloadRequired = "Workspace runtime credential store refreshed"

export const discoverOpenCodeKeyModels = async (
  runtime: OpenCodeKeySetupRuntime,
  input: OpenCodeKeySetupInput
) => {
  const encoded = encodeOpenCodeKeySetupInputSync(input)
  const result = await runtime.connectKey(encoded).catch(async (cause) => {
    if (failureMessage(cause, "") !== credentialReloadRequired) throw cause
    await runtime.evict().catch(() => undefined)
    return runtime.connectKey(encoded)
  })
  return decodeOpenCodeConnectionResultPromise(result)
}
