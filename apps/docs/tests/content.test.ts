import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { z } from "zod"

const contentRoot = resolve(import.meta.dir, "..", "content", "docs")

type Frontmatter = {
  title: string | null
  description: string | null
}

const MetaFile = z.object({
  title: z.string().optional(),
  pages: z.array(z.string()).optional(),
  root: z.union([z.boolean(), z.string()]).optional(),
})

type MetaFile = z.infer<typeof MetaFile>

const isSeparator = (entry: string): boolean =>
  entry.startsWith("---") || entry.startsWith("...")

const readFrontmatter = (filePath: string): Frontmatter => {
  const source = readFileSync(filePath, "utf8")
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  if (!match) return { title: null, description: null }

  const read = (key: string): string | null => {
    const line = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(match[1] ?? "")
    return line ? (line[1] ?? "").trim() : null
  }

  return { title: read("title"), description: read("description") }
}

const readMeta = (directory: string): MetaFile | null => {
  const entries = readdirSync(directory)
  if (!entries.includes("meta.json")) return null
  const metaPath = join(directory, "meta.json")
  return MetaFile.parse(JSON.parse(readFileSync(metaPath, "utf8")))
}

const collectPages = (directory: string): string[] => {
  const pages: string[] = []
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry)
    if (statSync(entryPath).isDirectory()) {
      pages.push(...collectPages(entryPath))
      continue
    }
    if (entry.endsWith(".mdx")) pages.push(entryPath)
  }
  return pages
}

const collectDirectories = (directory: string): string[] => {
  const directories = [directory]
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry)
    if (statSync(entryPath).isDirectory()) {
      directories.push(...collectDirectories(entryPath))
    }
  }
  return directories
}

const pageUrl = (filePath: string): string => {
  const withoutExtension = relative(contentRoot, filePath).replace(/\.mdx$/, "")
  const withoutIndex = withoutExtension.replace(/(^|\/)index$/, "")
  return withoutIndex === "" ? "/docs" : `/docs/${withoutIndex}`
}

const sourceRoot = resolve(import.meta.dir, "..", "src")

const collectSources = (directory: string): string[] => {
  const sources: string[] = []
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry)
    if (statSync(entryPath).isDirectory()) {
      sources.push(...collectSources(entryPath))
      continue
    }
    if (entry.endsWith(".tsx") || entry.endsWith(".ts")) sources.push(entryPath)
  }
  return sources
}

const documentedPages = collectPages(contentRoot)
const knownUrls = new Set(documentedPages.map(pageUrl))

describe("documentation content", () => {
  test("every page is discovered", () => {
    expect(documentedPages.length).toBeGreaterThan(0)
    expect(knownUrls.has("/docs")).toBe(true)
  })

  test.each(documentedPages.map((filePath) => [pageUrl(filePath), filePath]))(
    "%s declares a title and a description",
    (_url, filePath) => {
      const frontmatter = readFrontmatter(filePath)
      expect(frontmatter.title).not.toBeNull()
      expect(frontmatter.description).not.toBeNull()
    }
  )

  test("every meta.json entry resolves to a page or a folder", () => {
    const missing: string[] = []
    for (const directory of collectDirectories(contentRoot)) {
      const meta = readMeta(directory)
      if (!meta?.pages) continue

      const entries = readdirSync(directory)
      for (const page of meta.pages) {
        if (isSeparator(page)) continue
        const resolved =
          entries.includes(`${page}.mdx`) || entries.includes(page)
        if (!resolved)
          missing.push(join(relative(contentRoot, directory), page))
      }
    }
    expect(missing).toEqual([])
  })

  test("every page and folder is listed in its meta.json", () => {
    const unlisted: string[] = []
    for (const directory of collectDirectories(contentRoot)) {
      const meta = readMeta(directory)
      if (!meta?.pages) continue

      const listed = new Set(meta.pages.filter((page) => !isSeparator(page)))
      for (const entry of readdirSync(directory)) {
        if (entry === "meta.json") continue
        const name = entry.replace(/\.mdx$/, "")
        if (!listed.has(name)) {
          unlisted.push(join(relative(contentRoot, directory), entry))
        }
      }
    }
    expect(unlisted).toEqual([])
  })

  test("every internal documentation link resolves", () => {
    const broken: string[] = []
    for (const filePath of documentedPages) {
      const source = readFileSync(filePath, "utf8")
      for (const match of source.matchAll(/["(](\/docs[^"()\s#]*)/g)) {
        const target = (match[1] ?? "").replace(/\/$/, "")
        if (!knownUrls.has(target)) {
          broken.push(`${pageUrl(filePath)} -> ${target}`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  test("every documentation link in the application resolves", () => {
    const broken: string[] = []
    for (const filePath of collectSources(sourceRoot)) {
      const source = readFileSync(filePath, "utf8")
      for (const match of source.matchAll(/_splat:\s*"([^"]+)"/g)) {
        const target = `/docs/${match[1] ?? ""}`.replace(/\/$/, "")
        if (!knownUrls.has(target)) {
          broken.push(`${relative(sourceRoot, filePath)} -> ${target}`)
        }
      }
      for (const match of source.matchAll(/url:\s*"(\/docs[^"]*)"/g)) {
        const target = (match[1] ?? "").replace(/\/$/, "")
        if (!knownUrls.has(target)) {
          broken.push(`${relative(sourceRoot, filePath)} -> ${target}`)
        }
      }
    }
    expect(broken).toEqual([])
  })
})
