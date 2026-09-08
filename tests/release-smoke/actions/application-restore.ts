import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { restore } from "../../../tools/release-smoke/lifecycle-release"

await runLifecycleAction("application-restore", (runtime) =>
  restore(runtime, false)
)
