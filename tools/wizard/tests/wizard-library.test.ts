import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "../../..")
const templatePath = join(repositoryRoot, ".agents/skills/wizard/template.sh")
const productionWorkflowPath = join(
  repositoryRoot,
  ".github/workflows/deploy-production.yml"
)
const wizardPaths = [
  join(repositoryRoot, "scripts/setup.sh"),
  join(repositoryRoot, "scripts/setup-release-smoke.sh"),
]

const library = (source: string) => {
  const stages = source.indexOf("# STAGES:")
  const stagesBody = source.indexOf("\nTOTAL_STAGES=", stages)

  if (stages < 0 || stagesBody < 0) throw new Error("Wizard stages are missing")

  return source.slice(0, stagesBody)
}

test("generated wizards use the shared library", async () => {
  const expected = library(await readFile(templatePath, "utf8"))

  for (const wizardPath of wizardPaths) {
    expect(library(await readFile(wizardPath, "utf8"))).toBe(expected)
  }
})

test("the wizard runs when tput cannot clear the terminal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sylph-wizard-"))
  const testScript = join(directory, "wizard.sh")
  const wizardLibrary = library(await readFile(templatePath, "utf8")).replace(
    "[[ -t 1 ]] || return 0",
    "true"
  )
  const source = `${wizardLibrary}
TOTAL_STAGES=1
banner "Test wizard"
stage "Done"
finish
`

  try {
    await writeFile(testScript, source, { mode: 0o700 })
    const process = Bun.spawn(["bash", testScript], {
      env: { ...Bun.env, TERM: "dumb" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    process.stdin.write("\n")
    process.stdin.end()
    const stderr = await new Response(process.stderr).text()

    expect(await process.exited, stderr).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the release smoke wizard reuses OpenRouter credentials", async () => {
  const source = await readFile(wizardPaths[1], "utf8")

  expect(source).toContain(
    "OPENROUTER_API_KEY=$(_existing OPENROUTER_API_KEY || true)"
  )
  expect(source).toContain(
    'step "Run the first smoke test headed: bun run smoke:release -- --headed"'
  )
  expect(source).not.toContain("grep -q 'OPENROUTER_API_KEY'")
})

test("the release smoke wizard reuses Cloudflare credentials", async () => {
  const source = await readFile(wizardPaths[1], "utf8")

  expect(source).toContain(
    "CLOUDFLARE_ACCOUNT_ID=$(_existing CLOUDFLARE_ACCOUNT_ID || true)"
  )
  expect(source).toContain(
    "CLOUDFLARE_API_TOKEN=$(_existing CLOUDFLARE_API_TOKEN || true)"
  )
  expect(source).toContain(
    'note "Reusing the Cloudflare account ID and API token stored in $ENV_FILE."'
  )
  expect(source.indexOf('if [[ -z "$CLOUDFLARE_API_TOKEN" ]]')).toBeLessThan(
    source.indexOf(
      'open_url "https://dash.cloudflare.com/?to=/:account/api-tokens"'
    )
  )
})

test("the production wizard lists the exact Cloudflare permissions", async () => {
  const source = await readFile(wizardPaths[0], "utf8")

  expect(source).toContain(
    "Choose Create Token, then Create Custom Token, and name it Sylph deploy."
  )
  expect(source).toContain(
    'DEPLOY_TOKEN_PERMISSIONS="Account Settings Read, Account API Tokens Write, Workers Scripts Write, D1 Write, Workers R2 Storage Write, Workers Containers Write, Workers CI Write, Workers AI Read, Workers AI Write, Artifacts Write, and Browser Run Write."'
  )
  expect(source).toContain(
    'RUNTIME_TOKEN_PERMISSIONS="Account Settings Read,Workers Scripts Write,D1 Write,Workers R2 Storage Write,Workers Containers Write,Workers CI Write,Workers AI Read,Workers AI Write"'
  )
  expect(source).toContain(
    "Include, Specific account, then select only this Sylph Installation's account. Do not add zone resources."
  )
  expect(source).not.toContain("add any permissions required")
  expect(source).not.toContain('"Containers Write')
})

test("the production wizard keeps token minting out of the deployed Worker", async () => {
  const source = await readFile(wizardPaths[0], "utf8")

  expect(source).toContain(
    'bun scripts/cloudflare-token.ts "Sylph runtime $(timestamp)" "$RUNTIME_TOKEN_PERMISSIONS"'
  )
  expect(source).toContain(
    'bun scripts/cloudflare-token.ts "Sylph R2 $(timestamp)" "$R2_TOKEN_PERMISSIONS"'
  )
  expect(source).not.toContain("Account API Tokens Write,Workers")
  expect(source).toContain("CI=true bunx alchemy login --configure")
  expect(source).not.toContain("bunx alchemy login\n")
})

test("the production wizard captures the deployed URL and offers the manifest flow", async () => {
  const source = await readFile(wizardPaths[0], "utf8")

  expect(source).toContain(
    'bun alchemy deploy --stage prod --yes 2>&1 | tee "$deploy_log"'
  )
  expect(source).toContain('SYLPH_URL=$(deploy_url_from_log "$deploy_log")')
  expect(source).toContain("bun scripts/github-app-manifest.ts")
  expect(source).toContain('open_url "https://github.com/settings/apps/new"')
  expect(source.indexOf('stage "Preflight"')).toBeLessThan(
    source.indexOf('stage "Cloudflare deploy token"')
  )
})

test("the production wizard can ignore existing environment values", async () => {
  const source = await readFile(wizardPaths[0], "utf8")
  const expectedLibrary = library(await readFile(templatePath, "utf8"))

  expect(expectedLibrary).toContain(
    '[[ "$USE_EXISTING_ENV_VALUES" == "true" ]] || return 1'
  )
  expect(source).toContain('say "Setup found existing values in $ENV_FILE."')
  expect(source).toContain('confirm "Reuse these values as defaults?"')
  expect(source).toContain('USE_EXISTING_ENV_VALUES="false"')
})

test("the release smoke wizard creates a new R2 token policy", async () => {
  const source = await readFile(wizardPaths[1], "utf8")

  expect(source).toContain('--data-urlencode "name=Workers R2 Storage Write"')
  expect(source).toContain(
    '--data-urlencode "scope=com.cloudflare.api.account"'
  )
  expect(source).toContain('[`com.cloudflare.api.account.${accountId}`]: "*"')
  expect(source).toContain("permission_groups: [{ id: permissionGroupId }]")
  expect(source).not.toContain('"com.cloudflare.edge.r2.bucket.*": "*"')
  expect(source).not.toContain('id: crypto.randomUUID().replaceAll("-", "")')
})

test("production provides the permanent OAuth proxy", async () => {
  const production = await readFile(wizardPaths[0], "utf8")
  const smoke = await readFile(wizardPaths[1], "utf8")
  const workflow = await readFile(productionWorkflowPath, "utf8")

  expect(production).toContain('OAUTH_PROXY_URL="$SYLPH_URL"')
  expect(production).toContain('set_secret "$name" "${!name}"')
  expect(smoke).toContain('stage "Production OAuth bridge"')
  expect(smoke).not.toContain("gh workflow run deploy-production.yml")
  expect(smoke).not.toContain("bun alchemy deploy --stage prod")
  expect(workflow).toContain("environment: production")
  expect(workflow).toContain("bun alchemy deploy --stage prod --yes")
  expect(workflow).toContain(
    "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}"
  )
  expect(workflow).toContain("OAUTH_PROXY_URL: ${{ vars.OAUTH_PROXY_URL }}")
  expect(workflow).not.toContain("alchemy-run/alchemy@v1")
})
