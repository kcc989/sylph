import { docsContent } from "@/lib/docs-content"

export function DocsArticle({ path }: { path: string }) {
  const Content = docsContent.getComponent(path)

  return <Content path={path} />
}
