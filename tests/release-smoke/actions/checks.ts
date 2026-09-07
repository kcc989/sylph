import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { checks } from "../../../tools/release-smoke/lifecycle-workspace"

await runLifecycleAction("checks", (runtime) => checks(runtime))
