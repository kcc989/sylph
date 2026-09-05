<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Tooling

- Use Oxlint for linting and Oxfmt for formatting. Do not add ESLint, Prettier, or competing formatter configuration.
- The anti-slop rules are vendored in `tools/oxlint/anti-slop`. Treat them as owned source: read a rule before changing it and add focused coverage for semantic changes.

## Code comments

- Do not add or leave comments in authored source code, including explanatory comments, documentation comments, TODOs, FIXMEs, commented-out code, lint suppressions, or safety comments.
- Express intent through precise names, small functions, explicit types, schemas, and module boundaries.
- If a lint rule would require a safety comment, refactor the code to remove the assertion or suppression instead.
- Preserve only legally required license headers and comments in generated or vendored files that the project does not own.

## Effect v4

- Read `node_modules/effect/AGENTS.md` and the relevant bundled Effect v4 documentation before writing Effect code.
- Model boundaries with Effect Schema, failures with `Schema.TaggedError`, capabilities with `Context.Service`, and implementations with Layers.
- Prefer `Effect.gen` for programs and `Effect.fn("name")` for functions that return Effects.
- Keep constructors private to their implementation modules. Runtime callers should import Layers and yield contextual services.
- Define each RPC payload, database JSON value, Workflow payload, and Durable Object callback once in `@workspace/domain`; do not maintain parallel validation schemas.

## Cloudflare and infrastructure

- Deploy Cloudflare resources through Alchemy v2 in `alchemy.run.ts`. Do not add Wrangler-owned infrastructure or `@cloudflare/vite-plugin`.
- Keep Durable Object work Workerd-safe. Process-heavy installs, builds, tests, and arbitrary commands belong in Cloudflare CI, not Durable Object storage.
- Never run destructive Alchemy operations or production deploys without explicit user approval.

## Deployed smoke tests

- Follow `tests/release-smoke/README.md`. Run `bun run smoke:release:doctor -- --auth magic`, then `bun run smoke:release:deploy -- --auth magic`, open the printed URL for manual verification. The printed `smoke:release -- --run ...` command runs the optional Playwright regression suite. Deployment does not require a browser session or provider credits.
- For GitHub OAuth proof, omit `--auth magic` and use `--headed` when a human login is needed. `gh auth` and other browser sessions do not sign Playwright in.
- The runner loads `~/.config/sylph/release-smoke.env` (or `SYLPH_SMOKE_ENV_FILE`). Do not source it, print secrets, copy credentials into the checkout, or silently switch auth modes. Reuse the existing GitHub App and proxy with `SYLPH_SMOKE_GITHUB_ENV_FILE` or `--github-env` when their settings live in another file. Report missing values by key name; do not create another App.
- Use a new stage for each fresh claim test. Keep the run record and report deployment, auth mode, and lifecycle results separately. Stage destruction still requires explicit approval.
