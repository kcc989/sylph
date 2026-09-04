import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  dependencyRepairCommand,
  readDependencyRepairOutput,
} from "./dependency-repair"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "sylph-dependencies-"))
  directories.push(directory)
  await mkdir(join(directory, "dependency"))
  await writeFile(join(directory, ".gitignore"), "node_modules\n.cache\n")
  await writeFile(
    join(directory, "dependency/package.json"),
    JSON.stringify({ name: "local-dependency", version: "1.0.0" })
  )
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "dependency-repair-test",
      private: true,
      packageManager: "bun@1.3.12",
      dependencies: { "local-dependency": "file:./dependency" },
      scripts: { postinstall: "touch lifecycle-ran" },
    })
  )
  const initialized = Bun.spawnSync(["git", "init", "--quiet"], {
    cwd: directory,
  })
  expect(initialized.exitCode).toBe(0)
  return directory
}

const repair = async (directory: string) => {
  const runner = Bun.spawn(["bash", "-c", dependencyRepairCommand], {
    cwd: directory,
    env: {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: join(directory, ".cache"),
      TMPDIR: directory,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(runner.stdout).text(),
    new Response(runner.stderr).text(),
    runner.exited,
  ])
  expect({ code, error: code ? stderr : "" }).toEqual({ code: 0, error: "" })
  return readDependencyRepairOutput(stdout)
}

describe("CI dependency repair", () => {
  for (const [name, damaged] of [
    ["missing", null],
    ["truncated", '{"workspaces": {'],
    [
      "duplicate package entries",
      '{"lockfileVersion":1,"workspaces":{},"packages":{"a":["a@1"],"a":["a@1"]}}',
    ],
  ] as const) {
    test(`regenerates a ${name} lockfile with a real frozen install`, async () => {
      const directory = await fixture()
      if (damaged !== null)
        await writeFile(join(directory, "bun.lock"), damaged)
      const output = await repair(directory)
      expect(output.lockfile).toBe(
        await readFile(join(directory, "bun.lock"), "utf8")
      )
      expect(output.lockfile).toContain("local-dependency")
      expect(
        output.inputs.some((input) => input.path === "dependency/package.json")
      ).toBeTrue()
      expect(
        output.inputs.every((input) => /^[a-f0-9]{64}$/.test(input.digest))
      ).toBeTrue()
      expect(
        await Bun.file(join(directory, "lifecycle-ran")).exists()
      ).toBeFalse()
    })
  }

  test("updates a valid stale lockfile and keeps manifests unchanged", async () => {
    const directory = await fixture()
    const first = await repair(directory)
    const path = join(directory, "package.json")
    const manifest = JSON.parse(await readFile(path, "utf8"))
    manifest.dependencies = { "renamed-dependency": "file:./dependency" }
    const updated = JSON.stringify(manifest)
    await writeFile(path, updated)
    const second = await repair(directory)
    expect(second.lockfile).not.toBe(first.lockfile)
    expect(await readFile(path, "utf8")).toBe(updated)
  })

  test("rejects missing or repeated result frames", () => {
    expect(() => readDependencyRepairOutput("install failed")).toThrow()
    expect(() =>
      readDependencyRepairOutput(
        "SYLPH_DEPENDENCY_RESULT=e30=\nSYLPH_DEPENDENCY_RESULT=e30="
      )
    ).toThrow()
  })
})
