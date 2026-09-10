import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import ts from "typescript"
import { gzipSync } from "node:zlib"

const execute = promisify(execFile)
const budgets = JSON.parse(
  await readFile(new URL("./budgets.json", import.meta.url))
)
const results = []
for (const [name, directory] of [
  ["web", "apps/web/dist/server"],
  ["runtime", "dist/runtime"],
]) {
  const root = resolve(directory)
  const files = (await readdir(root, { recursive: true })).filter((file) =>
    file.endsWith(".js")
  )
  assert(files.includes("worker.js"), `${name} must be built before profiling`)
  if (name === "web") {
    const entry = ts.createSourceFile(
      "worker.js",
      await readFile(join(root, "worker.js"), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    )
    for (const statement of entry.statements) {
      if (!ts.isExportDeclaration(statement)) continue
      assert(
        statement.exportClause && ts.isNamedExports(statement.exportClause),
        "The web Worker must not re-export runtime modules"
      )
      assert(
        statement.exportClause.elements.every(
          (item) => item.name.text === "default"
        ),
        "The web Worker must own no Durable Object or Workflow classes"
      )
    }
  }
  const buffers = await Promise.all(
    files.map((file) => readFile(join(root, file)))
  )
  const compressedBytes = buffers.reduce(
    (sum, buffer) => sum + gzipSync(buffer).length,
    0
  )
  assert(
    compressedBytes <= budgets[name].gzipBytes,
    `${name} compressed modules exceed ${budgets[name].gzipBytes} bytes: ${compressedBytes}`
  )
  const temp = await mkdtemp(join(tmpdir(), "sylph-startup-"))
  try {
    const config = join(temp, "wrangler.json")
    await writeFile(
      config,
      JSON.stringify({
        name: `sylph-${name}-profile`,
        main: join(root, "worker.js"),
        compatibility_date: "2026-03-17",
        compatibility_flags: ["nodejs_compat"],
        no_bundle: true,
        find_additional_modules: true,
        rules: [{ type: "ESModule", globs: ["**/*.js"], fallthrough: true }],
      })
    )
    const samples = []
    for (let sample = 0; sample < 3; sample++) {
      const { stdout, stderr } = await execute(
        process.execPath,
        [
          resolve("node_modules/wrangler/bin/wrangler.js"),
          "check",
          "startup",
          "--config",
          config,
          `--args=--config ${config} --no-bundle`,
          "--outfile",
          resolve(`dist/${name}-startup-${sample}.cpuprofile`),
        ],
        {
          cwd: temp,
          env: {
            PATH: process.env.PATH,
            HOME: temp,
            WRANGLER_SEND_METRICS: "false",
            CI: "true",
          },
          timeout: 120000,
          maxBuffer: 1024 * 1024,
        }
      )
      const active = /Active:\s*([\d.]+)\s*ms/.exec(stdout + stderr)
      assert(active, `No startup CPU sample for ${name}: ${stdout}\n${stderr}`)
      samples.push(Number(active[1]))
    }
    const bestMs = Math.min(...samples)
    const result = {
      name,
      compressedBytes,
      samples,
      bestMs,
      budgetMs: budgets[name].startupMs,
    }
    results.push(result)
    console.log(JSON.stringify(result))
    assert(
      bestMs <= budgets[name].startupMs,
      `${name} startup CPU exceeds its budget`
    )
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
await writeFile("dist/worker-budgets.json", JSON.stringify(results, null, 2))
const inputs = JSON.parse(await readFile("dist/runtime-inputs.json", "utf8"))
assert(
  !inputs.some((file) =>
    /packages\/ui\/|apps\/web\/src\/(routes|components)\/|@tanstack\/react-start/.test(
      file
    )
  ),
  "The runtime bundle imports the web app"
)
console.log("Worker startup and runtime import boundaries passed")
