# Contributing to Sylph

Sylph is an open-source, Cloudflare-native workspace for coding agents.

## Development

Install the pinned toolchain and run the local checks:

```sh
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
```

Keep changes focused, add coverage for behavior changes, and follow the repository instructions in `AGENTS.md`. Do not commit credentials, generated build output, or local Alchemy state.

Open an issue before beginning a large architectural change so the domain language and deployment contract can be agreed first.
