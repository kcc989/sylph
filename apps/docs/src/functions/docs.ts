import { createServerFn } from "@tanstack/react-start"
import { notFound } from "@tanstack/react-router"

import { source } from "@/lib/source"

export const getPageTree = createServerFn({ method: "GET" }).handler(
  async () => ({
    tree: await source.serializePageTree(source.pageTree),
  })
)

export const getDocsPage = createServerFn({ method: "GET" })
  .validator((splat: string) => splat)
  .handler(({ data }) => {
    const slugs = data.split("/").filter((segment) => segment.length > 0)
    const page = source.getPage(slugs)
    if (!page) throw notFound()

    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description ?? null,
    }
  })
