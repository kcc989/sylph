import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { productionRelease } from "../../../tools/release-smoke/lifecycle-release"

await runLifecycleAction("production-release", (runtime) =>
  productionRelease(runtime)
)
