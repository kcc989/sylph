# Workspace surface brief

Reference: `.impeccable/mocks/decision/conductor-thread-first.webp` (approved)

The Workspace is a dense, dark, tabbed engineering cockpit. It borrows Conductor's calm density, grouped navigation, and peer work tabs without copying its chrome. The persistent hierarchy is Organization → Project → nested Workspace, with each Project's contained Repository visible as metadata. Chat is the default full work surface. Browser, Changes, Checks, Review, and Terminal open as peer tabs in the same tab strip; more than one Browser or Terminal tab may belong to a Chat. No secondary tool is permanently nested beside or below another. On narrow screens, the same tab strip scrolls horizontally instead of changing the hierarchy.

Component grammar: fine separators, nearly square 4–9px corners, compact 10–13px labels, soft-black layered surfaces, warm near-white text, a hairline coral active edge, aqua only for live state, and monospace only for machine output. Avoid floating dashboard cards, oversized titles, decorative gradients, and pill-shaped chrome.

Palette: background `#0d0b0a`, panel `#171513`, raised panel `#1c1a18`, warm foreground `#eee9e2`, muted foreground `#8f8881`, coral `#ef9b7e`, live aqua `#62d4b6`, fine border `rgba(238,233,226,.11)`.

Reusable product components: utility rail, project/workspace navigator, workspace top bar, peer work tab strip, agent thread, prompt composer, browser preview and test controls, Pierre Diffs code review, checks list, and terminal surface. Prefer shadcn/Base UI primitives for controls and interaction state. Use `@pierre/diffs` for code and diff rendering.
