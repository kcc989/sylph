import { DurableObject } from "cloudflare:workers"

export class Probe extends DurableObject {
  host
  bootStarted = Date.now()
  bootMs = 0

  constructor(state, env) {
    super(state, env)
    this.host = state.blockConcurrencyWhile(async () => {
      const { OpenCodeWorkerd } = await import("@opencode-ai/sdk/workerd")
      const host = await OpenCodeWorkerd.create({
        storage: state.storage,
        models: { fetch: false, snapshot: false },
        config: {
          model: "probe/fixture",
          providers: {
            probe: {
              package: "aisdk:@ai-sdk/openai-compatible",
              settings: {
                baseURL: "https://fixture.test/v1",
                apiKey: "fixture",
              },
              models: { fixture: {} },
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
          emit: (entry) => console.log("opencode", entry.message, entry.cause),
        },
      })
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
