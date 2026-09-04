# Workspace companion smoke test, 4 September 2026

Status: incomplete. Provider credits are available, but the generated starter Project has not passed Preview deployment.

## Deployment and source

- Stage: `companion-smoke-0904`.
- Installation: <https://sylph-website-companion-smoke-0904-4qxrw3fkerksuzyz.apingot.workers.dev>.
- Platform source: `9f15fa294678b77d011523718a3128c6e2d63f0c` plus the uncommitted workspace companion changes. The SHA-256 of `git diff -- apps/web packages/ui` at deployment verification was `8c9f13c485ad380b4f36d6311a08bd78c44dec8acf6e433483cff9c9e4f3eb59`.
- Workspace: `4e797758-f561-41aa-8444-a44368b3aa03`, Project `Release Smoke Vertical Slice`.
- Proof marker: `sylph-release-smoke-1788558373735` in `RELEASE_SMOKE_PROOF.txt` and the root page.

The isolated stage reuses the operator's provider configuration and OAuth proxy. Test magic links are enabled only in its temporary deployment environment. Production was not changed.

## Verified behavior

Authenticated project creation succeeds after recovering the template import's RPC duplicate-repository error. The existing creation path forks the Template Repository into the Project Repository and then the initial Workspace Repository.

The deployed script passed inspector keyboard resizing, expansion, restoration, draft retention, and the 390px mobile conversation/inspector switch. Live browser checks also confirmed a 180px navigation pane with contained controls and no horizontal overflow. The ready message no longer lists starter files, and native scrollbars use the dark theme and thin width.

After credits were added, the agent created the proof file and root-page identity attributes. The script verified expandable tool details and file contents. Checkpoint `caae4dd5231a20ba854c40db474faea4072956a5`, Check `check-198ddffc-ddb8-449a-a5ce-98529801fa7e`, passed install, typecheck, lint, test, and build. Install took 24.9 seconds; the shared verification runner took 341.9 seconds including setup and snapshot. Individual commands took 24.7, 1.2, 1.0, and 4.3 seconds.

## Failures and repair

Preview failed because the starter template's Alchemy `2.0.0-beta.74` could not import `@effect/platform-node/NodeServices`. Its manifest omitted the optional platform runtime peers. The smoke Project was repaired with exact `@effect/platform-node` and `@effect/platform-bun` devDependencies at `4.0.0-rc.111` and a matching `@effect/platform-node-shared` override, preserving Effect `4.0.0-rc.111` and Alchemy's version. This generated-project repair is not a change to the upstream template repository.

The manifest repair is checkpoint `c9f24e9a254cac3836f89f6e42e34112479643d7`. Dependency job `dependencies-38490c81-f130-43d8-b20f-dbc390ffbfe0` failed with `Network connection lost`. Retry `dependencies-2e6bfcf9-1963-4e3e-9974-cad8c3307252` also failed with `Network connection lost`. The failure notification automatically prompted a third submission, `dependencies-92ae93fc-e0da-4497-8813-f6ca9d11919d`. The agent was instructed to stop further retries and report the outstanding job result only. No lockfile was edited by hand, and frozen validation remains enabled.

The smoke harness now supports resuming the existing proof, scopes file selection to the inspector, and verifies completed tool activity without depending on a transient running-tool state. Edit permissions are granted once per operation.

Preview/browser evidence, runtime restart recovery, acceptance, and archival have not passed. This run is not a complete lifecycle verification.

## Inspector and navigation follow-up

The 4 September follow-up deployment restores `@pierre/diffs` rendering for file contents. Files use a full-height tree beside the viewer, with search and a tree visibility control. The selected file remains mounted across inspector mode switches. The navigation collapse handler now uses the current viewport and hides the outer navigation panel when collapsed.

Thirteen browser stories passed, including file rendering, retained file selection, tree visibility, and repeated navigation collapse/reopen. UI typecheck and root lint passed. The isolated Alchemy deployment succeeded. A fresh authenticated page load confirmed that `package.json` renders inside the diffs.com shadow root, the tree and viewer share the same vertical bounds, and selection survives Preview/Files switching. Three deployed collapse/reopen cycles ended with a zero-width navigation panel. At 390px, the file tree and viewer remained side by side and document width equaled viewport width.
