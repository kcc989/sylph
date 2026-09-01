import { parseSkillDocument, type SkillFile } from "@workspace/domain"
import { Schema } from "effect"

const skillsOrigin = "https://skills.sh"
const githubApiOrigin = "https://api.github.com"
const githubRawOrigin = "https://raw.githubusercontent.com"
const maximumFiles = 128
const maximumFileBytes = 256_000
const maximumSkillBytes = 1_000_000

const textOnly = (value: string) =>
  value
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll(/\s+/g, " ")
    .trim()

export const parseSkillsCatalogPage = (html: string) => {
  const entries = []
  const anchors = html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)

  for (const [, href, body] of anchors) {
    const path = /^\/([^/]+)\/([^/]+)\/([^/?#]+)$/.exec(href)
    if (!path || path[1] === "site") continue
    const heading = /<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(body)
    const publisher = /<p\b[^>]*>([\s\S]*?)<\/p>/.exec(body)
    if (!heading || !publisher) continue
    const source = `${path[1]}/${path[2]}`
    if (textOnly(publisher[1]) !== source) continue
    const visible = textOnly(body)
    const installs = visible.match(/([0-9]+(?:\.[0-9]+)?[KMB]?)$/)?.[1] ?? "0"
    entries.push({
      catalogId: `${source}/${path[3]}`,
      name: textOnly(heading[1]),
      source,
      installs,
      sourcePageUrl: `${skillsOrigin}${href}`,
    })
  }

  return entries
}

const fetchText = async (url: string, headers?: HeadersInit) => {
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/json", ...headers },
  })
  if (!response.ok) throw new Error(`Source returned ${response.status}`)
  return response.text()
}

export const browseSkills = async (query?: string) => {
  const normalized = query?.trim() ?? ""
  const url = normalized
    ? `${skillsOrigin}/?q=${encodeURIComponent(normalized)}`
    : `${skillsOrigin}/trending`
  return parseSkillsCatalogPage(await fetchText(url))
}

const GitTreeEntry = Schema.Struct({
  path: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
})

const GitTree = Schema.Struct({
  tree: Schema.optional(Schema.Array(GitTreeEntry)),
  truncated: Schema.optional(Schema.Boolean),
})

type GitTreeEntry = typeof GitTreeEntry.Type

const decodeGitTree = Schema.decodeUnknownPromise(
  Schema.fromJsonString(GitTree)
)

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Sylph",
  "X-GitHub-Api-Version": "2022-11-28",
}

const skillDirectory = (
  tree: ReadonlyArray<GitTreeEntry>,
  requestedName: string
) => {
  const suffix = `/${requestedName.toLowerCase()}/skill.md`
  const selected = tree
    .flatMap((entry) =>
      entry.type === "blob" && entry.path ? [entry.path] : []
    )
    .filter((path) => `/${path.toLowerCase()}`.endsWith(suffix))
    .sort((left, right) => left.length - right.length)[0]
  if (!selected) throw new Error("The skill source no longer contains SKILL.md")
  return selected.slice(0, -"SKILL.md".length)
}

const sha256 = async (files: ReadonlyArray<SkillFile>) => {
  const source = files
    .map((file) => `${file.path}\0${file.content}`)
    .sort()
    .join("\0")
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source)
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export const reviewSkill = async (
  owner: string,
  repository: string,
  requestedName: string
) => {
  if (
    ![owner, repository, requestedName].every((part) =>
      /^[a-zA-Z0-9._-]+$/.test(part)
    )
  ) {
    throw new Error("The skill source is invalid")
  }

  const source = `${owner}/${repository}`
  const sourcePageUrl = `${skillsOrigin}/${source}/${requestedName}`
  await fetchText(sourcePageUrl)
  const tree = await decodeGitTree(
    await fetchText(
      `${githubApiOrigin}/repos/${source}/git/trees/HEAD?recursive=1`,
      githubHeaders
    )
  )
  if (!Array.isArray(tree.tree) || tree.truncated) {
    throw new Error("The skill repository is too large to review safely")
  }
  const directory = skillDirectory(tree.tree, requestedName)
  const paths = tree.tree
    .flatMap((entry) =>
      entry.type === "blob" && entry.path?.startsWith(directory)
        ? [entry.path]
        : []
    )
    .sort()
  if (paths.length === 0 || paths.length > maximumFiles) {
    throw new Error("The skill has an unsupported number of files")
  }

  let totalBytes = 0
  const files = await Promise.all(
    paths.map(async (path) => {
      const content = await fetchText(
        `${githubRawOrigin}/${source}/HEAD/${path}`
      )
      const bytes = new TextEncoder().encode(content).byteLength
      totalBytes += bytes
      if (bytes > maximumFileBytes || totalBytes > maximumSkillBytes) {
        throw new Error("The skill is too large to install safely")
      }
      return { path: path.slice(directory.length), content }
    })
  )
  const document = files.find((file) => file.path === "SKILL.md")
  if (!document) throw new Error("The skill source no longer contains SKILL.md")
  const parsed = parseSkillDocument(document.content, requestedName)

  return {
    catalogId: `${source}/${requestedName}`,
    source,
    sourcePageUrl,
    repositoryUrl: `https://github.com/${source}`,
    sourceHash: await sha256(files),
    metadata: {
      name: parsed.metadata.name,
      description: parsed.metadata.description,
      disableModelInvocation: parsed.metadata.disableModelInvocation,
      userInvokable: parsed.metadata.userInvokable,
    },
    files,
    content: parsed.content,
  }
}
