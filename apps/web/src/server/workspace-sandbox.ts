import { getSandbox, type Sandbox } from "@cloudflare/sandbox"
import { WorkspaceDriver } from "@opencode-ai/core/workspace/driver"
import { Workspace as OpenCodeWorkspace } from "@opencode-ai/core/workspace"
import {
  WorkspaceCommandResult,
  WorkspaceCommandPending,
  WorkspaceCommandSnapshot,
} from "@workspace/domain"
import { Effect, PlatformError, Schema, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import type { ChildProcess } from "effect/unstable/process"
import type { WorkspaceFilesystem } from "./workspace-filesystem"
import {
  shellArgument,
  sandboxCommandEnvironment,
  workspaceCommandScript,
} from "./workspace-command-script"

const decodeResult = Schema.decodeUnknownSync(WorkspaceCommandResult)
const decodePending = Schema.decodeUnknownSync(WorkspaceCommandPending)
const decodeSnapshot = Schema.decodeUnknownSync(WorkspaceCommandSnapshot)
const failure = (cause: unknown) =>
  PlatformError.systemError({
    _tag: "Unknown",
    module: "WorkspaceSandbox",
    method: "spawn",
    cause,
    description:
      cause instanceof Error ? cause.message : "Sandbox command failed",
  })

export const workspaceSandboxProvider = (
  namespace: DurableObjectNamespace<Sandbox>,
  storage: DurableObjectStorage,
  filesystem: WorkspaceFilesystem,
  assertWritable: () => void,
  sandboxId: string
) => {
  const sandbox = () =>
    getSandbox(namespace, sandboxId, {
      transport: "http",
      sleepAfter: "5m",
      enableDefaultSession: true,
    })
  let tail = Promise.resolve()
  const acquire = async () => {
    const previous = tail
    let release = () => {}
    tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    return release
  }
  const reconcile = async () => {
    const saved = await storage.get("sylph:sandbox:pending")
    if (!saved) return
    const pending = decodePending(saved)
    const remote = sandbox()
    const active = await remote.getProcess(pending.processId)
    if (active) await active.waitForExit(660_000)
    const result = await remote.readFile(pending.result)
    const input = await remote.readFile(pending.request)
    const decoded = decodeResult(JSON.parse(result.content))
    const before = decodeSnapshot(JSON.parse(input.content))
    assertWritable()
    filesystem.applyCommandFiles(before.files, decoded.files)
    await storage.delete("sylph:sandbox:pending")
    return decoded
  }
  const spawn = Effect.fn("WorkspaceSandbox.spawn")(function* (
    command: ChildProcess.Command
  ) {
    if (command._tag !== "StandardCommand")
      return yield* Effect.fail(
        failure(new Error("Use shell syntax for pipelines"))
      )
    if (command.options.shell || command.options.additionalFds)
      return yield* Effect.fail(
        failure(new Error("Unsupported process options"))
      )
    const input = command.options.stdin
    if (input && !Stream.isStream(input) && input !== "ignore")
      return yield* Effect.fail(
        failure(new Error("Interactive stdin is not supported"))
      )
    const stdin = Stream.isStream(input)
      ? Buffer.concat(yield* Stream.runCollect(input))
      : Buffer.alloc(0)
    const release = yield* Effect.acquireRelease(
      Effect.tryPromise({ try: acquire, catch: failure }),
      (unlock) => Effect.sync(unlock)
    )
    yield* Effect.tryPromise({
      try: async () => {
        await reconcile()
        assertWritable()
      },
      catch: failure,
    })
    const remote = sandbox()
    const id = crypto.randomUUID()
    const requestPath = `/tmp/sylph-${id}.json`
    const resultPath = `/tmp/sylph-${id}.result.json`
    const env = sandboxCommandEnvironment(command.options.env ?? {})
    const request = {
      files: filesystem.commandFiles(),
      command: command.command,
      args: command.args,
      cwd: command.options.cwd ?? "/workspace",
      env,
      stdin: stdin.toString("base64"),
      result: resultPath,
    }
    yield* Effect.tryPromise({
      try: async () => {
        await remote.writeFile(requestPath, JSON.stringify(request))
        await storage.put("sylph:sandbox:pending", {
          request: requestPath,
          result: resultPath,
          processId: id,
        })
      },
      catch: failure,
    })
    const process = yield* Effect.tryPromise({
      try: () =>
        remote.startProcess(
          `node -e ${shellArgument(workspaceCommandScript)} ${shellArgument(requestPath)}`,
          { cwd: "/", processId: id }
        ),
      catch: failure,
    })
    let settled = false
    const completion = (async () => {
      await process.waitForExit(660_000)
      const result = await reconcile()
      if (!result) throw new Error("Sandbox command result is missing")
      settled = true
      release()
      return result
    })()
    completion.catch(() => {})
    const kill = () =>
      Effect.tryPromise({
        try: async () => {
          if (!settled) await process.kill("SIGTERM")
          await completion
        },
        catch: failure,
      })
    yield* Effect.addFinalizer(() =>
      settled ? Effect.void : kill().pipe(Effect.catch(() => Effect.void))
    )
    if (process.pid === undefined)
      return yield* Effect.fail(
        failure(new Error("Sandbox did not return a process ID"))
      )
    const result = Effect.tryPromise({ try: () => completion, catch: failure })
    const output = (stream: "stdout" | "stderr") =>
      Stream.fromEffect(
        result.pipe(
          Effect.map(
            (value) => new Uint8Array(Buffer.from(value[stream], "base64"))
          )
        )
      )
    return ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(process.pid),
      exitCode: result.pipe(
        Effect.map((value) => ChildProcessSpawner.ExitCode(value.exitCode))
      ),
      isRunning: Effect.sync(() => !settled),
      kill,
      stdin: Sink.drain,
      stdout: output("stdout"),
      stderr: output("stderr"),
      all: Stream.merge(output("stdout"), output("stderr")),
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    })
  })
  const spawner = ChildProcessSpawner.make(spawn)
  const driver = WorkspaceDriver.make({
    create: () => Effect.succeed({ binding: { sandboxId } }),
    connect: () => Effect.succeed({ spawner }),
    suspendForIdle: () => Effect.void,
    destroy: () =>
      Effect.tryPromise({
        try: () => sandbox().destroy(),
        catch: (cause) => new WorkspaceDriver.Error({ cause }),
      }),
  })
  return {
    registry: WorkspaceDriver.registryNode({ sandbox: driver }),
    spawner: Effect.gen(function* () {
      const workspaces = yield* OpenCodeWorkspace.Service
      const id = yield* workspaces.create({
        id: OpenCodeWorkspace.ID.make(`wrk_${sandboxId}`),
        provider: "sandbox",
      })
      return (yield* workspaces.connect(id)).spawner
    }).pipe(Effect.orDie),
  }
}
