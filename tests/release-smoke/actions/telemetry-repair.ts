import { runLifecycleAction } from "../../../tools/release-smoke/lifecycle-action-runtime"
import { telemetryRepair } from "../../../tools/release-smoke/lifecycle-health"

await runLifecycleAction("telemetry-repair", telemetryRepair)
