import {
  decodeOpenCodeConnectionResultPromise,
  encodeOpenCodeKeySetupInputSync,
  type OpenCodeConnectionResult,
  type OpenCodeKeySetupInput,
} from "@workspace/domain"

interface OpenCodeKeySetupRuntime {
  readonly connectKey: (
    input: typeof OpenCodeKeySetupInput.Encoded
  ) => Promise<typeof OpenCodeConnectionResult.Encoded>
}

export const discoverOpenCodeKeyModels = async (
  runtime: OpenCodeKeySetupRuntime,
  input: OpenCodeKeySetupInput
) =>
  decodeOpenCodeConnectionResultPromise(
    await runtime.connectKey(encodeOpenCodeKeySetupInputSync(input))
  )
