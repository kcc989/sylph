import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { ownershipConflict } from "../../../tools/release-smoke/lifecycle-resources"

await runLifecycleAction("ownership-conflict", (runtime) =>
  ownershipConflict(runtime)
)
