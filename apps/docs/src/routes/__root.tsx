import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { RootProvider } from "fumadocs-ui/provider/tanstack"

import appCss from "@/styles/globals.css?url"
import { siteDescription, siteName, siteTagline } from "@/lib/site"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: `${siteName} — ${siteTagline}` },
      { name: "description", content: siteDescription },
      { name: "theme-color", content: "#202523" },
      { property: "og:title", content: `${siteName} — ${siteTagline}` },
      { property: "og:description", content: siteDescription },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        type: "image/x-icon",
        sizes: "16x16 32x32 48x48",
        href: "/favicon.ico",
      },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
    ],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The requested page does not exist.
        </p>
      </div>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-svh flex-col bg-background text-foreground">
        <RootProvider theme={{ defaultTheme: "dark" }}>{children}</RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
