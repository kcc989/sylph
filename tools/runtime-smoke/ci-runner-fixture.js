export async function runCiStep(env, provider, input) {
  const invocations = Number(await env.RECORDS.get("invocations")) + 1
  await env.RECORDS.put("invocations", String(invocations))
  if (input.command === "next") {
    if (input.snapshot?.id !== "fixture-snapshot")
      throw new Error("Chained runner lost its snapshot")
    return {
      exitCode: 0,
      logs: { stdout: "next stage", stderr: "" },
      snapshot: { id: "next-snapshot", dir: "/workspace" },
    }
  }
  const text = `SYLPH_DEPENDENCY_RESULT=${btoa("x".repeat(5 * 1024 * 1024))}\n`
  return {
    exitCode: 0,
    logs: {
      stdout: new Response(text).body,
      stderr: new Response("diagnostic\n".repeat(40000)).body,
    },
    snapshot: { id: "fixture-snapshot", dir: "/workspace" },
    cachePointer: { key: "fixture-cache", createdAt: "fixture", sizeBytes: 42 },
  }
}
