import { DurableObject } from "cloudflare:workers"
import { WorkspaceFilesystem } from "../../apps/web/src/server/workspace-filesystem"
import { workspaceModelCacheBody } from "../../apps/web/src/server/workspace-model-cache"
import {
  assertWorkspaceModelRequestSize,
  workspaceModelRequestByteLimit,
} from "../../apps/web/src/server/workspace-model-limits"

export class Probe extends DurableObject {
  host
  bootStarted = Date.now()
  bootMs = 0
  files

  constructor(state, env) {
    super(state, env)
    this.files = new WorkspaceFilesystem(state.storage)
    this.host = state.blockConcurrencyWhile(async () => {
      const { OpenCodeWorkerd } = await import("@opencode-ai/sdk/workerd")
      const { Environment } =
        await import("@opencode-ai/core/environment/index")
      const { Ripgrep } = await import("@opencode-ai/core/ripgrep")
      const { workspaceSearchLayer } =
        await import("../../apps/web/src/server/workspace-search")
      const { workspaceEnvironmentLayer } =
        await import("../../apps/web/src/server/workspace-environment")
      const host = await OpenCodeWorkerd.create(
        {
          storage: state.storage,
          models: { fetch: false, snapshot: false },
          config: {
            model: "probe/fixture",
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
            providers: {
              openrouter: {
                package: "@opencode-ai/ai/providers/openrouter",
                settings: {
                  baseURL: "https://fixture.test/v1",
                  apiKey: "fixture",
                },
                models: {
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
            ...Array.from({ length: 32 }, (_, index) => ({
              id: `initial-plugin-${index}`,
              async setup() {},
            })),
            {
              id: "recovery-probe",
              async setup(ctx) {
                await ctx.session.hook("http.request", async (event) =>
                  assertWorkspaceModelRequestSize(event.request, event.agent)
                )
                await ctx.tool.transform((draft) =>
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
                )
              },
            },
          ],
          log: {
            level: "warn",
            emit: (entry) =>
              console.log("opencode", entry.message, entry.cause),
          },
        },
        {
          overrides: [
            [Ripgrep.node, workspaceSearchLayer(this.files)],
            [Environment.node, workspaceEnvironmentLayer(this.files, () => {})],
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
    if (path === "/abort") this.ctx.abort("Deliberate recovery probe")
    if (path === "/native-state") {
      return Response.json({
        files: this.files.listWorkingFiles(),
        content: await this.files.readFile("native.txt", "utf8"),
      })
    }
    if (path === "/cache-start" || path === "/budget-start") {
      const session = await host.sessions.create({
        location: { directory: "/workspace" },
        model: { providerID: "openrouter", id: "anthropic/claude-sonnet-4.6" },
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
      })
      await host.sessions.wait({ sessionID })
      return Response.json(await host.sessions.get({ sessionID }))
    }
    if (path === "/check-notice") {
      const sessionID = await this.ctx.storage.get("probeSession")
      await host.sessions.synthetic({
        sessionID,
        text: "Fixture Check passed. Do not repeat Checks.",
        resume: false,
        metadata: {
          sylphOrigin: "check",
          sylphNotice: { summary: "Checks passed" },
        },
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
      await host.sessions.prompt({
        sessionID: session.id,
        text: "Exercise native file tools on native.txt.",
        metadata: { sylphOrigin: "user" },
        delivery: undefined,
      })
      return Response.json({ sessionID: session.id })
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
