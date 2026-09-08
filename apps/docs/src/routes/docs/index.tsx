import { createFileRoute } from "@tanstack/react-router"

import { DocsArticle } from "@/components/docs-article"
import { getDocsPage } from "@/functions/docs"
import { siteName } from "@/lib/site"

export const Route = createFileRoute("/docs/")({
  loader: () => getDocsPage({ data: "" }),
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} — ${siteName}` },
          {
            name: "description",
            content: loaderData.description ?? undefined,
          },
        ]
      : [],
  }),
  component: DocsIndex,
})

function DocsIndex() {
  const page = Route.useLoaderData()

  return <DocsArticle path={page.path} />
}
