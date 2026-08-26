---
version: 1
slug: "src-routes-workspaces-workspaceid-tsx"
primary_target: "src/routes/workspaces/$workspaceId.tsx"
related_targets: []
---

# Workspace surface brief

Reference: `.impeccable/mocks/decision/conductor-thread-first.webp` (approved)

The Workspace is a dense, dark, browser-first engineering cockpit. It borrows Conductor's calm density and grouped navigation without copying its chrome. The persistent hierarchy is Organization → Project → nested Workspace, with each Project's contained Repository visible as metadata. The agent thread is the main narrative surface. The browser stays visible beside it, with Changes and Checks below. On narrow screens, Agent, Preview, and Review become explicit modes instead of squeezing the desktop split.

Component grammar: fine separators, nearly square 4–9px corners, compact 10–13px labels, soft-black layered surfaces, warm near-white text, a hairline coral active edge, aqua only for live state, and monospace only for machine output. Avoid floating dashboard cards, oversized titles, decorative gradients, and pill-shaped chrome.

Palette: background `#0d0b0a`, panel `#171513`, raised panel `#1c1a18`, warm foreground `#eee9e2`, muted foreground `#8f8881`, coral `#ef9b7e`, live aqua `#62d4b6`, fine border `rgba(238,233,226,.11)`.

Reusable product components: utility rail, project/workspace navigator, workspace top bar, agent thread, prompt composer, browser preview and test controls, Pierre Diffs code review, checks list, desktop resizable shell, and mobile mode switcher. Prefer shadcn/Base UI primitives for controls and interaction state. Use `@pierre/diffs` for code and diff rendering.
