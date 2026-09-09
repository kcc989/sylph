# The desktop app is a native shell for one Installation

The Sylph web app is server-rendered on Cloudflare Workers and cannot run on a user's machine, so the macOS app in `apps/desktop` is a Tauri shell that connects to one deployed Installation and loads its pages in the system WebView. The shell owns only a local connect screen, the saved Installation origin, a macOS menu, and a navigation policy; every product screen stays remote and receives no Tauri IPC access.

## Considered Options

- **Bundle the web app in the desktop binary.** Rejected. The TanStack Start app depends on Worker-side rendering, D1, and Durable Objects, so a bundled copy would still need the Installation for every request and would duplicate the routing surface.
- **Use Electron.** Rejected. Electron ships a Chromium runtime for a window that only loads a remote origin, and it would not reuse the system WebView cookie store that keeps the Better Auth session.
- **Write a separate native UI over the Installation API.** Rejected. It would fork the product surface, and every product change would need a second implementation.
