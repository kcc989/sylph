import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { acceptance } from "../../../tools/release-smoke/lifecycle-browser"

await runLifecycleAction("acceptance", (runtime) => acceptance(runtime))
