import { describe, expect, test } from "bun:test"

import { parseSkillsCatalogPage } from "./skills-sh"

describe("skills.sh catalog", () => {
  test("reads GitHub skills and ignores navigation and well-known entries", () => {
    const entries = parseSkillsCatalogPage(`
      <a href="/docs"><h3>Docs</h3><p>docs</p></a>
      <a href="/mattpocock/skills/codebase-design">
        <span>59</span><h3>codebase-design</h3><p>mattpocock/skills</p><span>522.9K</span>
      </a>
      <a href="/site/example.com/example"><h3>example</h3><p>example.com</p><span>2K</span></a>
    `)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual(
      expect.objectContaining({
        catalogId: "mattpocock/skills/codebase-design",
        installs: "522.9K",
        sourcePageUrl: "https://skills.sh/mattpocock/skills/codebase-design",
      })
    )
    expect(Object.getPrototypeOf(entries[0])).toBe(Object.prototype)
  })
})
