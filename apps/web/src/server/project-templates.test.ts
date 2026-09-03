import { describe, expect, test } from "bun:test"

import {
  builtInProjectTemplates,
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
