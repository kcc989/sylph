import { Outlet, createFileRoute } from "@tanstack/react-router"
import { useFumadocsLoader } from "fumadocs-core/source/client"
import { DocsLayout } from "fumadocs-ui/layouts/docs"

import { getPageTree } from "@/functions/docs"
import { baseLayoutOptions } from "@/lib/layout"

export const Route = createFileRoute("/docs")({
  loader: () => getPageTree(),
  component: DocsShell,
})

function DocsShell() {
  const loaded = useFumadocsLoader(Route.useLoaderData())

  return (
    <DocsLayout {...baseLayoutOptions} tree={loaded.tree}>
      <Outlet />
    </DocsLayout>
  )
}
