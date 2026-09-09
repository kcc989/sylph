# Preserve an earlier Installation

This guide applies only to Installations created before the current schema baseline and Worker layout. New Installations should follow [the operator guide](operators.md).

Do not deploy the reset `0001_initial.sql` over an earlier Installation. The current stack places `WorkspaceDO` in the app Worker. A new namespace does not contain the old WorkspaceRuntime namespace's files, transcripts or pending operations.

Keep the old Installation running with its original resources. Archive its D1 database and encryption keys, verify a local import, then create a separate Installation. The preservation command neither converts schemas nor copies Durable Object storage. Do not connect the new Installation to old resources or apply its baseline to the old database.

## Capture and verify D1

`bun run installation:preserve` uses `~/.config/sylph/release-smoke.env`, or `SYLPH_SMOKE_ENV_FILE`. It parses the file without sourcing it and uses saved credentials instead of shell values. Select the old Installation’s private configuration; a smoke file with different keys will not work. The required keys are `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CREDENTIAL_ENCRYPTION_KEY`, and `BETTER_AUTH_SECRET`.

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

The operator supplies `sourceCommit`. The tool records Worker version IDs separately; it cannot determine the Git commit of an older Worker that did not expose it. List every runtime Worker needed by the earlier deployment. Use an empty array only if all Durable Object bindings already belong to Website. An unclaimed Installation uses `null` for `claimedByUserId`.

Keep the archive, key, restored SQLite database and source descriptor outside the checkout in a private directory. Create a random 32-byte archive key, with mode 0600, in a separate protected location. For example, use Node's `crypto.randomBytes(32)` and `fs.writeFileSync` with `{ mode: 0o600, flag: "wx" }`. Do not use an ordinary password as the key or put it in a command argument.

```sh
bun run installation:preserve capture --source /private/path/source.json --archive /private/path/installation.archive --key-file /private/key-location/archive.key
bun run installation:preserve verify --source /private/path/source.json --archive /private/path/installation.archive --key-file /private/key-location/archive.key
bun run installation:preserve import-local --source /private/path/source.json --archive /private/path/installation.archive --key-file /private/key-location/archive.key --target /private/path/new-old-schema.sqlite
bun run installation:preserve verify-retained --source /private/path/source.json --archive /private/path/installation.archive --key-file /private/key-location/archive.key
```

Capture verifies the account, Website DB binding, Installation, and owner. It records runtime namespaces and Worker versions, exports D1, then encrypts the SQL, inventory, and retained keys with AES-256-GCM. It refuses to overwrite an archive.

Local import also refuses an existing target. It verifies schema, table contents, binary values, foreign keys, and SQLite integrity. SQL cannot attach databases or load extensions. The tool does not import remotely, restore, delete, or deploy.

The [D1 export API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/) returns a polling bookmark and a temporary download URL. The tool downloads without sending the Cloudflare bearer token to that URL. Export stops after 30 polls. It does not capture D1, runtime objects, repositories, and application resources atomically. Coordinate writes when those services must be preserved at the same point.

Capture decrypts every `encrypted`/`iv` pair in memory with the saved key and fails if the key is wrong. With no encrypted rows, it cannot verify the key. It retains the Better Auth secret but cannot compare it with Cloudflare’s write-only settings. Keep the original secrets and Alchemy state encryption material. Stop if generated keys cannot be recovered; ciphertext alone is insufficient.

## Durable Workspace state and other resources

| State                                                                                        | How to preserve it                                                                                                                 |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| D1 control-plane rows, earlier schema and encrypted credentials                              | Encrypted archive plus verified local SQLite import                                                                                |
| Credential encryption key and Better Auth secret                                             | Inside the encrypted archive; retain original configuration too                                                                    |
| Workspace working files, Git state, transcripts, forms, permissions, inbox and pending state | Remain in the original Durable Object namespace under the original runtime code                                                    |
| Active model requests, running commands, sockets and in-memory state                         | Cannot reliably transfer; finish or stop work in the old UI and record the result                                                  |
| Artifacts repositories and forks                                                             | Retain the namespace; independently clone each repository in the Project recovery manifest, compare HEAD and run `git fsck --full` |
| R2 evidence/backups, KV, Queues, application D1, secrets and app deployments                 | Retain each original resource; separate service export/recovery is required                                                        |
| OAuth and browser sessions                                                                   | Sign in again on the new Installation                                                                                              |

Keep the old Installation to retain runtime state: Worker source/version, namespaces, bindings, secrets, domain access, and Alchemy state. The tool does not stop writes, alarms, retention, scheduled jobs, or model Turns. Disable automatic deletion through a separately reviewed change if needed; the retained Installation can still change.

Before transition, record each important Workspace’s file list and hashes, oldest and newest transcript pages, unanswered forms and permissions, inbox, and runtime state. Repeat after deploying the new Installation. `verify-retained` checks versions and namespace IDs only; neither it nor a repository manifest checks Workspace contents.

Cloudflare supports [moving a Durable Object namespace between Workers](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), with coordinated source and target deployments. This is a move, not an independent backup. Sylph's current Alchemy definition does not perform that transfer. Do not add a Wrangler migration or transfer a live namespace as part of this preservation procedure. A future transfer requires Alchemy support, runtime schema compatibility tests, namespace ID checks, and explicit approval.

## Start the separate Installation

Use a new Alchemy stage and resources. Keep the earlier domain and Installation available. Import repositories through supported sources. Otherwise, retain verified local clones. This procedure does not publish repositories or reconstruct old Workspace sessions inside new Workspaces.

The restored SQLite file uses the **old schema** and cannot be imported into the reset release. A separate conversion must identify supported source schema hashes, map every table and ID, preserve unmapped data, verify encryption keys, and pass an export/import test on a disposable target. Reject unsupported schemas. Replacing a live Installation, moving namespaces, deleting resources, or restoring remotely requires target review and explicit approval.
