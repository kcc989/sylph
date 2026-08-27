# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Sylph is for solo developers and small engineering teams who build and evolve software products with coding agents.

## Product Purpose

Sylph provides durable remote coding workspaces where people and agents can work on a Project's Repository, preview the running product, and test it through an embedded browser. Success means a developer can move from intent to an inspected, tested product change without assembling separate local tools or losing the workspace state between sessions.

## Positioning

Sylph makes the product workspace itself the unit of agentic development. Code, agent sessions, skills, browser preview, browser testing, repository state, and remote execution belong to one durable workspace rather than being coordinated across a local IDE and detached task runners.

## Operating Context

Users work remotely in a Workspace belonging to a Project. They converse with coding agents, inspect files and diffs from the Project's Repository, preview the live product in an embedded browser, and allow the agent to exercise that browser while testing its work. Solo developers may operate one Workspace directly; small teams may run several isolated Workspaces in parallel.

## Capabilities and Constraints

- An Organization is the membership boundary that owns Projects.
- A Project contains one Repository, its canonical source history, and one or more Workspaces.
- A Workspace is the durable place where a user and one or more agent sessions work on a Project's Repository. Product language must not call it an Environment or task.
- A Workspace combines remote coding, file and diff inspection, agent sessions, skills integration, browser preview, and agent-driven browser testing.
- Cloudflare Artifacts stores canonical code and an isolated fork for each Workspace.
- Cloudflare CI performs process-heavy installs, builds, tests, previews, and deployments outside the agent runtime.
- The Workspace is the primary operating surface. Change inspection and acceptance remain in that context; standalone routes are secondary entry points.
- Projects and their Workspaces remain in a persistent left rail across the primary operating surface.
- The initial product is web-based and keyboard-friendly. A future desktop client may reuse shared packages, but it is not part of the current surface.

## Brand Commitments

The product name is Sylph. The interface should meet the density, keyboard fluency, remote-workspace utility, embedded browser capability, and IDE-like preview quality associated with Conductor, bb, and Diffs without copying their visual identity or bb's local-host architecture.

The primary app shell should stay close to Conductor's familiar dense IDE structure while developing a visibly distinct Sylph identity. The persistent left rail groups each Project as a parent with its Workspaces nested directly beneath it; it must not split Projects and Workspaces into separate navigation sections. Chat, Browser, Changes, Checks, Review, and Terminal are peer work tabs, with Chat active by default and multiple tool tabs allowed per Chat. Distinction should come from Sylph's tabbed composition, typography, color, active-Workspace geometry, and state language rather than a decorative physical metaphor.

## Evidence on Hand

- `README.md` contains the current architecture and runtime boundaries.
- `CONTEXT.md` defines Organization, Project, Repository, and Workspace language.
- The current web app implements authentication, organizations, project creation, repository provisioning, workspace creation, agent chat, workspace files, and browser preview seams.
- No testimonials, customer logos, adoption metrics, or commercial claims are available and future surfaces must not fabricate them.

## Product Principles

- Keep work in the Workspace: conversation, code, preview, testing, and review should feel like facets of one place.
- Keep orientation stable: Projects and Workspaces always anchor the left side while the active work changes to their right.
- Make agent activity legible: users should always understand what is running, what changed, and what needs attention.
- Optimize for sustained building: dense information and keyboard access should reduce navigation without creating a cockpit of equal-weight panels.
- Treat the product preview as first-class work, not a thumbnail or final-stage artifact.
- Preserve durable state while letting isolated Workspaces proceed in parallel.

## Accessibility & Inclusion

The interface must remain fully operable by keyboard, communicate status without relying on color alone, preserve clear focus states, and support reduced motion and high-contrast usage.
