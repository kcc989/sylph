import { ShellSelect } from "@opencode-ai/core/shell/select"
import { Effect, Layer } from "effect"

export const workspaceShellSelection = [
  ShellSelect.node,
  Layer.succeed(ShellSelect.Service, {
    transform: () => Effect.succeed({ dispose: Effect.void }),
    reload: () => Effect.void,
    resolve: () => Effect.succeed("/bin/bash"),
  }),
] as const
