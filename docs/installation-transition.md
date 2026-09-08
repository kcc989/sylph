# Preserve an earlier Installation

Do not deploy the reset `0001_initial.sql` over an earlier Installation. The current release also places WorkspaceDO in Website. A new namespace does not contain the old WorkspaceRuntime namespace's files, transcripts or pending operations.

The preservation-only transition is parallel operation: retain the earlier Installation and its resource identities, preserve its D1 database and encryption keys, verify a local import, then create a separate Installation. The preservation command does **not** convert earlier D1 schemas or clone Durable Object storage. Do not direct the new Installation at old resources or replay its baseline into the old D1 database.

A separate [verified migration path](../tools/installation-migration/README.md) now supports D1 conversion and full Workspace SQLite/KV copy from exact pre-PR69 commit `5311a147464946a7f0b781737166ea81d9c91f78` with the pinned SDK bootstrap schema. It retains the original copy, rejects active or unsupported state, and requires reviewed bridge deployment and a new target. Its local tests do not establish deployed migration proof. The remaining instructions on this page describe the preservation-only command.

## Capture and verify D1

`bun run installation:preserve` uses `~/.config/sylph/release-smoke.env`, or `SYLPH_SMOKE_ENV_FILE`. It parses the file without sourcing it. Saved values win over shell credentials. For an earlier Installation, select its actual private deployment configuration; a smoke configuration with different keys is unsuitable. The required keys are `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CREDENTIAL_ENCRYPTION_KEY`, and `BETTER_AUTH_SECRET`.

Create a source descriptor using the old deployment's run record and Cloudflare resource identities:

```json
{
  "accountId": "EXACT_ACCOUNT_ID",
  "stage": "EXACT_OLD_STAGE",
  "sourceCommit": "FULL_40_CHARACTER_OLD_SOURCE_COMMIT",
  "websiteWorker": "EXACT_OLD_WEBSITE_WORKER",
  "runtimeWorkers": ["EXACT_OLD_WORKSPACE_RUNTIME_WORKER"],
  "databaseId": "EXACT_OLD_D1_ID",
  "installationId": "default",
  "claimedByUserId": "EXACT_OLD_OWNER_USER_ID"
}
```

`sourceCommit` is the operator's provenance claim. Cloudflare Worker version IDs are captured independently; the tool cannot derive a Git commit from an older Worker that did not expose it. List every runtime Worker needed by the earlier deployment. Use an empty array only if all Durable Object bindings already belong to Website. An unclaimed Installation uses `null` for `claimedByUserId`.

Keep the archive, key, restored SQLite database and source descriptor outside the checkout in a private directory. Create a random 32-byte archive key, with mode 0600, in a separate protected location. For example, use Node's `crypto.randomBytes(32)` and `fs.writeFileSync` with `{ mode: 0o600, flag: "wx" }`. Do not use an ordinary password as the key or put it in a command argument.

```sh
bun run installation:preserve capture --source /private/path/source.json --archive /private/path/installation.archive --key-file /private/key-location/archive.key
bun run installation:preserve verify --source /private/path/source.json --archive /private/path/installation.archive --key-file /private/key-location/archive.key
bun run installation:preserve import-local --source /private/path/source.json --archive /private/path/installation.archive --key-file /private/key-location/archive.key --target /private/path/new-old-schema.sqlite
bun run installation:preserve verify-retained --source /private/path/source.json --archive /private/path/installation.archive --key-file /private/key-location/archive.key
```

Capture checks the account and Website DB binding, inventories runtime namespace bindings and deployed Worker versions, exports D1, verifies Installation/owner identity, and encrypts the SQL, inventory and continuity keys using authenticated AES-256-GCM. Archive creation refuses an existing file. The local import refuses an existing target and checks schema, table contents, binary values, foreign keys and SQLite integrity after copying. SQL cannot attach other databases or load extensions. The tool never issues a remote import, restore, delete or deployment.

The [D1 export API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/) returns a polling bookmark and a temporary download URL. The tool downloads without sending the Cloudflare bearer token to that URL. Export is bounded to 30 polls. D1 export does not provide an atomic snapshot of D1 together with runtime objects, repositories or app resources. Coordinate writes if a consistent cross-service checkpoint is required.

Every preserved `encrypted`/`iv` pair is decrypted in memory with the saved credential key. A wrong key fails capture. Zero such rows is reported as unverified key continuity. The saved Better Auth secret is retained but cannot be verified against Cloudflare's write-only secret settings. Keep the original secret configuration and its Alchemy state encryption material. If Alchemy generated keys and no recoverable copy exists, stop the transition: preserving ciphertext alone does not recover them.

## Durable Workspace state and other resources

| State                                                                                        | Preservation boundary                                                                                                              |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| D1 control-plane rows, earlier schema and encrypted credentials                              | Encrypted archive plus verified local SQLite import                                                                                |
| Credential encryption key and Better Auth secret                                             | Inside the encrypted archive; retain original configuration too                                                                    |
| Workspace working files, Git state, transcripts, forms, permissions, inbox and pending state | Remain in the original Durable Object namespace under the original runtime code                                                    |
| Active model requests, running commands, sockets and in-memory state                         | No portable continuation guarantee; finish or stop work through the earlier UI and record its outcome                              |
| Artifacts repositories and forks                                                             | Retain the namespace; independently clone each repository in the Project recovery manifest, compare HEAD and run `git fsck --full` |
| R2 evidence/backups, KV, Queues, application D1, secrets and app deployments                 | Retain each original resource; separate service export/recovery is required                                                        |
| OAuth and browser sessions                                                                   | Not a cross-origin sign-in migration; sign in again on the new Installation                                                        |

The old Installation is the preservation path for runtime state that this archive cannot copy. Keep its Worker source/version, namespaces, resource bindings, secret values, domain access and Alchemy state. Disable unattended deletion/retention through a separately reviewed change if required; this tool does not freeze the Installation or suspend its scheduled jobs. Do not call it immutable while writes, alarms, retention or model turns are active.

Before transition, open each important old Workspace and record the file list and content hashes, oldest and newest transcript pages, unanswered forms/permissions, inbox and runtime state. Repeat through the same old Installation after the new one is deployed. `verify-retained` checks version and namespace identity only; it does not inspect those contents. A repository-only manifest cannot verify this state.

Cloudflare supports [moving a Durable Object namespace between Workers](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), with coordinated source and target deployments. This is a move, not an independent backup. Sylph's current Alchemy definition does not perform that transfer. Do not add a Wrangler migration or transfer a live namespace as part of this preservation procedure. A future transfer needs an Alchemy-supported implementation, old/new runtime schema compatibility tests, exact namespace checks and explicit approval.

## Start the separate Installation

Use a new Alchemy stage and resources. Keep the earlier domain and Installation available. Import only repositories through a currently supported repository source; retain local verified clones when no supported import source is available. This procedure does not publish repositories or reconstruct old Workspace sessions inside new Workspaces.

The restored SQLite file is an inspection and recovery artifact for the **old schema**. Do not treat it as an importable database for the reset release. Conversions outside the pinned migration path must declare supported source schema hashes, map every table/identity, preserve unmapped data, verify encryption key continuity, and pass a disposable target round trip. Unsupported schema conversions must stop. Replacing a live Installation, moving namespaces, deleting old resources or applying a remote restore requires a separate reviewed target and explicit approval.
