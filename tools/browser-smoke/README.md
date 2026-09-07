# Browser Run journey smoke

Run `bun run smoke:release:doctor -- --auth magic`, then `bun run smoke:browser` from the repository root.

The runner uses Alchemy v2 to create a disposable `smoke-browser-*` Worker, Durable Object, D1 database, and R2 bucket. It reads the existing release smoke configuration without sourcing it. Only the deployment process receives the Cloudflare credentials. The fixture receives a new random password and the source commit.

Every browser action runs through the same `WorkspaceBrowser` service used by OpenCode's `workspace_browser` tool. The browser runs in Cloudflare Browser Run. The Node process sends tool inputs and checks results; it does not run Playwright or a local browser. The fixture reconstructs the service between calls to verify that the stored session reconnects.

The journey verifies login, click, fill, keyboard, select, scroll, wait, create, edit, completion, reload, deletion, failed assertions, local storage, and closing a session. It reads the actual D1 rows and downloads a stored screenshot. This is browser runtime proof; it does not test Installation setup, provider generation, GitHub OAuth, or the Preview iframe.

Run records, source changes, private deployment logs, and the screenshot are stored in `.alchemy/browser-smoke-runs/<stage>/`. Infrastructure remains available for inspection. Destroying the stage requires explicit approval.
