import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { freshSetup } from "../../../tools/release-smoke/lifecycle-workspace"

await runLifecycleAction("fresh-setup", (runtime) => freshSetup(runtime))
