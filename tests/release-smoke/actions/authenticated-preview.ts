import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { authenticatedPreview } from "../../../tools/release-smoke/lifecycle-browser"

await runLifecycleAction("authenticated-preview", (runtime) =>
  authenticatedPreview(runtime)
)
