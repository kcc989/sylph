import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { deliberateFailure } from "../../../tools/release-smoke/lifecycle-release"

await runLifecycleAction("deliberate-failure", (runtime) =>
  deliberateFailure(runtime)
)
