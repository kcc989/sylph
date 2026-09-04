import { CIWorkflow } from "@cloudflare/ci"

export class Probe extends CIWorkflow {
  static getProvider() {
    return { assertSource() {} }
  }

  async pipeline(event, step, ci) {
    const first = await ci.runner({
      name: "large-logs",
      command: "large",
      config: { retries: { limit: 0, delay: 1000 } },
    })
    await step.do("mark-waiting", () => this.env.RECORDS.put("waiting", "yes"))
    await step.waitForEvent("continue", {
      type: "continue",
      timeout: "1 minute",
    })
    const stdout = await new Response(first.logs.stdout).text()
    const stderr = await new Response(first.logs.stderr).text()
    const expected = `SYLPH_DEPENDENCY_RESULT=${btoa("x".repeat(5 * 1024 * 1024))}\n`
    if (stdout !== expected || stderr !== "diagnostic\n".repeat(40000))
      throw new Error("Workflow replay changed the runner logs")
    if (first.cachePointer?.key !== "fixture-cache")
      throw new Error("Workflow replay lost cache metadata")
    const second = await first.runner({ name: "next-stage", command: "next" })
    if (second.logs.stdout !== "next stage")
      throw new Error("Chained runner output was lost")
    await step.do("record-result", async () => {
      const result = {
        stdoutBytes: new TextEncoder().encode(stdout).byteLength,
        stderrBytes: new TextEncoder().encode(stderr).byteLength,
        invocations: Number(await this.env.RECORDS.get("invocations")),
      }
      await this.env.RECORDS.put("result", JSON.stringify(result))
      return result
    })
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === "/start") {
      const instance = await env.PROBE.create({
        params: {
          provider: "cloudflare-artifacts",
          providerData: { namespace: "fixture" },
          owner: "fixture",
          repo: "fixture",
          ref: "refs/heads/main",
          sha: "fixture",
        },
      })
      return Response.json({ id: instance.id })
    }
    const instance = await env.PROBE.get(url.searchParams.get("id"))
    if (url.pathname === "/resume") {
      await instance.sendEvent({ type: "continue", payload: {} })
      return Response.json({ resumed: true })
    }
    const status = await instance.status()
    return Response.json({
      status: status.status,
      error: status.error,
      waiting: await env.RECORDS.get("waiting"),
      result: await env.RECORDS.get("result", "json"),
    })
  },
}
