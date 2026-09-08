import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Schema } from "effect"
import { LifecycleActionOptions } from "@workspace/domain/lifecycle-actions"
import {
  lifecyclePaths,
  LifecycleScenario,
  type CombinedSmokeRun,
} from "@workspace/domain/lifecycle-proof"
import { lifecycleDigest } from "./lifecycle"

export const actionOrder = [
  "fresh-setup",
  "model-native-commands",
  "checks",
  "concurrent-previews",
  "authenticated-preview",
  "acceptance",
  "production-release",
  "deliberate-failure",
  "application-restore",
  "restore-undo",
  "ownership-conflict",
  "partial-failure-cleanup",
] as const

export async function createLifecycleScenario(
  root: string,
  run: CombinedSmokeRun,
  accountId: string,
  options: LifecycleActionOptions
) {
  Schema.decodeUnknownSync(LifecycleActionOptions)(options)
  const worker = new URL(run.baseURL).hostname.split(".")[0]
  if (!worker || !/^[a-z0-9-]+$/.test(worker))
    throw new Error("Use the printed workers.dev Installation URL")
  const phases = []
  for (const path of actionOrder) {
    const action = `tests/release-smoke/actions/${path}.ts`
    const previous = actionOrder[actionOrder.indexOf(path) - 1]
    phases.push({
      path,
      target: `${run.stage} / ${options.projectName} / ${path}`,
      action,
      actionSha256: lifecycleDigest(
        await readFile(resolve(root, action), "utf8")
      ),
      timeoutSeconds: 1800,
      dependsOn:
        path === "ownership-conflict"
          ? ["production-release"]
          : path === "partial-failure-cleanup"
            ? ["concurrent-previews", "production-release"]
            : previous
              ? [previous]
              : [],
      probes: [
        {
          path: `workers/scripts/${worker}/settings`,
          assertions: [{ pointer: "/success", equals: true }],
        },
      ],
    })
  }
  if (phases.length !== lifecyclePaths.length)
    throw new Error("Missing action path")
  return Schema.decodeUnknownSync(LifecycleScenario)({
    identity: {
      sourceCommit: run.commit,
      templateCommit: run.template.commit,
      stage: run.stage,
    },
    accountId,
    modelBudgetUsd: 4,
    options,
    phases,
  })
}
