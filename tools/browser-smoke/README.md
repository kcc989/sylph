# Browser Run journey smoke

Run `bun run smoke:release:doctor -- --auth magic`, then `bun run smoke:browser` from the repository root.

Alchemy v2 creates a fresh disposable `smoke-browser-*` stage with the application fixture, a separate external authentication fixture, a Durable Object, D1, and R2. It loads the existing release smoke configuration without sourcing it. Only the local deployment process receives Cloudflare credentials; its private environment file is outside the checkout. Workers receive a newly generated fixture password and the source identity. No owner-account credential is sent to either fixture.

Every browser action uses the same `WorkspaceBrowser` service as the product. The browser runs in Cloudflare Browser Run, and the fixture reconstructs the service between calls while its Durable Object retains the guarded browser owner. The Node runner does not run Playwright or a local browser.

The smoke verifies CRUD, login, reload, local storage, action deduplication, durable requirements and results, acceptance blocking and valid proof, changed attempts, failed and interrupted journeys, desktop/mobile screenshot dimensions and native pointer assertions, shared human/agent ownership, external popup authentication, and default-deny navigation. The external fixture counts incoming requests to detect immediate or idle timer popups that escaped before their origin was allowed. It reads actual D1 rows and downloads screenshots for both viewports.

The suite uses default required screenshot evidence throughout. A missing screenshot fails the run. `node tools/browser-smoke/run.mjs --owner-probe` independently verifies unfrozen capture and Chromium context disposal after its owner transport disconnects. The older freeze/capture diagnostic remains available to reproduce the provider behavior.

This is service evidence, not full Installation, provider generation, real GitHub OAuth, or product-UI evidence. Run records include the commit, source manifest hash, deployment URLs, ordered results, and proof snapshots in `.alchemy/browser-smoke-runs/<stage>/`. Infrastructure remains for inspection; destruction requires explicit approval.
