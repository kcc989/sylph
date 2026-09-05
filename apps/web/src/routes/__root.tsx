import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"

import appCss from "@workspace/ui/globals.css?url"

const directionContract = [
  "THESIS: One durable Workspace keeps agent intent, running product, and proof together; it refuses a file-editor-first IDE.",
  "OWN-WORLD: Warm soft-black planes, warm-white text, coral selection, aqua live state, fine separators, clipped corners, compact sans, and readable mono.",
  "STORY: Select a Project and Workspace, direct the agent, watch the browser, then inspect changes and checks without changing context.",
  "FIRST VIEWPORT: Utility and Project rails left, agent thread center, persistent browser upper-right, review lower-right, composer anchored below the thread.",
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
        title: "Sylph",
      },
      {
        name: "theme-color",
        content: "#202523",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/x-icon",
        sizes: "16x16 32x32 48x48",
        href: "/favicon.ico",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The requested page does not exist.
        </p>
      </div>
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
      <body className="dark" data-impeccable-direction={directionContract}>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
