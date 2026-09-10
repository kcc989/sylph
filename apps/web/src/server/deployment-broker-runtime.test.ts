import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ciCommand, requiredScriptCommand } from "./command-execution"
import { deploymentBrokerPreload } from "./deployment-broker-transport"

test("deployment scripts keep the broker preload in Alchemy child processes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sylph-broker-runtime-"))
  const record = join(directory, "runtime.jsonl")
  const preload = join(directory, "broker.mjs")
  const alchemy = import.meta.resolve("alchemy/bin/alchemy.js")
  const launcher = new URL("cli.js", alchemy).pathname
  try {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        type: "module",
        scripts: { "sylph:preview": "bun deploy.mjs" },
      })
    )
    await writeFile(join(directory, "bun.lock"), "")
    await writeFile(
      join(directory, "deploy.mjs"),
      `
import { spawnSync } from 'node:child_process'
const result = spawnSync('node', [${JSON.stringify(launcher)}, '--help'], { env: process.env, stdio: 'inherit' })
process.exit(result.status ?? 1)
`
    )
    await writeFile(
      preload,
      deploymentBrokerPreload +
        `
import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(record)}, JSON.stringify({entry: process.argv[1], runtime: process.versions.bun ? 'bun' : 'node'}) + '\\n')
`
    )
    const result = spawnSync(
      "sh",
      [
        "-c",
        ciCommand(requiredScriptCommand("sylph:preview", "Preview"), true),
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          NODE_OPTIONS: `--import=${preload}`,
          SYLPH_CLOUDFLARE_API_BASE_URL:
            "https://broker.example/api/project-deployment",
        },
        encoding: "utf8",
        timeout: 30_000,
      }
    )
    expect(result.status, result.stderr || result.stdout).toBe(0)
    const entries = (await readFile(record, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(entries).toContainEqual({
      entry: new URL(alchemy).pathname,
      runtime: "node",
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
