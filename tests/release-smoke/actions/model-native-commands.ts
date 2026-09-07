import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { modelNativeCommands } from "../../../tools/release-smoke/lifecycle-workspace"

await runLifecycleAction("model-native-commands", (runtime) =>
  modelNativeCommands(runtime)
)
