import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import type { WorkspaceDO } from "./apps/web/src/server/workspace-do"
import type { WorkspaceCiInput } from "@workspace/domain"
import type { WorkspaceMergeInput } from "./apps/web/src/server/workspace-merge"
import type { CiSandbox } from "@cloudflare/ci/worker"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"

const Database = Cloudflare.D1.Database("Database", {
  migrations: "packages/db/migrations",
})
const Repositories = Cloudflare.Artifacts.Namespace("Repositories")
const CheckBackups = Cloudflare.R2.Bucket("CheckBackups")
const CheckEvidence = Cloudflare.R2.Bucket("CheckEvidence")
const WorkspaceRuntime = Cloudflare.Worker(
  "WorkspaceRuntime",
  Effect.gen(function* () {
    const repositories = yield* Repositories
    const checkBackups = yield* CheckBackups
    const checkEvidence = yield* CheckEvidence
    const database = yield* Database

    return {
      main: "apps/web/src/workspace-worker.ts",
      compatibility: {
        flags: ["nodejs_compat"],
      },
      env: {
        ARTIFACTS: repositories,
        BACKUP_BUCKET: checkBackups,
        BACKUP_BUCKET_NAME: checkBackups.bucketName,
        BROWSER: Cloudflare.Browser("BROWSER"),
        CHECK_EVIDENCE: checkEvidence,
        CI_WORKFLOW: Cloudflare.Workflow("CI", { className: "CI" }),
        CLOUDFLARE_ACCOUNT_ID: Config.string("CLOUDFLARE_ACCOUNT_ID"),
        DB: database,
        CF_TOKEN: Config.redacted("CF_TOKEN"),
        R2_ACCESS_KEY_ID: Config.redacted("R2_ACCESS_KEY_ID"),
        R2_SECRET_ACCESS_KEY: Config.redacted("R2_SECRET_ACCESS_KEY"),
        REPOSITORY_NAMESPACE: repositories.namespace,
        REPOS: repositories,
        SANDBOX: Cloudflare.Container<CiSandbox>("CiSandbox", {
          image:
            "docker.io/cloudflare/sandbox:0.12.1@sha256:ea9b35e61c800eddbc4450fad333e5dd26033a06f7d36624388b0711bef9f8c5",
          className: "CiSandbox",
          instanceType: "standard-4",
          maxInstances: 10,
        }),
        WORKSPACES: Cloudflare.DurableObject<WorkspaceDO>("Workspaces", {
          className: "WorkspaceDO",
        }),
      },
    }
  })
)

export class Website extends Cloudflare.Website.Vite<Website>()(
  "Website",
  Effect.gen(function* () {
    const workspaceRuntime = yield* WorkspaceRuntime
    const repositories = yield* Repositories
    const checkEvidence = yield* CheckEvidence

    return {
      rootDir: "apps/web",
      main: "src/worker.ts",
      compatibility: {
        flags: ["nodejs_compat"],
      },
      env: {
        BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
        DB: Database,
        CREDENTIAL_ENCRYPTION_KEY: Config.redacted("CREDENTIAL_ENCRYPTION_KEY"),
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
        REPOS: Repositories,
        CHECK_EVIDENCE: checkEvidence,
        CI_WORKFLOW: Cloudflare.Workflow<WorkspaceCiInput>("CI", {
          className: "CI",
          scriptName: workspaceRuntime.workerName,
        }),
        REPOSITORY_NAMESPACE: repositories.namespace,
        MERGES: Cloudflare.Workflow<WorkspaceMergeInput>("WorkspaceMerge", {
          className: "WorkspaceMerge",
        }),
        WORKSPACES: Cloudflare.DurableObject<WorkspaceDO>("Workspaces", {
          className: "WorkspaceDO",
          scriptName: workspaceRuntime.workerName,
        }),
      },
      memo: {
        include: [
          "**/*",
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

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>

export default Alchemy.Stack(
  "Sylph",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const website = yield* Website

    return {
      websiteUrl: website.url.as<string>(),
    }
  })
)
