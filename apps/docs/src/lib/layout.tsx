import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"

import { SylphMark } from "@/components/sylph-logo"
import { repositoryUrl, siteName } from "@/lib/site"

export const baseLayoutOptions: BaseLayoutProps = {
  githubUrl: repositoryUrl,
  nav: {
    url: "/",
    title: (
      <span className="inline-flex items-center gap-2 font-medium">
        <SylphMark className="size-5" />
        {siteName}
      </span>
    ),
  },
}

export const homeLayoutOptions: BaseLayoutProps = {
  ...baseLayoutOptions,
  links: [
    {
      text: "Documentation",
      url: "/docs",
      active: "nested-url",
    },
    {
      text: "Architecture",
      url: "/docs/cloudflare/architecture",
      active: "nested-url",
    },
    {
      text: "Deploy",
      url: "/docs/getting-started/deploy-an-installation",
      active: "nested-url",
    },
  ],
}
