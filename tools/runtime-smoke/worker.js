import { createCursorProvider } from "../../apps/web/src/server/cursor-plugin"
import { WorkspaceCredentials } from "../../apps/web/src/server/workspace-credentials"
import {
  reserveSmokeRequest,
  smokeModel,
  smokeModelConfiguration,
} from "../../apps/web/src/server/workspace-smoke-budget"
import {
  WorkspaceChecks,
  newCheckRun,
} from "../../apps/web/src/server/workspace-checks"
import { deliverCheckCompletion } from "../../apps/web/src/server/workspace-check-completion"
import {
  WorkspaceCheckRun,
  WorkspaceCheckUpdate,
  workspacePromptMessageId,
} from "@workspace/domain"
import { workspaceBrowserTool } from "../../apps/web/src/server/workspace-browser-tool"
import { DurableObject } from "cloudflare:workers"
import { WorkspaceFilesystem } from "../../apps/web/src/server/workspace-filesystem"
import { workspaceModelCacheBody } from "../../apps/web/src/server/workspace-model-cache"
import {
  assertWorkspaceModelRequestSize,
  workspaceModelRequestByteLimit,
} from "../../apps/web/src/server/workspace-model-limits"

export class Probe extends DurableObject {
  host
  cursor
  bootStarted = Date.now()
  bootMs = 0
  files

  constructor(state, env) {
    super(state, env)
    this.files = new WorkspaceFilesystem(state.storage)
    this.cursor = createCursorProvider(
      {
        idFromName: (name) => name,
        get: () => ({
          fetch: async (request) => {
            const input = await request.json()
            if (input.operation === "stream")
              return new Response(
                [
                  { type: "stream-start", warnings: [] },
                  { type: "text-start", id: "cursor-proof" },
                  {
                    type: "text-delta",
                    id: "cursor-proof",
                    delta: "CURSOR_RUNTIME_OK",
                  },
                  { type: "text-end", id: "cursor-proof" },
                  {
                    type: "finish",
                    finishReason: { unified: "stop" },
                    usage: { inputTokens: {}, outputTokens: {} },
                  },
                ]
                  .map((part) => JSON.stringify(part))
                  .join("\n") + "\n"
              )
            return Response.json([
              {
                id: "grok-4.6",
                name: "Cursor Grok 4.6",
                context: 128000,
                images: false,
              },
            ])
          },
        }),
      },
      state.storage,
      () => this.files.commandFiles()
    )
    this.host = state.blockConcurrencyWhile(async () => {
      await this.cursor.restore()
      const { createOpenCodeRuntime } =
        await import("../../apps/web/src/server/opencode-runtime")
      const { Environment } =
        await import("@opencode-ai/core/environment/index")
      const { Ripgrep } = await import("@opencode-ai/core/ripgrep")
      const { workspaceSearchLayer } =
        await import("../../apps/web/src/server/workspace-search")
      const { workspaceEnvironmentLayer } =
        await import("../../apps/web/src/server/workspace-environment")
      const { Effect, Stream, Sink } = await import("effect")
      const { ChildProcessSpawner } = await import("effect/unstable/process")
      const { WorkspaceDriver } =
        await import("@opencode-ai/core/workspace/driver")
      const { Workspace } = await import("@opencode-ai/core/workspace")
      const spawner = ChildProcessSpawner.make((command) => {
        if (
          command._tag !== "StandardCommand" ||
          !command.args.includes("printf SYLPH_NATIVE_SHELL")
        )
          return Effect.die(new Error("Unexpected fixture command"))
        const output = Stream.make(
          new TextEncoder().encode("SYLPH_NATIVE_SHELL")
        )
        return Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(123),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            stdin: Sink.drain,
            stdout: output,
            stderr: Stream.empty,
            all: output,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          })
        )
      })
      const driver = WorkspaceDriver.make({
        create: () => Effect.succeed({ binding: { fixture: true } }),
        connect: () => Effect.succeed({ spawner }),
        suspendForIdle: () => Effect.void,
        destroy: () => Effect.void,
      })
      const connectedSpawner = Effect.gen(function* () {
        const workspaces = yield* Workspace.Service
        const id = yield* workspaces.create({
          id: Workspace.ID.make("wrk_fixture"),
          provider: "fixture",
        })
        return (yield* workspaces.connect(id)).spawner
      }).pipe(Effect.orDie)
      const { workspaceShellSelection } =
        await import("../../apps/web/src/server/workspace-shell-selection")
      const host = await createOpenCodeRuntime(
        {
          storage: state.storage,
          models: { fetch: false, snapshot: false },
          config: {
            model: "probe/fixture",
            experimental: { portable_shell_scanner: true },
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            providers: {
              openrouter: {
                package: "@opencode-ai/ai/providers/openrouter",
                settings: {
                  baseURL: "https://openrouter.ai/api/v1",
                  apiKey: "fixture",
                },
                models: {
                  ...smokeModelConfiguration.providers.openrouter.models,
                  "anthropic/claude-sonnet-4.6": {
                    body: workspaceModelCacheBody(
                      "openrouter",
                      "anthropic/claude-sonnet-4.6"
                    ),
                  },
                },
              },
              probe: {
                package: "aisdk:@ai-sdk/openai-compatible",
                settings: {
                  baseURL: "https://fixture.test/v1",
                  apiKey: "fixture",
                },
                models: { fixture: {}, "gpt-fixture": {} },
              },
            },
          },
          plugins: [
            this.cursor.plugin,
            ...Array.from({ length: 32 }, (_, index) => ({
              id: `initial-plugin-${index}`,
              async setup() {},
            })),
            {
              id: "recovery-probe",
              async setup(ctx) {
                await ctx.session.hook("http.request", async (event) => {
                  await assertWorkspaceModelRequestSize(
                    event.request,
                    event.agent
                  )
                  if (event.model.id === smokeModel)
                    await reserveSmokeRequest(event.request, state.storage)
                })
                await ctx.tool.transform((draft) => {
                  draft.add(
                    workspaceBrowserTool(async (input) => ({
                      url: "https://fixture.test/preview",
                      checkId: "browser-check",
                      markdown: `Browser fixture received ${input.action.type}`,
                      accessibility: "{}",
                      evidence: [],
                      outcome:
                        input.action.type === "assert" ? "passed" : "observed",
                      session: {
                        id: "browser-fixture-session",
                        workspaceId: "fixture-workspace",
                        conversationId: "fixture-conversation",
                        checkId: "browser-check",
                        commit: "a".repeat(40),
                        attempt: 1,
                        previewUrl: "https://fixture.test",
                        sequence: 1,
                        expiresAt: Date.now() + 600_000,
                      },
                    }))
                  )
                  draft.add({
                    name: "probe_recovery_tool",
                    description: "A deterministic recovery test tool",
                    input: {
                      type: "object",
                      properties: {},
                      additionalProperties: false,
                    },
                    options: { codemode: false },
                    async execute() {
                      return { content: "probe result" }
                    },
                  })
                })
              },
            },
          ],
        },
        {
          overrides: [
            workspaceShellSelection,
            [
              WorkspaceDriver.node,
              WorkspaceDriver.registryNode({ fixture: driver }),
            ],
            [Ripgrep.node, workspaceSearchLayer(this.files)],
            [
              Environment.node,
              {
                ...Environment.node,
                dependencies: [Workspace.node],
                implementation: workspaceEnvironmentLayer(
                  this.files,
                  () => {},
                  connectedSpawner
                ),
              },
            ],
          ],
        }
      )
      this.files.initialize()
      this.bootMs = Date.now() - this.bootStarted
      return host
    })
  }

  async fetch(request) {
    const host = await this.host
    const path = new URL(request.url).pathname
    if (path === "/health")
      return Response.json({
        bootMs: this.bootMs,
        health: await host.health.get(),
      })
    if (path === "/stats") {
      const tables = this.ctx.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
      return Response.json({
        tables,
        storageBytes: this.ctx.storage.sql.databaseSize,
      })
    }
    if (path === "/cursor-inference") {
      const session = await host.sessions.create({
        location: { directory: "/workspace" },
        model: { providerID: "cursor", id: "grok-4.6" },
      })
      await host.sessions.prompt({
        sessionID: session.id,
        text: "Reply with the runtime proof marker.",
      })
      await host.sessions.wait({ sessionID: session.id })
      return Response.json(
        await host.message.list({ sessionID: session.id, limit: 20 })
      )
    }
    if (path === "/cursor-catalog")
      return Response.json(await host.model.list())
    if (path === "/cursor-connect") {
      const key = JSON.stringify({ userId: "fixture-user", key: "fixture-key" })
      await this.cursor.refresh(key)
      const { Effect } = await import("effect")
      await Effect.runPromise(
        Effect.gen(function* () {
          const credentials = yield* WorkspaceCredentials
          yield* Effect.promise(() =>
            credentials.install("cursor", { type: "key", key })
          )
        }).pipe(
          Effect.provide(
            WorkspaceCredentials.layer(
              Promise.resolve(host),
              this.ctx.storage,
              { active: false, accountID: null }
            )
          )
        )
      )
      return Response.json(await host.model.list())
    }
    if (path === "/abort") this.ctx.abort("Deliberate recovery probe")
    if (path === "/native-state") {
      return Response.json({
        files: this.files.listWorkingFiles(),
        content: await this.files.readFile("native.txt", "utf8"),
      })
    }
    if (
      path === "/cache-start" ||
      path === "/budget-start" ||
      path === "/smoke-start"
    ) {
      const session = await host.sessions.create({
        location: { directory: "/workspace" },
        model: {
          providerID: "openrouter",
          id:
            path === "/smoke-start"
              ? smokeModel
              : "anthropic/claude-sonnet-4.6",
        },
      })
      await this.ctx.storage.put("probeSession", session.id)
      await host.sessions.prompt({
        sessionID: session.id,
        text:
          path === "/budget-start"
            ? "x".repeat(workspaceModelRequestByteLimit + 1)
            : "Cache fixture first turn.",
      })
      return Response.json({ sessionID: session.id })
    }
    if (path === "/cache-next") {
      const sessionID = await this.ctx.storage.get("probeSession")
      await host.sessions.prompt({
        sessionID,
        text: "Cache fixture next turn.",
        delivery: "steer",
      })
      await host.sessions.wait({ sessionID })
      return Response.json(await host.sessions.get({ sessionID }))
    }
    if (path === "/check-continuation" || path === "/check-redelivery") {
      const sessionID = await this.ctx.storage.get("probeSession")
      const checks = new WorkspaceChecks(this.ctx.storage)
      checks.initialize()
      const run = new WorkspaceCheckRun({
        ...newCheckRun({
          id: "self-healing",
          workspaceId: "probe",
          checkpointId: "checkpoint",
          commit: "a".repeat(40),
          kind: "checkpoint",
          attempt: 1,
          createdAt: 1,
        }),
        status: "failed",
      })
      checks.apply(
        new WorkspaceCheckUpdate({ callbackId: "self-healing:failed", run })
      )
      try {
        await checks.deliverCompletions(async (completion) => {
          await deliverCheckCompletion(host.sessions, sessionID, completion)
          await host.sessions.wait({ sessionID })
          if (path === "/check-continuation")
            throw new Error("Acknowledgement lost")
        })
      } catch (cause) {
        if (cause.message !== "Acknowledgement lost") throw cause
      }
      return Response.json({
        pending: checks.hasPendingCompletions(),
        continuations: checks.checkContinuationsUsed(),
        active: Boolean((await host.sessions.active())[sessionID]),
      })
    }
    if (path === "/check-notice") {
      const sessionID = await this.ctx.storage.get("probeSession")
      await deliverCheckCompletion(host.sessions, sessionID, {
        id: "msg_fixture-passed-check",
        runId: "passed-check",
        commit: "a".repeat(40),
        attempt: 1,
        text: "Fixture Check passed. Do not repeat Checks.",
        summary: "Checks passed",
        resume: false,
      })
      return Response.json({
        active: Boolean((await host.sessions.active())[sessionID]),
      })
    }
    if (path === "/compact") {
      const sessionID = await this.ctx.storage.get("probeSession")
      await host.sessions.compact({ sessionID })
      await host.sessions.wait({ sessionID })
      return Response.json(await host.message.list({ sessionID, limit: 20 }))
    }
    if (path === "/native-start" || path === "/patch-start") {
      if (path === "/native-start")
        await this.files.writeFile("native.txt", "before\n")
      const session = await host.sessions.create({
        location: { directory: "/workspace" },
        model: {
          providerID: "probe",
          id: path === "/patch-start" ? "gpt-fixture" : "fixture",
        },
      })
      await this.ctx.storage.put("probeSession", session.id)
      const messageId = workspacePromptMessageId()
      await host.sessions.prompt({
        id: messageId,
        sessionID: session.id,
        text: "Exercise native file tools on native.txt.",
        metadata: { sylphOrigin: "user" },
        delivery: undefined,
      })
      return Response.json({ sessionID: session.id, messageId })
    }
    if (path === "/start") {
      const session = await host.sessions.create({
        location: { directory: "/workspace" },
      })
      await this.ctx.storage.put("probeSession", session.id)
      await host.sessions.prompt({
        sessionID: session.id,
        text: "Use the recovery test tool.",
      })
      return Response.json({ sessionID: session.id })
    }
    if (path === "/complete") {
      const sessionID = await this.ctx.storage.get("probeSession")
      for await (const event of host.sessions.log({
        sessionID,
        follow: true,
      })) {
        if (
          ["session.execution.succeeded", "session.execution.failed"].includes(
            event.type
          )
        ) {
          return Response.json({
            sessionID,
            outcome: event.type.endsWith("succeeded") ? "succeeded" : "failed",
            messages: await host.message.list({ sessionID, limit: 20 }),
          })
        }
      }
    }
    return new Response("Unknown probe route", { status: 404 })
  }
}

export default {
  fetch(request, env) {
    return env.PROBE.get(env.PROBE.idFromName("probe")).fetch(request)
  },
}
