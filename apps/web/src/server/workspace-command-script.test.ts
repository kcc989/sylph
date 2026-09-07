import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  workspaceCommandScript,
  sandboxCommandEnvironment,
} from "./workspace-command-script"

test("sandbox command runs real programs, preserves failure output, and exports source without dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sylph-command-"))
  const root = join(directory, "workspace")
  try {
    await mkdir(root)
    const git = Bun.spawn(["git", "init", root], {
      stdout: "ignore",
      stderr: "pipe",
    })
    expect(await git.exited).toBe(0)
    const request = join(directory, "request.json")
    const result = join(directory, "result.json")
    await writeFile(
      request,
      JSON.stringify({
        root,
        previousPath: join(directory, "previous.json"),
        result,
        files: [
          {
            path: ".gitignore",
            content: Buffer.from("node_modules/\n").toString("base64"),
          },
          {
            path: "remove.txt",
            content: Buffer.from("delete me").toString("base64"),
          },
        ],
        command: "sh",
        args: [
          "-c",
          "mkdir -p node_modules; printf cached > node_modules/cache; rm remove.txt; cat > binary.bin; printf 'shell output'; printf 'failure detail' >&2; exit 7",
        ],
        cwd: root,
        env: {},
        stdin: Buffer.from([0, 255, 12]).toString("base64"),
      })
    )
    const child = Bun.spawn(["node", "-e", workspaceCommandScript, request], {
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(await child.exited).toBe(0)
    const output = JSON.parse(await readFile(result, "utf8"))
    expect(output.exitCode).toBe(7)
    expect(Buffer.from(output.stdout, "base64").toString()).toBe("shell output")
    expect(Buffer.from(output.stderr, "base64").toString()).toBe(
      "failure detail"
    )
    expect(output.files).toEqual(
      expect.arrayContaining([
        {
          path: "binary.bin",
          content: Buffer.from([0, 255, 12]).toString("base64"),
        },
      ])
    )
    expect(
      output.files.map((file: { path: string }) => file.path)
    ).not.toContain("remove.txt")
    expect(
      output.files.map((file: { path: string }) => file.path)
    ).not.toContain("node_modules/cache")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("sandbox commands do not inherit host credentials or host executable paths", () => {
  expect(
    sandboxCommandEnvironment({
      TERM: "xterm",
      LC_ALL: "C",
      CF_TOKEN: "private",
      CREDENTIAL_ENCRYPTION_KEY: "private",
      PATH: "/host/bin",
    })
  ).toEqual({ TERM: "xterm", LC_ALL: "C" })
})

test("cancelled commands retain source changes made before termination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sylph-cancel-"))
  const root = join(directory, "workspace")
  try {
    await mkdir(root)
    expect(
      await Bun.spawn(["git", "init", root], {
        stdout: "ignore",
        stderr: "ignore",
      }).exited
    ).toBe(0)
    const request = join(directory, "request.json")
    const result = join(directory, "result.json")
    await writeFile(
      request,
      JSON.stringify({
        root,
        previousPath: join(directory, "previous.json"),
        result,
        files: [],
        command: "sh",
        args: ["-c", "printf saved > changed.txt; sleep 60"],
        cwd: root,
        env: {},
        stdin: "",
      })
    )
    const child = Bun.spawn(["node", "-e", workspaceCommandScript, request], {
      stdout: "ignore",
      stderr: "pipe",
    })
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await Bun.file(join(root, "changed.txt")).exists()) break
      await Bun.sleep(20)
    }
    expect(await Bun.file(join(root, "changed.txt")).exists()).toBe(true)
    child.kill("SIGTERM")
    expect(await child.exited).toBe(0)
    const output = JSON.parse(await readFile(result, "utf8"))
    expect(output.exitCode).toBe(137)
    expect(output.files).toContainEqual({
      path: "changed.txt",
      content: Buffer.from("saved").toString("base64"),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
