import {
  CIWorkflow,
  isCiRunnerFailure,
  type CiContext,
  type CiParams,
  type CiRunnerResult,
  type CloudflareArtifacts,
} from "@cloudflare/ci"
import {
  WorkspaceCiInput,
  WorkspaceCheckDiagnostic,
  WorkspaceCheckEvidence,
  WorkspaceCheckRun,
  WorkspaceCheckStageName,
  WorkspaceCheckUpdate,
} from "@workspace/domain"
import { Schema } from "effect"
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import type { CiBindings } from "@cloudflare/ci/worker"
import { checkStage, newCheckRun } from "./workspace-checks"
import type { WorkspaceDO } from "./workspace-do"
import { previewRetention, removePreviewWorker } from "./preview-lifecycle"
import {
  deploymentFailedSql,
  deploymentRunningSql,
  deploymentSucceededSql,
  productionUrl,
} from "./deployment-records"
import { ciRunUpsertBindings, ciRunUpsertSql } from "./ci-run-records"

const decodeWorkspaceCheckRun = Schema.decodeUnknownSync(WorkspaceCheckRun)
const decodeWorkspaceCiInput = Schema.decodeUnknownSync(WorkspaceCiInput)
const encodeWorkspaceCheckUpdateSync = Schema.encodeSync(WorkspaceCheckUpdate)

type WorkspaceCiBindings = CiBindings & {
  BROWSER: BrowserRun
  CHECK_EVIDENCE: R2Bucket
  DB: D1Database
  PREVIEW_RETENTION_SECONDS: string
  WORKSPACES: DurableObjectNamespace<WorkspaceDO>
}

type CiRunnerLogs = {
  stdout: string | ReadableStream<Uint8Array>
  stderr: string | ReadableStream<Uint8Array>
}

const isStageName = Schema.is(WorkspaceCheckStageName)

export const installCacheInputs = [
  "package.json",
  "**/package.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  ".yarnrc.yml",
  "package-lock.json",
  ".npmrc",
]

const installCommand = [
  "if [ -f bun.lock ] || [ -f bun.lockb ]; then bun install --frozen-lockfile",
  "elif [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile",
  "elif [ -f yarn.lock ]; then corepack yarn install --immutable",
  "elif [ -f package-lock.json ]; then npm ci",
  "else npm install --ignore-scripts=false; fi",
].join("; ")

const packageRun = (script: string) =>
  [
    `if [ -f bun.lock ] || [ -f bun.lockb ]; then bun run ${script}`,
    `elif [ -f pnpm-lock.yaml ]; then corepack pnpm run ${script}`,
    `elif [ -f yarn.lock ]; then corepack yarn run ${script}`,
    `else npm run ${script}; fi`,
  ].join("; ")

const requiredScriptCommand = (script: string, purpose: string) =>
  `if node -e 'const p=require("./package.json");process.exit(p.scripts?.["${script}"]?0:1)'; then ${packageRun(script)}; else echo "Missing package script ${script} for ${purpose}" >&2; exit 64; fi`

const streamText = async (value: string | ReadableStream<Uint8Array>) => {
  if (value instanceof ReadableStream) return new Response(value).text()
  return value
}

const logsText = async (logs: CiRunnerLogs) => {
  const [stdout, stderr] = await Promise.all([
    streamText(logs.stdout),
    streamText(logs.stderr),
  ])
  return { stdout, stderr }
}

const safeDiagnosticOutput = (value: string) =>
  value
    .replace(
      /(token|secret|password|authorization)\s*[:=]\s*\S+/gi,
      "$1=[redacted]"
    )
    .slice(-20_000)

const previewUrl = (output: string) =>
  output.match(/SYLPH_PREVIEW_URL=(https:\/\/[^\s]+)/)?.[1] ?? null

const bytesFromBase64 = (value: string) => {
  const decoded = atob(value.replace(/^data:image\/\w+;base64,/, ""))
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

export class CI extends CIWorkflow<CloudflareArtifacts, WorkspaceCiBindings> {
  protected async pipeline(
    event: WorkflowEvent<CiParams<CloudflareArtifacts>>,
    step: WorkflowStep,
    ci: CiContext
  ) {
    const input = decodeWorkspaceCiInput(event.payload)
    let run = this.#initialRun(input)
    this.#projectId = input.projectId
    this.#agentSessionId = input.agentSessionId ?? null
    this.#workflowInstanceId = event.instanceId
    run = await this.#publish(step, "run-started", run, {
      status: "running",
    })
    if (input.deploymentId) {
      await step.do("record-deployment-running", async () => {
        await this.env.DB.prepare(deploymentRunningSql)
          .bind(input.deploymentId)
          .run()
      })
    }

    try {
      const install = await this.#runner(step, ci, run, "install", {
        name: "install",
        command: installCommand,
        cache: {
          inputs: installCacheInputs,
        },
      })
      run = install.run

      if (input.kind === "production") {
        const build = await this.#runner(step, install.result, run, "build", {
          name: "build",
          command: requiredScriptCommand("build", "production build"),
        })
        run = build.run
        const deployment = await this.#runner(
          step,
          build.result,
          run,
          "production",
          {
            name: "production",
            command: requiredScriptCommand(
              "sylph:deploy",
              "production deployment"
            ),
            cloudflareCredentials: {
              accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
            },
            env: {
              SYLPH_CHECKPOINT: input.sha,
              SYLPH_DEPLOYMENT: "production",
            },
          }
        )
        run = deployment.run
        const url = productionUrl(
          `${deployment.logs.stdout}\n${deployment.logs.stderr}`
        )
        if (!url) {
          throw new Error(
            "The sylph:deploy script must print SYLPH_PRODUCTION_URL=https://..."
          )
        }
        if (!input.deploymentId) {
          throw new Error("Production CI requires a Deployment record")
        }
        await step.do("record-deployment-succeeded", async () => {
          await this.env.DB.prepare(deploymentSucceededSql)
            .bind(url, input.deploymentId)
            .run()
        })
      } else {
        let parent: CiRunnerResult = install.result
        for (const name of ["typecheck", "lint", "test"] as const) {
          const stage = await this.#runner(step, parent, run, name, {
            name,
            command: requiredScriptCommand(name, `${name} verification`),
          })
          run = stage.run
          parent = stage.result
        }
        const build = await this.#runner(step, parent, run, "build", {
          name: "build",
          command: requiredScriptCommand("build", "build verification"),
        })
        run = build.run

        const preview = await this.#runner(step, build.result, run, "preview", {
          name: "preview",
          command: requiredScriptCommand("sylph:preview", "Checkpoint preview"),
          cloudflareCredentials: {
            accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
          },
          env: {
            SYLPH_CHECKPOINT: input.sha,
            SYLPH_DEPLOYMENT: "preview",
          },
        })
        run = preview.run
        const url = previewUrl(`${preview.logs.stdout}\n${preview.logs.stderr}`)
        if (!url) {
          throw new Error(
            "The sylph:preview script must print SYLPH_PREVIEW_URL=https://..."
          )
        }
        run = await this.#publish(step, "preview-url", run, {
          previewUrl: url,
        })
        run = await this.#browserEvidence(step, run, url)
      }

      run = await this.#publish(step, "run-passed", run, {
        status: "passed",
        repairStatus: "disabled",
      })
      const retainedPreviewUrl = run.previewUrl
      if (input.kind !== "production" && retainedPreviewUrl) {
        await step.sleep(
          "retain-preview",
          previewRetention(this.env.PREVIEW_RETENTION_SECONDS)
        )
        await step.do(
          "delete-expired-preview",
          { retries: { limit: 5, delay: "1 minute", backoff: "exponential" } },
          () =>
            removePreviewWorker({
              accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
              token: this.env.CF_TOKEN,
              previewUrl: retainedPreviewUrl,
            })
        )
        await this.#publish(step, "preview-expired", run, {
          previewUrl: null,
        })
      }
    } catch (cause) {
      const diagnostics = isCiRunnerFailure(cause)
        ? cause.diagnostics.failures.map(
            (failure) =>
              new WorkspaceCheckDiagnostic({
                stage: this.#stageName(failure.runner.name),
                summary: `${failure.runner.name} failed`,
                output: safeDiagnosticOutput(failure.output),
              })
          )
        : [
            new WorkspaceCheckDiagnostic({
              stage:
                input.kind === "production"
                  ? "production"
                  : run.previewUrl
                    ? "browser"
                    : "preview",
              summary: cause instanceof Error ? cause.message : "Check failed",
              output: safeDiagnosticOutput(
                cause instanceof Error
                  ? (cause.stack ?? cause.message)
                  : String(cause)
              ),
            }),
          ]
      const failedNames = new Set(
        diagnostics.map((diagnostic) => diagnostic.stage)
      )
      const failedRun = new WorkspaceCheckRun({
        ...run,
        status: "failed",
        repairStatus: input.repairOnFailure ? "requested" : "available",
        diagnostics,
        stages: run.stages.map((stage) =>
          failedNames.has(stage.name)
            ? checkStage(stage.name, "failed", "Failed", stage.durationMs)
            : stage
        ),
        updatedAt: run.updatedAt,
      })
      await this.#publish(step, "run-failed", failedRun)
      if (input.deploymentId) {
        const failureDetails = diagnostics
          .map((diagnostic) => `${diagnostic.summary}\n${diagnostic.output}`)
          .join("\n\n")
          .slice(-20_000)
        await step.do("record-deployment-failed", async () => {
          await this.env.DB.prepare(deploymentFailedSql)
            .bind(failureDetails, input.deploymentId)
            .run()
        })
      }
    }
  }

  #projectId = ""
  #agentSessionId: string | null = null
  #workflowInstanceId = ""

  #initialRun(input: WorkspaceCiInput) {
    return newCheckRun({
      id: input.checkRunId,
      workspaceId: input.workspaceId,
      checkpointId: input.checkpointId,
      commit: input.sha,
      kind: input.kind,
      attempt: input.attempt,
      repairOnFailure: input.repairOnFailure,
      createdAt: input.createdAt,
    })
  }

  async #runner(
    step: WorkflowStep,
    parent: CiContext | CiRunnerResult,
    run: WorkspaceCheckRun,
    stage: WorkspaceCheckStageName,
    options: Parameters<CiContext["runner"]>[0]
  ) {
    const startedAt = await step.do(`${stage}-started-at`, async () =>
      Date.now()
    )
    const running = await this.#publish(step, `${stage}-running`, run, {
      stages: run.stages.map((item) =>
        item.name === stage ? checkStage(stage, "running", "Running") : item
      ),
    })
    const result = await parent.runner(options)
    const logs = await logsText(result.logs)
    const completedAt = await step.do(`${stage}-completed-at`, async () =>
      Date.now()
    )
    const completed = await this.#publish(step, `${stage}-complete`, running, {
      stages: running.stages.map((item) =>
        item.name === stage
          ? checkStage(stage, "passed", "Passed", completedAt - startedAt)
          : item
      ),
    })
    return { result, run: completed, stage, logs }
  }

  async #browserEvidence(
    step: WorkflowStep,
    run: WorkspaceCheckRun,
    url: string
  ) {
    const running = await this.#publish(step, "browser-running", run, {
      stages: run.stages.map((stage) =>
        stage.name === "browser"
          ? checkStage("browser", "running", "Cloudflare Browser Run")
          : stage
      ),
    })
    const evidence = await step.do("capture-browser-evidence", async () => {
      const response = await this.env.BROWSER.quickAction("snapshot", {
        url,
        formats: ["content", "screenshot", "accessibilityTree"],
        viewport: { width: 1440, height: 900 },
        gotoOptions: { waitUntil: "networkidle2", timeout: 60_000 },
        screenshotOptions: { type: "png", fullPage: true },
        cacheTTL: 0,
      })
      if (!response.ok) throw new Error(await response.text())
      const snapshot = await response.json<BrowserRunSnapshotSuccessResponse>()
      const screenshot = snapshot.result.screenshot
      if (!screenshot) throw new Error("Browser Run returned no screenshot")
      const accessibility = JSON.stringify(
        snapshot.result.accessibilityTree ?? null
      )
      const content = snapshot.result.content ?? ""
      const expectedCheckpoint = `SYLPH_CHECKPOINT=${run.commit}`
      const expectedDeployment = "SYLPH_DEPLOYMENT=preview"
      if (
        !content.includes(expectedCheckpoint) ||
        !content.includes(expectedDeployment)
      ) {
        throw new Error(
          `Browser Run did not render ${expectedCheckpoint} and ${expectedDeployment}`
        )
      }
      const createdAt = Date.now()
      const screenshotId = `${run.id}-screenshot-${run.attempt}`
      const accessibilityId = `${run.id}-accessibility-${run.attempt}`
      await Promise.all([
        this.env.CHECK_EVIDENCE.put(
          `${run.workspaceId}/${screenshotId}`,
          bytesFromBase64(screenshot),
          { httpMetadata: { contentType: "image/png" } }
        ),
        this.env.CHECK_EVIDENCE.put(
          `${run.workspaceId}/${accessibilityId}`,
          accessibility,
          { httpMetadata: { contentType: "application/json" } }
        ),
      ])
      return [
        {
          id: screenshotId,
          kind: "screenshot" as const,
          label: "Desktop screenshot",
          url: `/api/workspaces/${encodeURIComponent(run.workspaceId)}/evidence/${encodeURIComponent(screenshotId)}`,
          createdAt,
        },
        {
          id: accessibilityId,
          kind: "accessibility" as const,
          label: "Accessibility snapshot",
          url: `/api/workspaces/${encodeURIComponent(run.workspaceId)}/evidence/${encodeURIComponent(accessibilityId)}`,
          createdAt,
        },
      ]
    })
    return this.#publish(step, "browser-complete", running, {
      evidence: evidence.map((item) => new WorkspaceCheckEvidence(item)),
      stages: running.stages.map((stage) =>
        stage.name === "browser"
          ? checkStage("browser", "passed", "Evidence captured")
          : stage
      ),
    })
  }

  async #publish(
    step: WorkflowStep,
    label: string,
    run: WorkspaceCheckRun,
    changes: Partial<WorkspaceCheckRun> = {}
  ) {
    const payload = await step.do(`publish-${label}`, async () => {
      const updated = new WorkspaceCheckRun({
        ...run,
        ...changes,
        updatedAt: Date.now(),
      })
      await this.env.DB.prepare(ciRunUpsertSql)
        .bind(
          ...ciRunUpsertBindings({
            run: updated,
            projectId: this.#projectId,
            agentSessionId: this.#agentSessionId,
            workflowInstanceId: this.#workflowInstanceId,
          })
        )
        .run()
      if (updated.kind === "production") return JSON.stringify(updated)
      const workspace = this.env.WORKSPACES.get(
        this.env.WORKSPACES.idFromName(updated.workspaceId)
      )
      await workspace.applyCheckUpdate(
        encodeWorkspaceCheckUpdateSync(
          new WorkspaceCheckUpdate({
            callbackId: `${updated.id}:${updated.attempt}:${label}`,
            run: updated,
          })
        )
      )
      return JSON.stringify(updated)
    })
    return decodeWorkspaceCheckRun(JSON.parse(payload))
  }

  #stageName(value: string): WorkspaceCheckStageName {
    return isStageName(value) ? value : "build"
  }
}
