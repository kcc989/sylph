import { NodeServices } from "@effect/platform-node"
import { expect, test } from "bun:test"
import * as Alchemy from "alchemy"
import * as Output from "alchemy/Output"
import * as Cloudflare from "alchemy/Cloudflare"
import { provideFreshArtifactStore } from "alchemy/Artifacts"
import { evalStack } from "alchemy/Stack"
import { inMemoryState } from "alchemy/State"
import { ConfigProvider, Effect } from "effect"
import { installation } from "../../alchemy.run"

const configuration = ConfigProvider.fromUnknown({
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_TOKEN: "fixture",
  CF_TOKEN: "fixture",
  RESOURCE_TOKEN: "fixture",
  BETTER_AUTH_SECRET: "fixture",
  CREDENTIAL_ENCRYPTION_KEY: "fixture",
  INSTALLATION_CLAIM_SECRET: "fixture",
  R2_ACCESS_KEY_ID: "fixture",
  R2_SECRET_ACCESS_KEY: "fixture",
})

test("web split keeps runtime resources on their original Alchemy identities", async () => {
  const stack = Alchemy.Stack(
    "Sylph",
    {
      providers: Cloudflare.providers(),
      state: inMemoryState(),
    },
    installation.pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, configuration)
    )
  )
  await Effect.runPromise(
    evalStack(
      stack,
      (compiled) =>
        Effect.sync(() => {
          const resources = Object.values(compiled.resources)
          const workers = resources.filter(
            (resource) => resource.Type === "Cloudflare.Worker"
          )
          expect(workers.map((resource) => resource.LogicalId).sort()).toEqual([
            "Web",
            "Website",
          ])
          const bindings = (name: string) =>
            Alchemy.dedupeBindings(compiled.bindings[name]).flatMap(
              (row) => row.data.bindings ?? []
            )
          const remote = bindings("Web").filter(
            (binding) =>
              binding.type === "durable_object_namespace" ||
              binding.type === "workflow"
          )
          expect(remote).toHaveLength(9)
          for (const binding of remote) {
            expect(
              Object.keys(Output.resolveUpstream(binding.scriptName))
            ).toEqual(["Website"])
          }
          const local = bindings("Website").filter(
            (binding) =>
              binding.type === "durable_object_namespace" ||
              binding.type === "workflow"
          )
          expect(
            local.every((binding) => binding.scriptName === undefined)
          ).toBe(true)
          expect(
            local
              .filter((binding) => binding.type === "durable_object_namespace")
              .map((binding) => binding.className)
              .sort()
          ).toEqual([
            "CiSandbox",
            "CodexContainer",
            "CursorContainer",
            "CursorRuntimeContainer",
            "ProjectSynchronization",
            "WorkspaceDO",
            "WorkspaceSandbox",
          ])
          expect(
            resources
              .filter((resource) => resource.Type === "Cloudflare.Workflow")
              .map((resource) => resource.FQN)
              .sort()
          ).toEqual([
            "CI",
            "ResourceMaintenance",
            "WorkspaceMerge",
            "WorkspaceMessageDelivery",
            "WorkspaceProvisioning",
            "WorkspaceRetention",
          ])
          expect(
            Object.keys(
              Output.resolveUpstream(
                bindings("Website").find(
                  (binding) => binding.name === "FRONTEND"
                ).service
              )
            )
          ).toEqual(["Web"])
          expect(compiled.resources.Web.Props.workersDev).toBe(false)
        }),
      { stage: "smoke-workers" }
    ).pipe(
      Effect.provideService(Alchemy.AlchemyContext, {
        dotAlchemy: ".alchemy",
        dev: false,
        adopt: false,
      }),
      Effect.provide(NodeServices.layer),
      Effect.provide(inMemoryState()),
      provideFreshArtifactStore,
      Effect.provideService(Alchemy.Cli, {
        approvePlan: () =>
          Effect.die("Topology tests must not approve deployments"),
        displayPlan: () => Effect.void,
        startApplySession: () => Effect.die("Topology tests must not deploy"),
      })
    )
  )
}, 30000)
