import { expect, test } from "bun:test"
import {
  ciCommand,
  commandProcessScript,
  commandOutputLimit,
} from "./command-execution"

test("verification excludes deployment credentials while deployment receives only its allowed environment", () => {
  const command =
    'printf "%s|%s|%s" "$CLOUDFLARE_API_TOKEN" "$SYLPH_PROJECT" "$UNRELATED_SECRET"'
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: "test-token",
    SYLPH_PROJECT: "test-project",
    UNRELATED_SECRET: "test-private",
  }
  const verification = Bun.spawnSync(["bash", "-c", ciCommand(command)], {
    env,
  })
  expect(verification.exitCode).toBe(0)
  expect(verification.stdout.toString()).toBe("||")
  const deployment = Bun.spawnSync(["bash", "-c", ciCommand(command, true)], {
    env,
  })
  expect(deployment.exitCode).toBe(0)
  expect(deployment.stdout.toString()).toBe("test-token|test-project|")
})

test("the shared process runner bounds output and stops timed-out processes", () => {
  const execute = (command: string, args: string[], timeoutMs: number) => {
    const request = JSON.stringify({
      command,
      args,
      timeoutMs,
      env: {},
      cwd: process.cwd(),
    })
    const child = Bun.spawnSync([
      "node",
      "-e",
      `${commandProcessScript}\nrunCommand(${request}).then(result => console.log(JSON.stringify({ code: result.exitCode, bytes: Buffer.from(result.stdout, 'base64').length })))`,
    ])
    expect(child.exitCode).toBe(0)
    return JSON.parse(child.stdout.toString())
  }
  expect(execute("sh", ["-c", "sleep 30"], 50)).toEqual({ code: 137, bytes: 0 })
  const overflow = execute(
    "node",
    ["-e", `process.stdout.write(Buffer.alloc(${commandOutputLimit + 65536}))`],
    5000
  )
  expect(overflow.code).toBe(125)
  expect(overflow.bytes).toBeLessThanOrEqual(commandOutputLimit)
  expect(execute("/nonexistent/sylph-command", [], 5000).code).toBe(127)
})

test("resource planning receives isolation settings without deployment credentials or application secrets", () => {
  const command =
    'printf "%s|%s|%s|%s" "$SYLPH_RESOURCE_PREFIX" "$CLOUDFLARE_API_TOKEN" "$SYLPH_PROJECT_SECRETS" "$SYLPH_CUSTOM_DOMAIN"'
  const result = Bun.spawnSync(
    ["bash", "-c", ciCommand(command, false, true)],
    {
      env: {
        ...process.env,
        SYLPH_RESOURCE_PREFIX: "reserved-prefix",
        CLOUDFLARE_API_TOKEN: "test-token",
        SYLPH_PROJECT_SECRETS: '{"KEY":"private"}',
        SYLPH_CUSTOM_DOMAIN: "app.example.com",
      },
    }
  )
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toBe("reserved-prefix|||app.example.com")
})

test("production commands receive both resource ownership and release recovery context", () => {
  const command =
    'printf "%s|%s|%s|%s" "$SYLPH_RESOURCE_PLAN" "$SYLPH_RELEASE_ID" "$SYLPH_RECOVERY_POINT" "$SYLPH_PRODUCTION_URL"'
  const result = Bun.spawnSync(["bash", "-c", ciCommand(command, true)], {
    env: {
      ...process.env,
      SYLPH_RESOURCE_PLAN: "reserved-plan",
      SYLPH_RELEASE_ID: "release-id",
      SYLPH_RECOVERY_POINT: "recovery-point",
      SYLPH_PRODUCTION_URL: "https://app.example.com",
    },
  })
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toBe(
    "reserved-plan|release-id|recovery-point|https://app.example.com"
  )
})
