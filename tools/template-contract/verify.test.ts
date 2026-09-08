import { expect, test } from "bun:test"
import { requiredTemplateScripts, verifyTemplateManifest } from "./verify.mjs"

test("rejects the legacy 0.1.1 starter contract and names every missing hook", () => {
  const scripts = Object.fromEntries(
    ["typecheck", "lint", "test", "build", "sylph:preview", "sylph:deploy"].map(
      (name) => [name, "bun script.ts"]
    )
  )
  for (const name of [
    "sylph:plan",
    "sylph:release:review",
    "sylph:release:prepare",
    "sylph:release:restore",
    "sylph:release:verify",
    "sylph:release:resume",
  ])
    expect(() => verifyTemplateManifest({ scripts })).toThrow(name)
})

test("requires executable script strings", () => {
  const scripts = Object.fromEntries(
    requiredTemplateScripts.map((name) => [name, "bun script.ts"])
  )
  expect(() => verifyTemplateManifest({ scripts })).not.toThrow()
  expect(() =>
    verifyTemplateManifest({ scripts: { ...scripts, "sylph:plan": " " } })
  ).toThrow("sylph:plan")
  expect(() =>
    verifyTemplateManifest({ scripts: { ...scripts, "sylph:plan": true } })
  ).toThrow("sylph:plan")
})

test("runs planning and rejects hooks that report success without release identity", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { verifyTemplateContract } = await import("./verify.mjs")
  const directory = mkdtempSync(join(tmpdir(), "sylph-template-contract-"))
  try {
    const scripts = Object.fromEntries(
      requiredTemplateScripts.map((name) => [name, "bun fail.mjs"])
    )
    writeFileSync(join(directory, "fail.mjs"), "process.exit(64)")
    writeFileSync(
      join(directory, "plan.mjs"),
      'console.log("SYLPH_RESOURCE_PLAN=" + JSON.stringify([{kind:"worker",name:process.env.SYLPH_RESOURCE_PREFIX+"-web"}]))'
    )
    scripts["sylph:plan"] = "bun plan.mjs"
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts }))
    expect(verifyTemplateContract(directory)).toHaveLength(1)
    scripts["sylph:release:prepare"] = "bun plan.mjs"
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts }))
    expect(() => verifyTemplateContract(directory)).toThrow(
      "sylph:release:prepare"
    )
    writeFileSync(
      join(directory, "plan.mjs"),
      'console.log("SYLPH_RESOURCE_PLAN=" + JSON.stringify([{kind:"worker",name:"unreserved"}]))'
    )
    expect(() => verifyTemplateContract(directory)).toThrow("reserved prefix")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
