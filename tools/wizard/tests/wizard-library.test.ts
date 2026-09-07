import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "../../..")
const templatePath = join(repositoryRoot, ".agents/skills/wizard/template.sh")
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
    'step "Deploy a fresh stage: bun run smoke:release:deploy"'
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
