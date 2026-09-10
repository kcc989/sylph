import type { CursorRuntimeContainer } from "./apps/web/src/server/cursor-runtime-container"
import type { ProjectResourceMaintenance } from "@workspace/domain/project-resources"
import { normalizeDomain } from "./tools/deployment/config"
import {
  deploymentCredentials,
  installationSecret,
} from "./tools/deployment/resources"
import type { CodexContainer } from "./apps/web/src/server/codex-container"
import type { ProjectSynchronization } from "./apps/web/src/server/project-synchronization"
import type { CursorConnectionObject } from "./apps/web/src/server/cursor-connection-object"
import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import type { WorkspaceDO } from "./apps/web/src/server/workspace-do"
import type {
  WorkspaceProvisioningInput,
  WorkspaceCiInput,
  WorkspaceMessageDeliveryInput,
} from "@workspace/domain"
import type { WorkspaceMergeInput } from "./apps/web/src/server/workspace-merge"
import type { WorkspaceRetentionInput } from "./apps/web/src/server/workspace-retention"
import type { CiSandbox } from "@cloudflare/ci/worker"
import type { Sandbox } from "@cloudflare/sandbox"
import { Build } from "alchemy/Command"
import * as Output from "alchemy/Output"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"

const Database = Cloudflare.D1.Database("Database", {
  migrations: "packages/db/migrations",
})
const Repositories = Cloudflare.Artifacts.Namespace("Repositories")
const smokeBucketOptions = Effect.gen(function* () {
  const stage = yield* Alchemy.Stage
  return { forceDestroy: /^smoke-[a-z0-9-]{1,45}$/.test(stage) }
})
const CheckBackups = Cloudflare.R2.Bucket("CheckBackups", smokeBucketOptions)
const CheckEvidence = Cloudflare.R2.Bucket("CheckEvidence", smokeBucketOptions)

export class Website extends Cloudflare.Worker<Website>()(
  "Website",
  Effect.gen(function* () {
    const domain = normalizeDomain(
      yield* Config.string("SYLPH_DOMAIN").pipe(
        Config.withDefault(""),
        Effect.orDie
      )
    )
    const credentials = yield* deploymentCredentials()
    const authSecret = yield* installationSecret("BETTER_AUTH_SECRET")
    const encryptionSecret = yield* installationSecret(
      "CREDENTIAL_ENCRYPTION_KEY"
    )
    const checkBackups = yield* CheckBackups
    const database = yield* Database
    const repositories = yield* Repositories
    const checkEvidence = yield* CheckEvidence

    const development = yield* Alchemy.ALCHEMY_DEV
    const build = development
      ? undefined
      : yield* Build("RuntimeBuild", {
          command: "bun run build:runtime",
          outdir: "dist/runtime",
          memo: {
            include: [
              "apps/web/src/runtime-worker.ts",
              "apps/web/src/server/**",
              "apps/web/package.json",
              "packages/domain/**",
              "packages/db/**",
              "packages/cloudflare-recovery/**",
              "tools/wizard/github-app-manifest.ts",
              "tools/worker-build/**",
              "package.json",
              "tsconfig.json",
            ],
            lockfile: true,
          },
        })
    return {
      domain: domain || null,
      main: build
        ? Output.map(build.outdir, (directory) => `${directory}/worker.js`)
        : "apps/web/src/runtime-worker.ts",
      bundle: development,
      crons: ["15 * * * *", "* * * * *"],
      compatibility: {
        date: "2026-03-17",
        flags: ["nodejs_compat"],
      },
      env: {
        SYLPH_URL: Cloudflare.Worker.URL,
        SYLPH_SMOKE_SOURCE_COMMIT: Config.string(
          "SYLPH_SMOKE_SOURCE_COMMIT"
        ).pipe(Config.withDefault("")),
        SYLPH_SMOKE_TEMPLATE_COMMIT: Config.string(
          "SYLPH_SMOKE_TEMPLATE_COMMIT"
        ).pipe(Config.withDefault("")),
        SYLPH_SMOKE_STAGE: Config.string("SYLPH_SMOKE_STAGE").pipe(
          Config.withDefault("")
        ),
        CI_VERIFICATION_CONCURRENCY: Config.string(
          "CI_VERIFICATION_CONCURRENCY"
        ).pipe(Config.withDefault("2")),
        ARTIFACTS: repositories,
        BACKUP_BUCKET: checkBackups,
        BACKUP_BUCKET_NAME: checkBackups.bucketName,
        BROWSER: Cloudflare.Browser("BROWSER"),
        CLOUDFLARE_ACCOUNT_ID: Config.string("CLOUDFLARE_ACCOUNT_ID"),
        DB: database,
        CURSOR_RUNTIME: Cloudflare.Container<CursorRuntimeContainer>(
          "CursorRuntimeContainer",
          {
            context: ".",
            dockerfile: "packages/cursor-provider/Dockerfile",
            observability: { logs: { enabled: false } },
            className: "CursorRuntimeContainer",
            instanceType: "basic",
            maxInstances: 10,
          }
        ),
        CODEX: Cloudflare.Container<CodexContainer>("CodexContainer", {
          image: "docker.io/library/node:24-alpine",
          className: "CodexContainer",
          instanceType: "basic",
          maxInstances: 10,
        }),
        CF_TOKEN: credentials.runtimeToken,
        RESOURCE_TOKEN: credentials.resourceToken,
        PREVIEW_RETENTION_SECONDS: Config.string(
          "PREVIEW_RETENTION_SECONDS"
        ).pipe(Config.withDefault("")),
        R2_ACCESS_KEY_ID: credentials.accessKeyId,
        R2_SECRET_ACCESS_KEY: credentials.secretAccessKey,
        WORKSPACE_SANDBOX: Cloudflare.Container<Sandbox>("WorkspaceSandbox", {
          image:
            "docker.io/cloudflare/sandbox:0.12.1@sha256:ea9b35e61c800eddbc4450fad333e5dd26033a06f7d36624388b0711bef9f8c5",
          className: "WorkspaceSandbox",
          instanceType: "standard-1",
          maxInstances: 10,
        }),
        SANDBOX: Cloudflare.Container<CiSandbox>("CiSandbox", {
          context: "tools/ci-runtime",
          className: "CiSandbox",
          instanceType: "standard-4",
          maxInstances: 10,
        }),
        BETTER_AUTH_SECRET: authSecret,
        SYLPH_SMOKE_GROK_BUDGET: Config.string("SYLPH_SMOKE_GROK_BUDGET").pipe(
          Config.withDefault("false")
        ),
        CREDENTIAL_ENCRYPTION_KEY: encryptionSecret,
        INSTALLATION_CLAIM_SECRET: Config.redacted("INSTALLATION_CLAIM_SECRET"),
        ALLOW_TEST_MAGIC_LINKS: Config.string("ALLOW_TEST_MAGIC_LINKS").pipe(
          Config.withDefault("false")
        ),
        GITHUB_CLIENT_ID: Config.string("GITHUB_CLIENT_ID").pipe(
          Config.withDefault("")
        ),
        GITHUB_CLIENT_SECRET: Config.redacted("GITHUB_CLIENT_SECRET").pipe(
          Config.withDefault(Redacted.make(""))
        ),
        OAUTH_PROXY_URL: Config.string("OAUTH_PROXY_URL").pipe(
          Config.withDefault("")
        ),
        OAUTH_PROXY_SECRET: Config.redacted("OAUTH_PROXY_SECRET").pipe(
          Config.withDefault(Redacted.make(""))
        ),
        OAUTH_PROXY_TRUSTED_ORIGINS: Config.string(
          "OAUTH_PROXY_TRUSTED_ORIGINS"
        ).pipe(Config.withDefault("")),
        CURSOR: Cloudflare.DurableObject<CursorConnectionObject>("Cursor", {
          className: "CursorContainer",
        }),
        REPOS: Repositories,
        CHECK_EVIDENCE: checkEvidence,
        RESOURCE_MAINTENANCE: Cloudflare.Workflow<ProjectResourceMaintenance>(
          "ResourceMaintenance",
          {
            className: "ResourceMaintenance",
          }
        ),
        CI_WORKFLOW: Cloudflare.Workflow<WorkspaceCiInput>("CI", {
          className: "CI",
        }),
        REPOSITORY_NAMESPACE: repositories.namespace,
        PROJECT_SYNCS: Cloudflare.DurableObject<ProjectSynchronization>(
          "ProjectSynchronization",
          { className: "ProjectSynchronization" }
        ),
        MESSAGE_DELIVERY: Cloudflare.Workflow<
          typeof WorkspaceMessageDeliveryInput.Encoded
        >("WorkspaceMessageDelivery", {
          className: "WorkspaceMessageDelivery",
        }),
        PROVISIONING: Cloudflare.Workflow<
          typeof WorkspaceProvisioningInput.Encoded
        >("WorkspaceProvisioning", { className: "WorkspaceProvisioning" }),
        MERGES: Cloudflare.Workflow<WorkspaceMergeInput>("WorkspaceMerge", {
          className: "WorkspaceMerge",
        }),
        RETENTION: Cloudflare.Workflow<WorkspaceRetentionInput>(
          "WorkspaceRetention",
          { className: "WorkspaceRetention" }
        ),
        WORKSPACE_FORK_RETENTION_SECONDS: Config.string(
          "WORKSPACE_FORK_RETENTION_SECONDS"
        ).pipe(Config.withDefault("")),
        WORKSPACES: Cloudflare.DurableObject<WorkspaceDO>("Workspaces", {
          className: "WorkspaceDO",
        }),
      },
    }
  })
) {}

export class Web extends Cloudflare.Website.Vite<Web>()(
  "Web",
  Effect.gen(function* () {
    const runtime = yield* Website
    const bindings = runtime.Props.env
    return {
      rootDir: "apps/web",
      main: "src/worker.ts",
      workersDev: false,
      compatibility: { date: "2026-03-17", flags: ["nodejs_compat"] },
      env: {
        SYLPH_URL: runtime.url.as<string>(),
        SYLPH_SMOKE_SOURCE_COMMIT: bindings.SYLPH_SMOKE_SOURCE_COMMIT,
        SYLPH_SMOKE_TEMPLATE_COMMIT: bindings.SYLPH_SMOKE_TEMPLATE_COMMIT,
        SYLPH_SMOKE_STAGE: bindings.SYLPH_SMOKE_STAGE,
        DB: bindings.DB,
        REPOS: bindings.REPOS,
        CHECK_EVIDENCE: bindings.CHECK_EVIDENCE,
        CLOUDFLARE_ACCOUNT_ID: bindings.CLOUDFLARE_ACCOUNT_ID,
        CF_TOKEN: bindings.CF_TOKEN,
        RESOURCE_TOKEN: bindings.RESOURCE_TOKEN,
        BETTER_AUTH_SECRET: bindings.BETTER_AUTH_SECRET,
        CREDENTIAL_ENCRYPTION_KEY: bindings.CREDENTIAL_ENCRYPTION_KEY,
        INSTALLATION_CLAIM_SECRET: bindings.INSTALLATION_CLAIM_SECRET,
        ALLOW_TEST_MAGIC_LINKS: bindings.ALLOW_TEST_MAGIC_LINKS,
        GITHUB_CLIENT_ID: bindings.GITHUB_CLIENT_ID,
        GITHUB_CLIENT_SECRET: bindings.GITHUB_CLIENT_SECRET,
        OAUTH_PROXY_URL: bindings.OAUTH_PROXY_URL,
        OAUTH_PROXY_SECRET: bindings.OAUTH_PROXY_SECRET,
        OAUTH_PROXY_TRUSTED_ORIGINS: bindings.OAUTH_PROXY_TRUSTED_ORIGINS,
        PREVIEW_RETENTION_SECONDS: bindings.PREVIEW_RETENTION_SECONDS,
        REPOSITORY_NAMESPACE: bindings.REPOSITORY_NAMESPACE,
        WORKSPACE_FORK_RETENTION_SECONDS:
          bindings.WORKSPACE_FORK_RETENTION_SECONDS,
        WORKSPACES: Cloudflare.DurableObject<WorkspaceDO>("Workspaces", {
          className: "WorkspaceDO",
          scriptName: runtime.workerName,
        }),
        PROJECT_SYNCS: Cloudflare.DurableObject<ProjectSynchronization>(
          "ProjectSynchronization",
          {
            className: "ProjectSynchronization",
            scriptName: runtime.workerName,
          }
        ),
        CURSOR: Cloudflare.DurableObject<CursorConnectionObject>("Cursor", {
          className: "CursorContainer",
          scriptName: runtime.workerName,
        }),
        CI_WORKFLOW: Cloudflare.Workflow<WorkspaceCiInput>("CI", {
          className: "CI",
          scriptName: runtime.workerName,
        }),
        PROVISIONING: Cloudflare.Workflow<
          typeof WorkspaceProvisioningInput.Encoded
        >("WorkspaceProvisioning", {
          className: "WorkspaceProvisioning",
          scriptName: runtime.workerName,
        }),
        MESSAGE_DELIVERY: Cloudflare.Workflow<
          typeof WorkspaceMessageDeliveryInput.Encoded
        >("WorkspaceMessageDelivery", {
          className: "WorkspaceMessageDelivery",
          scriptName: runtime.workerName,
        }),
        MERGES: Cloudflare.Workflow<WorkspaceMergeInput>("WorkspaceMerge", {
          className: "WorkspaceMerge",
          scriptName: runtime.workerName,
        }),
        RETENTION: Cloudflare.Workflow<WorkspaceRetentionInput>(
          "WorkspaceRetention",
          {
            className: "WorkspaceRetention",
            scriptName: runtime.workerName,
          }
        ),
        RESOURCE_MAINTENANCE: Cloudflare.Workflow<ProjectResourceMaintenance>(
          "ResourceMaintenance",
          {
            className: "ResourceMaintenance",
            scriptName: runtime.workerName,
          }
        ),
      },
      memo: {
        include: [
          "**/*",
          "../../tools/wizard/github-app-manifest.ts",
          "../../packages/db/src/**",
          "../../packages/db/migrations/**",
          "../../packages/domain/src/**",
          "../../packages/ui/src/**",
        ],
        lockfile: true,
      },
    }
  })
) {}

export const installation = Effect.gen(function* () {
  const website = yield* Website
  const web = yield* Web
  yield* website.bind`Frontend`({
    bindings: [{ type: "service", name: "FRONTEND", service: web.workerName }],
  })
  return { websiteUrl: website.url.as<string>() }
})

export default Alchemy.Stack(
  "Sylph",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  installation
)
