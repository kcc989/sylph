import { writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import {
  configurationPath,
  smokeConfiguration,
  serializeEnvironment,
  requireSmokeStage,
  deployedWebsite,
  githubSessionAvailable,
  requireOpenRouterCredit,
  requireBrowserConfiguration,
  reuseGitHubConfiguration,
} from "../tools/release-smoke/config.mjs"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    auth: { type: "string", default: "github" },
    stage: { type: "string" },
    "github-env": { type: "string" },
    run: { type: "string" },
    headed: { type: "boolean", default: false },
  },
})
const command = positionals[0] || "test"
const root = resolve(import.meta.dirname, "..")

function execute(args, environment, capture = false, logPath) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: root,
    env: environment,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    maxBuffer: 32 * 1024 * 1024,
  })
  if (logPath)
    writeFileSync(logPath, (result.stdout || "") + (result.stderr || ""), {
      mode: 0o600,
    })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `${args[0]} ${args[1]} failed (exit ${result.status}). ${capture ? "Inspect the private deployment log in the run directory." : ""}`
    )
  return (result.stdout || "") + (capture ? result.stderr || "" : "")
}

async function deploymentPreflight(configuration) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${configuration.CLOUDFLARE_ACCOUNT_ID}`,
    {
      headers: {
        Authorization: `Bearer ${configuration.CLOUDFLARE_API_TOKEN}`,
      },
      signal: AbortSignal.timeout(20_000),
    }
  )
  if (!response.ok)
    throw new Error(
      `Cloudflare account rejected the saved credential (HTTP ${response.status})`
    )
  console.log("Cloudflare account: accepted")
}

async function browserPreflight(configuration) {
  requireBrowserConfiguration(configuration)
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${configuration.OPENROUTER_API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok)
    throw new Error(
      `OpenRouter rejected the saved credential (HTTP ${response.status})`
    )
  requireOpenRouterCredit((await response.json()).data)
  console.log("OpenRouter key: accepted")
  const creditResponse = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${configuration.OPENROUTER_API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (creditResponse.ok) {
    requireOpenRouterCredit((await creditResponse.json()).data)
    console.log(
      "OpenRouter account: positive balance; full-run cost is not guaranteed"
    )
  } else if ([401, 403].includes(creditResponse.status)) {
    console.log(
      "OpenRouter account balance unavailable to this key; the live agent request must verify credit availability"
    )
  } else {
    throw new Error(
      `OpenRouter balance check failed (HTTP ${creditResponse.status})`
    )
  }
  if (configuration.SYLPH_SMOKE_AUTH_MODE === "github") {
    let state = { cookies: [] }
    try {
      state = JSON.parse(
        await readFile(configuration.SYLPH_SMOKE_AUTH_STATE, "utf8")
      )
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "Saved browser state is unreadable; replace it with a headed GitHub login"
        )
    }
    if (!githubSessionAvailable(state) && !values.headed)
      throw new Error(
        "No reusable GitHub browser session. gh auth does not sign Playwright in. Run with --headed and complete GitHub login, or explicitly use --auth magic for runtime-only verification."
      )
    console.log(
      "GitHub browser login: requires live verification during the test"
    )
  }
}

async function main() {
  if (!["doctor", "deploy", "test"].includes(command))
    throw new Error("Use doctor, deploy, or test")
  const path = configurationPath(process.env)
  let configuration
  if (command !== "test") {
    let source = await readFile(path, "utf8")
    const githubPath =
      values["github-env"] || process.env.SYLPH_SMOKE_GITHUB_ENV_FILE
    if (githubPath && values.auth === "github") {
      source = reuseGitHubConfiguration(
        source,
        await readFile(resolve(githubPath), "utf8")
      )
      console.log(`Existing GitHub App configuration: ${resolve(githubPath)}`)
    }
    configuration = smokeConfiguration(source, path, values.auth)
  }
  if (command !== "test")
    console.log(`Configuration: ${path}; auth: ${values.auth}`)
  if (command === "doctor") {
    await deploymentPreflight(configuration)
    return
  }
  if (command === "deploy") {
    await deploymentPreflight(configuration)
    const stage = requireSmokeStage(
      values.stage ||
        `smoke-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`
    )
    const directory = resolve(root, ".alchemy/smoke-runs", stage)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const environmentPath = resolve(directory, "deploy.env")
    const environment = { ...process.env, ...configuration }
    await writeFile(environmentPath, serializeEnvironment(configuration), {
      mode: 0o600,
      flag: "wx",
    })
    const commit = execute(
      ["git", "rev-parse", "HEAD"],
      environment,
      true
    ).trim()
    const dirty =
      execute(["git", "status", "--porcelain"], environment, true).trim()
        .length > 0
    const record = {
      stage,
      commit,
      dirty,
      auth: values.auth,
      environmentPath,
      status: "deploying",
    }
    const recordPath = resolve(directory, "run.json")
    await writeFile(recordPath, JSON.stringify(record, null, 2), {
      mode: 0o600,
    })
    console.log(`Deploying ${stage}. Run record: ${recordPath}`)
    const output = execute(
      [
        "bun",
        "alchemy",
        "deploy",
        "--env-file",
        environmentPath,
        "--stage",
        stage,
        "--yes",
      ],
      environment,
      true,
      resolve(directory, "deploy.log")
    )
    record.baseURL = deployedWebsite(output)
    record.status = "deployed"
    await writeFile(recordPath, JSON.stringify(record, null, 2))
    console.log(
      `Deployed: ${record.baseURL}\nTest: bun run smoke:release -- --run ${recordPath}${values.headed ? " --headed" : ""}`
    )
    return
  }
  if (!values.run)
    throw new Error(
      "Pass --run <run.json> from smoke:release:deploy so the test uses the exact deployed configuration"
    )
  const recordPath = resolve(values.run)
  const record = JSON.parse(await readFile(recordPath, "utf8"))
  requireSmokeStage(record.stage)
  if (record.status !== "deployed")
    throw new Error("The run has no completed deployment")
  const deployed = smokeConfiguration(
    await readFile(record.environmentPath, "utf8"),
    record.environmentPath,
    record.auth
  )
  console.log(
    `Run: ${record.stage}; auth: ${record.auth}; URL: ${record.baseURL}`
  )
  await browserPreflight(deployed)
  const environment = {
    ...process.env,
    ...deployed,
    SYLPH_SMOKE_BASE_URL: record.baseURL,
    SYLPH_SMOKE_OUTPUT_DIR: resolve(
      root,
      "test-results/release-smoke",
      record.stage
    ),
    SYLPH_SMOKE_REPORT_DIR: resolve(
      root,
      "playwright-report/release-smoke",
      record.stage
    ),
  }
  for (const name of [
    "SYLPH_SMOKE_RESUME_CLAIMED",
    "SYLPH_SMOKE_WORKSPACE_URL",
    "SYLPH_SMOKE_PROOF_MARKER",
  ])
    delete environment[name]
  record.test = {
    status: "running",
    startedAt: new Date().toISOString(),
    outputDir: environment.SYLPH_SMOKE_OUTPUT_DIR,
  }
  await writeFile(recordPath, JSON.stringify(record, null, 2))
  try {
    execute(
      [
        "bun",
        "x",
        "playwright",
        "test",
        "--config",
        "playwright.release-smoke.config.ts",
        ...(values.headed ? ["--headed"] : []),
      ],
      environment
    )
    record.test.status = "passed"
  } catch (error) {
    record.test.status = "failed"
    throw error
  } finally {
    record.test.finishedAt = new Date().toISOString()
    await writeFile(recordPath, JSON.stringify(record, null, 2))
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
