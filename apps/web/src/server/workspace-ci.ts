import {
  createDeploymentCapability,
  revokeDeploymentCapability,
} from "./deployment-broker-store"
import { deploymentBrokerPreload } from "./deployment-broker-transport"
import { captureDeploymentIdentity } from "./cloudflare-health"
import {
  projectSecretEnvironment,
  readProjectDomain,
} from "./project-configuration"
import {
  decodeRecoveryPoint,
  readMigrationReview,
  readDataRestore,
  readRecoveryPoint,
  validateRecoveryInventory,
  readProductionJourney,
  recoveryTargetCommit,
  releasePreflightCommand,
} from "./release-safety"
import {
  releaseContextSql,
  releaseMutationStartedSql,
} from "./release-reservation"
import { ciCommand, requiredScriptCommand } from "./command-execution"
import { readWorkspaceCiLogs } from "./workspace-ci-logs"
import { projectAuthSecret } from "./project-auth-secret"
import {
  projectRecoveryKey,
  projectRecoveryVerifyToken,
} from "./project-recovery-key"
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
import { previewRetention } from "./preview-lifecycle"
import {
  ProjectSecretValues,
  type ProjectResourcePlan,
} from "@workspace/domain/project-resources"
import {
  captureProjectResources,
  finishResourceOperation,
  readResourcePlan,
  removePreviewResources,
  reserveProjectResources,
  resourcePrefix,
  verifyResourceUrl,
} from "./project-resources"
import {
  deploymentFailedSql,
  deploymentRunningSql,
  deploymentSucceededSql,
  deploymentWithoutHooksSucceededSql,
  productionUrl,
} from "./deployment-records"
import { ciRunUpsertBindings, ciRunUpsertSql } from "./ci-run-records"
import { browserEvidenceSelector } from "./workspace-ci-browser"
import { dependencyInstallCommand } from "./workspace-ci-dependencies"
import {
  verificationCommand,
  verificationDurations,
  verificationFailureStages,
  verificationConcurrency,
  verificationStageNames,
  failedCheckStages,
} from "./workspace-ci-verification"
import {
  projectDeployEnvironment,
  readProjectSlug,
} from "./project-deploy-environment"

const decodeWorkspaceCheckRun = Schema.decodeUnknownSync(WorkspaceCheckRun)
const decodeWorkspaceCiInput = Schema.decodeUnknownSync(WorkspaceCiInput)
const encodeWorkspaceCheckUpdateSync = Schema.encodeSync(WorkspaceCheckUpdate)

type WorkspaceCiBindings = CiBindings & {
  SYLPH_URL: string
  RESOURCE_TOKEN: string
  CREDENTIAL_ENCRYPTION_KEY: string
  CI_VERIFICATION_CONCURRENCY: string
  BROWSER: BrowserRun
  CHECK_EVIDENCE: R2Bucket
  DB: D1Database
  PREVIEW_RETENTION_SECONDS: string
  WORKSPACES: DurableObjectNamespace<WorkspaceDO>
}

const isStageName = Schema.is(WorkspaceCheckStageName)

const verificationRunnerConfig = {
  retries: { limit: 0, delay: 1_000 },
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
    const managedRelease =
      input.kind === "production" && input.managedRelease !== false
    const captureEvidence = input.captureEvidence ?? input.kind === "production"
    let run = this.#initialRun({ ...input, managedRelease, captureEvidence })
    this.#projectId = input.projectId
    this.#agentSessionId = input.agentSessionId ?? null
    this.#workflowInstanceId = event.instanceId
    run = await this.#publish(step, "run-started", run, {
      status: "running",
    })
    if (input.deploymentId) {
      await step.do("record-deployment-running", async () => {
        const result = await this.env.DB.prepare(deploymentRunningSql)
          .bind(input.deploymentId)
          .run()
        if (result.meta.changes !== 1)
          throw new Error("This Deployment is no longer active")
      })
    }

    const credentials = {
      accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
      token: this.env.RESOURCE_TOKEN,
    }
    const owner = {
      projectId: input.projectId,
      scope:
        input.kind === "production"
          ? "production"
          : `preview:${run.id}:${run.attempt}`,
      runId: event.instanceId,
    }
    let resourcesReserved = false
    let resourcePlan: ProjectResourcePlan = []
    try {
      if (input.kind === "dependencies") {
        throw new Error(
          "Dependency repair jobs are retired. Run bun install with the native shell tool, then run workspace_run_checks."
        )
      }
      const projectSlug = await step.do("read-project-slug", () =>
        readProjectSlug(this.env.DB, input.projectId)
      )

      if (input.kind === "production") {
        if (!input.deploymentId)
          throw new Error("Production CI requires a Deployment record")
        const deploymentId = input.deploymentId
        const context = await step.do("read-release-reservation", async () => {
          const row = await this.env.DB.prepare(releaseContextSql)
            .bind(deploymentId, input.projectId)
            .first<{
              commit: string
              base_commit: string | null
              base_url: string | null
              managed_release: number
              capture_evidence: number
              recovery_deployment_id: string | null
              recovery_json: string | null
            }>()
          if (!row || row.commit !== input.sha)
            throw new Error(
              "The production reservation does not match this CI commit"
            )
          if (
            Boolean(row.managed_release) !== managedRelease ||
            Boolean(row.capture_evidence) !== captureEvidence
          )
            throw new Error(
              "Release options do not match the confirmed Deployment"
            )
          if (row.recovery_deployment_id) {
            if (!row.recovery_json)
              throw new Error("The requested recovery point is missing")
            const point = decodeRecoveryPoint(row.recovery_json, Date.now())
            if (
              point.projectId !== input.projectId ||
              point.deploymentId !== row.recovery_deployment_id ||
              recoveryTargetCommit(point) !== input.sha
            )
              throw new Error(
                "The recovery point does not match this production operation"
              )
          }
          return row
        })
        const identity = {
          deploymentId,
          projectId: input.projectId,
          commit: input.sha,
          baseCommit: context.base_commit,
        }
        const releaseIdentityEnv = {
          ...projectDeployEnvironment({
            slug: projectSlug,
            checkpoint: input.sha,
            deployment: "production",
          }),
          SYLPH_RELEASE_ID: deploymentId,
          SYLPH_PROJECT_ID: input.projectId,
          SYLPH_BASE_COMMIT: context.base_commit ?? "",
          SYLPH_BASE_URL: context.base_url ?? "",
          SYLPH_RECOVERY_POINT: context.recovery_json ?? "",
        }
        const authSecret = await projectAuthSecret(
          this.env.DB,
          input.projectId,
          this.env.CREDENTIAL_ENCRYPTION_KEY
        )
        const recoveryKey = await projectRecoveryKey(
          input.projectId,
          this.env.CREDENTIAL_ENCRYPTION_KEY
        )
        const projectSecretEnv = await projectSecretEnvironment(
          this.env.DB,
          input.projectId,
          "production",
          this.env.CREDENTIAL_ENCRYPTION_KEY
        )
        const releaseSecrets = {
          ...Schema.decodeUnknownSync(ProjectSecretValues)(
            JSON.parse(projectSecretEnv.SYLPH_PROJECT_SECRETS ?? "{}")
          ),
          BETTER_AUTH_SECRET: authSecret,
        }
        const recoverySecretEnv = { SYLPH_RECOVERY_KEY: recoveryKey }
        const verifyToken = await projectRecoveryVerifyToken(
          input.projectId,
          this.env.CREDENTIAL_ENCRYPTION_KEY
        )
        const build = await this.#verification(step, ci, run, [
          "install",
          "build",
        ])
        run = build.run
        const planned = await this.#planResources(
          step,
          build.result,
          input,
          owner,
          projectSlug
        )
        resourcePlan = planned.plan
        resourcesReserved = true
        const releaseEnv = {
          ...releaseIdentityEnv,
          SYLPH_RECOVERY_VERIFY_TOKEN: verifyToken,
          ...planned.domainEnvironment,
          SYLPH_RESOURCE_PREFIX: planned.prefix,
          SYLPH_RESOURCE_PLAN: JSON.stringify(resourcePlan),
        }
        let releaseParent = planned.result
        if (managedRelease || context.recovery_deployment_id) {
          const review = await this.#runner(
            step,
            planned.result,
            run,
            "release-review",
            {
              name: "release-review",
              config: verificationRunnerConfig,
              command: `${releasePreflightCommand} && ${requiredScriptCommand("sylph:release:review", "migration compatibility review")}`,
              env: releaseEnv,
              cloudflareCredentials: {
                accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
              },
            }
          )
          run = review.run
          const reviewed = readMigrationReview(review.logs.stdout, identity)
          await step.do("save-migration-review", async () => {
            const result = await this.env.DB.prepare(
              "UPDATE deployment SET review_json = ? WHERE id = ? AND status = 'running'"
            )
              .bind(JSON.stringify(reviewed), deploymentId)
              .run()
            if (result.meta.changes !== 1)
              throw new Error("The release reservation was lost")
          })
          await step.do("record-release-mutation-started", async () => {
            const result = await this.env.DB.prepare(releaseMutationStartedSql)
              .bind(deploymentId, input.projectId)
              .run()
            if (result.meta.changes !== 1)
              throw new Error("The release reservation was lost")
          })
          const prepared = await this.#runner(
            step,
            review.result,
            run,
            "release-prepare",
            {
              name: "release-prepare",
              config: verificationRunnerConfig,
              command: requiredScriptCommand(
                "sylph:release:prepare",
                "coordinated data recovery capture"
              ),
              env: {
                ...releaseEnv,
                ...recoverySecretEnv,
                SYLPH_RECOVERY_SECRETS: JSON.stringify(releaseSecrets),
              },
              cloudflareCredentials: {
                accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
              },
            }
          )
          run = prepared.run
          const savedRecovery = await step.do(
            "save-data-recovery-point",
            async () => {
              const point = readRecoveryPoint(
                prepared.logs.stdout,
                identity,
                Date.now()
              )
              const inventory = await captureProjectResources(
                this.env.DB,
                credentials,
                owner,
                false
              )
              validateRecoveryInventory(point, inventory)
              const result = await this.env.DB.prepare(
                "UPDATE deployment SET recovery_json = ? WHERE id = ? AND status = 'running'"
              )
                .bind(JSON.stringify(point), deploymentId)
                .run()
              if (result.meta.changes !== 1)
                throw new Error("The release reservation was lost")
              return JSON.stringify(point)
            }
          )
          releaseParent = prepared.result
          if (context.recovery_json) {
            const restoredPoint = decodeRecoveryPoint(
              context.recovery_json,
              Date.now()
            )
            const restored = await this.#runner(
              step,
              releaseParent,
              run,
              "data-restore",
              {
                name: "data-restore",
                config: verificationRunnerConfig,
                command: requiredScriptCommand(
                  "sylph:release:restore",
                  "Admin-confirmed data recovery"
                ),
                env: { ...releaseEnv, ...recoverySecretEnv },
                cloudflareCredentials: {
                  accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
                },
              }
            )
            run = restored.run
            const restoreReceipt = readDataRestore(
              restored.logs.stdout,
              identity,
              restoredPoint
            )
            await step.do("save-data-restore", async () => {
              const result = await this.env.DB.prepare(
                "UPDATE deployment SET restore_json = ? WHERE id = ? AND status = 'running'"
              )
                .bind(JSON.stringify(restoreReceipt), deploymentId)
                .run()
              if (result.meta.changes !== 1)
                throw new Error("The release reservation was lost")
            })
            releaseParent = restored.result
          } else {
            run = await this.#publish(step, "data-restore-skipped", run, {
              stages: run.stages.map((stage) =>
                stage.name === "data-restore"
                  ? checkStage(
                      "data-restore",
                      "skipped",
                      "No data restore requested"
                    )
                  : stage
              ),
            })
          }
          decodeRecoveryPoint(savedRecovery, Date.now())
        }
        const deployment = await this.#runner(
          step,
          releaseParent,
          run,
          "production",
          {
            name: "production",
            config: verificationRunnerConfig,
            command: requiredScriptCommand(
              "sylph:deploy",
              "production deployment"
            ),
            cloudflareCredentials: {
              accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
            },
            env: {
              ...releaseEnv,
              ...projectSecretEnv,
              BETTER_AUTH_SECRET: authSecret,
              ...recoverySecretEnv,
              SYLPH_RECOVERY_SECRETS: JSON.stringify(releaseSecrets),
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
        verifyResourceUrl(url, resourcePlan)
        await step.do("inspect-production-resources", () =>
          captureProjectResources(this.env.DB, credentials, owner, true)
        )
        await step.do("capture-production-identity", () =>
          captureDeploymentIdentity(
            this.env.DB,
            credentials,
            input.projectId,
            deploymentId
          ).then(
            () => ({ captured: true }),
            () => ({ captured: false })
          )
        )
        await step.do("save-published-production-url", async () => {
          await this.env.DB.prepare(
            "UPDATE deployment SET production_url = ? WHERE id = ? AND status = 'running'"
          )
            .bind(url, deploymentId)
            .run()
        })
        if (managedRelease || context.recovery_deployment_id) {
          const verified = await this.#runner(
            step,
            deployment.result,
            run,
            "production-journey",
            {
              name: "production-journey",
              config: verificationRunnerConfig,
              command: requiredScriptCommand(
                "sylph:release:verify",
                "production application journey"
              ),
              env: { ...releaseEnv, SYLPH_PRODUCTION_URL: url },
            }
          )
          run = verified.run
          const journey = readProductionJourney(
            verified.logs.stdout,
            identity,
            url
          )
          await step.do("save-production-journey", async () => {
            const result = await this.env.DB.prepare(
              "UPDATE deployment SET verification_json = ? WHERE id = ? AND status = 'running'"
            )
              .bind(JSON.stringify(journey), deploymentId)
              .run()
            if (result.meta.changes !== 1)
              throw new Error("The release reservation was lost")
          })
          const resumed = await this.#runner(
            step,
            verified.result,
            run,
            "release-resume",
            {
              name: "release-resume",
              config: verificationRunnerConfig,
              command: requiredScriptCommand(
                "sylph:release:resume",
                "resume application writes after verification"
              ),
              env: { ...releaseEnv, SYLPH_PRODUCTION_URL: url },
              cloudflareCredentials: {
                accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
              },
            }
          )
          run = resumed.run
          if (captureEvidence) run = await this.#browserEvidence(step, run, url)
          const live = await this.#runner(
            step,
            resumed.result,
            run,
            "production-journey-live",
            {
              name: "production-journey-live",
              config: verificationRunnerConfig,
              command: requiredScriptCommand(
                "sylph:release:verify",
                "production journey after writes resume"
              ),
              env: { ...releaseEnv, SYLPH_PRODUCTION_URL: url },
            }
          )
          run = live.run
          const liveJourney = readProductionJourney(
            live.logs.stdout,
            identity,
            url
          )
          await step.do("save-live-production-journey", async () => {
            const result = await this.env.DB.prepare(
              "UPDATE deployment SET verification_json = ? WHERE id = ? AND status = 'running'"
            )
              .bind(JSON.stringify(liveJourney), deploymentId)
              .run()
            if (result.meta.changes !== 1)
              throw new Error("The release reservation was lost")
          })
        }
        if (
          captureEvidence &&
          !managedRelease &&
          !context.recovery_deployment_id
        )
          run = await this.#browserEvidence(step, run, url)
        await step.do("record-deployment-succeeded", async () => {
          const result = await this.env.DB.prepare(
            managedRelease || context.recovery_deployment_id
              ? deploymentSucceededSql
              : deploymentWithoutHooksSucceededSql
          )
            .bind(url, deploymentId)
            .run()
          if (result.meta.changes !== 1)
            throw new Error(
              "The Deployment could not be completed with the requested release options"
            )
        })
      } else {
        const verification = await this.#verification(
          step,
          ci,
          run,
          input.kind === "preview"
            ? ["install", "build"]
            : verificationStageNames
        )
        run = verification.run

        if (input.kind === "preview") {
          const planned = await this.#planResources(
            step,
            verification.result,
            input,
            owner,
            projectSlug
          )
          resourcePlan = planned.plan
          resourcesReserved = true
          const preview = await this.#runner(
            step,
            planned.result,
            run,
            "preview",
            {
              name: "preview",
              config: verificationRunnerConfig,
              command: requiredScriptCommand(
                "sylph:preview",
                "Checkpoint preview"
              ),
              cloudflareCredentials: {
                accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
              },
              env: {
                ...projectDeployEnvironment({
                  slug: projectSlug,
                  checkpoint: input.sha,
                  deployment: "preview",
                }),
                ...(await projectSecretEnvironment(
                  this.env.DB,
                  input.projectId,
                  "preview",
                  this.env.CREDENTIAL_ENCRYPTION_KEY
                )),
                SYLPH_RESOURCE_PREFIX: planned.prefix,
                SYLPH_RESOURCE_PLAN: JSON.stringify(resourcePlan),
              },
            }
          )
          run = preview.run
          const url = previewUrl(
            `${preview.logs.stdout}\n${preview.logs.stderr}`
          )
          if (!url) {
            throw new Error(
              "The sylph:preview script must print SYLPH_PREVIEW_URL=https://..."
            )
          }
          verifyResourceUrl(url, resourcePlan)
          await step.do("inspect-preview-resources", () =>
            captureProjectResources(this.env.DB, credentials, owner, true)
          )
          run = await this.#publish(step, "preview-url", run, {
            previewUrl: url,
          })
          if (captureEvidence) run = await this.#browserEvidence(step, run, url)
        }
      }
      run = await this.#publish(step, "run-passed", run, {
        status: "passed",
      })
    } catch (cause) {
      const diagnostics = isCiRunnerFailure(cause)
        ? cause.diagnostics.failures.flatMap((failure) => {
            const failedStages = verificationFailureStages(failure.output)
            const stages = failedStages.length
              ? failedStages
              : [this.#stageName(failure.runner.name)]
            return stages.map(
              (stage) =>
                new WorkspaceCheckDiagnostic({
                  stage,
                  summary: `${stage} failed`,
                  output: safeDiagnosticOutput(failure.output),
                })
            )
          })
        : [
            new WorkspaceCheckDiagnostic({
              stage:
                input.kind === "dependencies"
                  ? "install"
                  : input.kind === "production"
                    ? this.#releaseStage
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
        diagnostics,
        stages: failedCheckStages(
          run.stages,
          isCiRunnerFailure(cause)
            ? cause.diagnostics.failures
                .map((failure) => failure.output)
                .join("\n")
            : "",
          failedNames
        ),
        updatedAt: run.updatedAt,
      })
      run = await this.#publish(step, "run-failed", failedRun)
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
    if (resourcesReserved) {
      await step.do("finish-resource-deployment", () =>
        finishResourceOperation(
          this.env.DB,
          credentials,
          owner,
          input.kind === "production" ? "complete" : "retained"
        )
      )
      if (input.kind !== "production") {
        await step.sleep(
          "retain-preview",
          previewRetention(this.env.PREVIEW_RETENTION_SECONDS)
        )
        await step.do(
          "delete-expired-preview",
          {
            retries: { limit: 5, delay: "1 minute", backoff: "exponential" },
          },
          () => removePreviewResources(this.env.DB, credentials, owner)
        )
        await this.#publish(step, "preview-expired", run, { previewUrl: null })
      }
    }
  }

  async #planResources(
    step: WorkflowStep,
    parent: CiRunnerResult,
    input: WorkspaceCiInput,
    owner: { projectId: string; scope: string; runId: string },
    slug: string
  ) {
    const prefix = await resourcePrefix(owner.projectId, owner.scope)
    const domain =
      input.kind === "production"
        ? await step.do("read-project-domain", () =>
            readProjectDomain(this.env.DB, owner.projectId)
          )
        : null
    const domainEnvironment = {
      SYLPH_CUSTOM_DOMAIN: domain?.hostname ?? "",
      SYLPH_CUSTOM_DOMAIN_ZONE: domain?.zone_id ?? "",
    }
    const result = await parent.runner({
      name: "resource-plan",
      config: verificationRunnerConfig,
      command: ciCommand(
        requiredScriptCommand("sylph:plan", "resource ownership checks"),
        false,
        true
      ),
      env: {
        ...projectDeployEnvironment({
          slug,
          checkpoint: input.sha,
          deployment: input.kind === "production" ? "production" : "preview",
        }),
        ...domainEnvironment,
        SYLPH_RESOURCE_PREFIX: prefix,
      },
    })
    const logs = await readWorkspaceCiLogs(result.logs)
    const plan = readResourcePlan(logs.stdout, prefix, domain?.hostname)
    await step.do("reserve-project-resources", () =>
      reserveProjectResources(
        this.env.DB,
        {
          accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
          token: this.env.RESOURCE_TOKEN,
        },
        owner,
        plan
      )
    )
    return { result, plan, prefix, domainEnvironment }
  }

  #releaseStage: WorkspaceCheckStageName = "production"
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
      createdAt: input.createdAt,
      autoRepair: input.autoRepair,
      captureEvidence: input.captureEvidence,
      managedRelease: input.managedRelease,
    })
  }

  async #runner(
    step: WorkflowStep,
    parent: CiContext | CiRunnerResult,
    run: WorkspaceCheckRun,
    stage: WorkspaceCheckStageName,
    options: Parameters<CiContext["runner"]>[0]
  ) {
    this.#releaseStage = stage
    const label = options.name
    const startedAt = await step.do(`${label}-started-at`, async () =>
      Date.now()
    )
    const running = await this.#publish(step, `${label}-running`, run, {
      stages: run.stages.map((item) =>
        item.name === stage ? checkStage(stage, "running", "Running") : item
      ),
    })
    const capability = options.cloudflareCredentials
      ? await createDeploymentCapability(
          this.env.DB,
          this.env.CLOUDFLARE_ACCOUNT_ID,
          {
            projectId: this.#projectId,
            scope:
              run.kind === "production"
                ? "production"
                : `preview:${run.id}:${run.attempt}`,
            runId: this.#workflowInstanceId,
          }
        )
      : null
    let result: CiRunnerResult
    try {
      const brokerRoot = `${this.env.SYLPH_URL.replace(/\/$/, "")}/api/project-deployment`
      const preloadPath = "/tmp/sylph-deployment-broker.mjs"
      const preload = capability
        ? `NODE_OPTIONS= node -e 'require("node:fs").writeFileSync("${preloadPath}", Buffer.from("${btoa(deploymentBrokerPreload)}", "base64"))' && `
        : ""
      const runnerEnvironment = { ...options.env }
      for (const name of [
        "CLOUDFLARE_API_TOKEN",
        "CF_TOKEN",
        "RESOURCE_TOKEN",
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_EMAIL",
        "ALCHEMY_PASSWORD",
      ])
        delete runnerEnvironment[name]
      if (capability)
        Object.assign(runnerEnvironment, {
          CLOUDFLARE_API_TOKEN: capability.token,
          CLOUDFLARE_ACCOUNT_ID: this.env.CLOUDFLARE_ACCOUNT_ID,
          SYLPH_CLOUDFLARE_API_BASE_URL: brokerRoot,
          SYLPH_ALCHEMY_STATE_URL: brokerRoot,
          NODE_OPTIONS: `--import=${preloadPath}`,
        })
      result = await parent.runner({
        ...options,
        cloudflareCredentials: false,
        sourceControlCredentials: false,
        secrets: [],
        env: runnerEnvironment,
        command:
          preload +
          ciCommand(
            options.command,
            stage === "preview" || run.kind === "production"
          ),
      })
    } finally {
      if (capability)
        await revokeDeploymentCapability(this.env.DB, capability.id)
    }
    const logs = await readWorkspaceCiLogs(result.logs)
    const completedAt = await step.do(`${label}-completed-at`, async () =>
      Date.now()
    )
    const completed = await this.#publish(step, `${label}-complete`, running, {
      stages: running.stages.map((item) =>
        item.name === stage
          ? checkStage(stage, "passed", "Passed", completedAt - startedAt)
          : item
      ),
    })
    return { result, run: completed, stage, logs }
  }

  async #verification(
    step: WorkflowStep,
    parent: CiContext | CiRunnerResult,
    run: WorkspaceCheckRun,
    names: ReadonlyArray<
      (typeof verificationStageNames)[number]
    > = verificationStageNames
  ) {
    const startedAt = await step.do("verification-started-at", async () =>
      Date.now()
    )
    const running = await this.#publish(step, "verification-running", run, {
      stages: run.stages.map((stage) =>
        names.some((name) => name === stage.name)
          ? checkStage(
              stage.name,
              "running",
              "Install and verification share one sandbox"
            )
          : stage
      ),
    })
    const result = await parent.runner({
      name: "verification",
      config: verificationRunnerConfig,
      command: verificationCommand(
        names.map((name) => ({
          name,
          command:
            name === "install"
              ? dependencyInstallCommand
              : requiredScriptCommand(name, `${name} verification`),
        })),
        verificationConcurrency(this.env.CI_VERIFICATION_CONCURRENCY)
      ),
    })
    const logs = await readWorkspaceCiLogs(result.logs)
    const completedAt = await step.do("verification-completed-at", async () =>
      Date.now()
    )
    const durations = verificationDurations(`${logs.stdout}\n${logs.stderr}`)
    const verificationDetail = `Passed; shared runner ${((completedAt - startedAt) / 1000).toFixed(1)}s including setup and snapshot`
    const completed = await this.#publish(
      step,
      "verification-complete",
      running,
      {
        stages: running.stages.map((stage) => {
          const name = names.find((name) => name === stage.name)
          return name
            ? checkStage(
                name,
                "passed",
                verificationDetail,
                durations.get(name) ?? null
              )
            : stage
        }),
      }
    )
    return { result, run: completed, logs }
  }

  async #browserEvidence(
    step: WorkflowStep,
    run: WorkspaceCheckRun,
    url: string
  ) {
    this.#releaseStage = "browser"
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
        formats: ["markdown", "screenshot", "accessibilityTree"],
        viewport: { width: 1440, height: 900 },
        gotoOptions: { waitUntil: "networkidle2", timeout: 60_000 },
        waitForSelector: {
          selector: browserEvidenceSelector(
            run.commit,
            run.kind === "production" ? "production" : "preview"
          ),
          visible: true,
          timeout: 120_000,
        },
        actionTimeout: 120_000,
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
      if (label === "preview-expired")
        await workspace.expireCheckPreview({
          runId: updated.id,
          attempt: updated.attempt,
          callbackId: `${updated.id}:${updated.attempt}:${label}`,
        })
      else
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
