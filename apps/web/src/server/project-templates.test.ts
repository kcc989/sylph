import { describe, expect, test } from "bun:test"
import { builtInTemplateRelease, ProjectTemplate } from "@workspace/domain"
import { Effect } from "effect"
import type { RepositoryStore } from "./repository-store"

import {
  builtInProjectTemplates,
  importedTemplateRepository,
  defaultProjectTemplateKey,
  projectTemplateCatalog,
  resolveProjectTemplate,
  templateRepositoryName,
} from "./project-templates"

describe("project templates", () => {
  test("the default template is a built-in template", () => {
    const catalog = projectTemplateCatalog()
    expect(catalog.defaultTemplate).toBe(defaultProjectTemplateKey)
    expect(
      catalog.templates.some(
        (template) => template.key === catalog.defaultTemplate
      )
    ).toBe(true)
    expect(resolveProjectTemplate(defaultProjectTemplateKey)?.sourceUrl).toBe(
      builtInProjectTemplates[0]?.sourceUrl
    )
    expect(builtInTemplateRelease.commit).toMatch(/^[a-f0-9]{40}$/)
    expect(resolveProjectTemplate(defaultProjectTemplateKey)?.sourceRef).toBe(
      builtInTemplateRelease.commit
    )
  })

  test("an unknown template key resolves to nothing", () => {
    expect(resolveProjectTemplate("does-not-exist")).toBeUndefined()
  })

  test("names the Template Repository from the organization, key, and ref", () => {
    expect(
      templateRepositoryName("Acme Labs", {
        key: "cloudflare-tanstack",
        sourceRef: "v1.2.0",
      })
    ).toBe("acme-labs-template-cloudflare-tanstack-v1.2.0")
  })

  test("keeps Template Repository names within the Artifacts limits", () => {
    const name = templateRepositoryName("a".repeat(40), {
      key: "k".repeat(40),
      sourceRef: "refs/heads/feature/very-long-branch-name",
    })
    expect(name.length).toBeLessThanOrEqual(63)
    expect(name).toMatch(/^[a-z0-9._-]+$/)
  })
})

test("rejects a moved template source before it can seed a Project", async () => {
  const refs: string[] = []
  const repository = {
    id: "template",
    name: "template",
    remote: "https://example.com/template.git",
    defaultBranch: "main",
  }
  const template = new ProjectTemplate({
    key: "cloudflare-tanstack",
    name: "Cloudflare app",
    description: "test",
    sourceUrl: `https://github.com/${builtInTemplateRelease.repository}`,
    sourceRef: builtInTemplateRelease.commit,
  })
  const store = (head: string) => ({
    import: (input: Parameters<RepositoryStore["Service"]["import"]>[0]) => {
      refs.push(input.sourceRef)
      return Effect.succeed(repository)
    },
    inspect: () => Effect.succeed(repository),
    head: () => Effect.succeed(head),
  })
  await expect(
    importedTemplateRepository(store("a".repeat(40)), "template", template)
  ).rejects.toThrow("verified release commit")
  const result = await importedTemplateRepository(
    store(builtInTemplateRelease.commit),
    "template",
    template
  )
  expect(result.headCommit).toBe(builtInTemplateRelease.commit)
  expect(refs).toEqual([builtInTemplateRelease.ref, builtInTemplateRelease.ref])
})
