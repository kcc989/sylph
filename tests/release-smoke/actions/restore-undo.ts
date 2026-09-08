import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { restore } from "../../../tools/release-smoke/lifecycle-release"

await runLifecycleAction("restore-undo", (runtime) => restore(runtime, true))
