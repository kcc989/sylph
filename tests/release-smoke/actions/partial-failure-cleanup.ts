import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { partialFailureCleanup } from "../../../tools/release-smoke/lifecycle-resources"

await runLifecycleAction("partial-failure-cleanup", (runtime) =>
  partialFailureCleanup(runtime)
)
