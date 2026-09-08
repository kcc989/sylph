import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page"
import defaultMdxComponents from "fumadocs-ui/mdx"

import browserCollections from "../../.source/browser"
import { repositoryName, repositoryOwner } from "@/lib/site"

export const docsContent = browserCollections.docs.createClientLoader({
  id: "docs",
  component: (loaded, props: { path: string }) => (
    <DocsPage
      toc={loaded.toc}
      full={loaded.frontmatter.full ?? false}
      editOnGithub={{
        owner: repositoryOwner,
        repo: repositoryName,
        path: `apps/docs/content/docs/${props.path}`,
      }}
    >
      <DocsTitle>{loaded.frontmatter.title}</DocsTitle>
      {loaded.frontmatter.description ? (
        <DocsDescription>{loaded.frontmatter.description}</DocsDescription>
      ) : null}
      <DocsBody>
        <loaded.default components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  ),
})
