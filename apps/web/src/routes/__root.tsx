import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"

import appCss from "@workspace/ui/globals.css?url"

const directionContract = [
  "THESIS: One durable Workspace keeps agent intent, running product, and proof together; it refuses a file-editor-first IDE.",
  "OWN-WORLD: Warm soft-black planes, warm-white text, coral selection, aqua live state, fine separators, clipped corners, compact sans, and readable mono.",
  "STORY: Select a Repository and Workspace, direct the agent, watch the browser, then inspect changes and checks without changing context.",
  "FIRST VIEWPORT: Utility and Repository rails left, agent thread center, persistent browser upper-right, review lower-right, composer anchored below the thread.",
  "FORM: Thread-First Sylph, second of three safer-register forms; selection key 318ad254.",
  "FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance",
].join(" ")

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Sylph Workspace Lab",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body data-impeccable-direction={directionContract}>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
