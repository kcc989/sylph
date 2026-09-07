import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { concurrentPreviews } from "../../../tools/release-smoke/lifecycle-workspace"

await runLifecycleAction("concurrent-previews", (runtime) =>
  concurrentPreviews(runtime)
)
