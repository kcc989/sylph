# Earlier Installation migration

This path converts D1 and copies complete Workspace SQLite and KV storage into a new Installation stage. It does not move or delete the source namespace. It does not switch traffic. No deployed migration is claimed by the local tests.

## Supported source

Only commit `5311a147464946a7f0b781737166ea81d9c91f78`, the main revision immediately before PR #69, is supported. The 25 D1 migration files are recorded with SHA-256 hashes in `sources/d1-migrations.json`. Their concatenated SQL hash is `4f9cccd13fe0a768d7a49f2711099de527b0519482bff0958e6d047750e1a63d`. `sources/provenance.json` records the four historical Workspace runtime module hashes. The Workspace schema comes from that code and the installed `@opencode-ai/core@0.0.0-dev-18308` schema bootstrap. `workspace-schema.json` and `workspace-migrations.json` are exact accepted schema and SDK migration inventories.

The supported Workspace layout is the fresh SDK bootstrap layout. Older upgraded layouts, `_app_*` bootstrap remnants, extra tables, virtual tables, unknown SDK migrations, and partially initialized Workspaces are rejected. The exporter checks all SQLite tables, not only KV. It preserves row IDs, SQL types, binary and NUL content, autoincrement sequences, transcript/event tables, files/directories, Git state, checks, inbox, pending forms, permissions, credentials, and structured KV. Unknown structured-clone types and cyclic values are rejected. Date, bytes, arrays, records, Maps, Sets, bigint, and finite numbers are supported.

D1 conversion copies every original application column and row, preserves ciphertext without changing its key, checks foreign keys, and verifies an independent SQLite re-import. New columns use the current schema defaults. The encrypted source archive retains the entire earlier SQL, original migration bookkeeping, keys, Worker versions, and binding inventory. The target gets a new `__alchemy_migrations` ledger with the current migration filenames and hashes; it does not replay the 25 earlier migrations. Supported source bookkeeping is either the Alchemy five-column ledger, the Wrangler three-column ledger, or an export without bookkeeping. Unknown or mixed ledgers are rejected. New target schema/migration changes invalidate an existing migration archive until it is rebuilt and reviewed.

## Prepare for review

Run `bun run installation:migrate:prepare -- /private/tmp/new-bridge-overlay`. This writes a review overlay for the exact historical checkout. It retains the old Worker and Durable Object class exports, changes the Website and Workspace runtime entrypoints to authenticated maintenance/export handlers, and removes Website crons. It does not edit the historical checkout or deploy it. Review the Alchemy diff against the recorded source commit. Preserve every existing resource and namespace identity.

`target.alchemy.ts` is a separate Alchemy configuration for a new `migration-*` stage. It uses logical resource names `Database`, `Website`, and `Workspaces`, matching the new runtime. The target database starts without migrations so the atomic import can populate it. The target configuration must only be used for a new stage. Before deployment, review the exact physical IDs, the absence of source namespace transfers, and the later normal-application plan for unchanged target Database and Workspaces identities.

Both bridges require a dedicated `SYLPH_INSTALLATION_MIGRATION_TOKEN`, `SYLPH_INSTALLATION_MIGRATION_DATABASE_ID`, and `SYLPH_INSTALLATION_MIGRATION_NAMESPACE_ID`. Bind reviewed physical IDs; do not use an owner credential as the migration token. The source bridge is read-only. The target bridge permits import only into empty storage. Tokens are sent only in HTTPS authorization headers, and redirects are rejected.

Before changing the source runtime, stop admission and drain CI, provisioning, merge, message delivery, repository operations, model execution, alarms, undelivered prompts, outbox entries, and check completions. The code rejects active D1 operations, active or suspended/compacting SDK sessions, scheduled alarms, and incomplete Workspace work. A maintenance deployment alone is not proof that external Workflow/container writers stopped. The source Alchemy plan, active Workflow/container inventory, and writer-drain evidence require operator review before deployment. Pending forms and inbox records are retained only when their session is already idle.

## Capture and verify

After the approved source freeze, create a fresh encrypted preservation archive with `installation:preserve` using its existing documented source JSON and private 32-byte key. Then:

```sh
bun run installation:migrate -- capture --source source.json --preservation source.encrypted.json --archive migration.encrypted.json --key-file archive.key --bridge https://source-bridge.example
bun run installation:migrate -- verify --source source.json --archive migration.encrypted.json --key-file archive.key
```

Capture compares every live D1 application table and bookkeeping digest with the preserved SQL, exports every Workspace ID from D1, and rechecks D1 after export. Workspace Project/organization identities and D1 Conversation coverage must agree. Missing or duplicate Workspace IDs, partial tables, unsupported schemas, and hash mismatches fail. Archives use AES-256-GCM with separate migration associated data. Decryption and converted SQL remain in process memory; no plaintext secret files are written.

## Import and reconcile

The following commands are prepared for an explicitly approved new target. They are not run by tests or by `verify`:

```sh
bun run installation:migrate -- import-d1 --source source.json --archive migration.encrypted.json --key-file archive.key --bridge https://target-bridge.example --target-database-id TARGET_DB --target-namespace-id TARGET_NAMESPACE
bun run installation:migrate -- import-workspaces --source source.json --archive migration.encrypted.json --key-file archive.key --bridge https://target-bridge.example --target-database-id TARGET_DB --target-namespace-id TARGET_NAMESPACE
bun run installation:migrate -- verify-target --source source.json --archive migration.encrypted.json --key-file archive.key --bridge https://target-bridge.example --target-database-id TARGET_DB --target-namespace-id TARGET_NAMESPACE
```

D1 import uses one atomic batch of complete SQL statements. The adapter bounds D1 import to 32 MiB and 900 statements. A provider limit can still reject the batch. Each Workspace snapshot is bounded to 32 MiB and imports SQL and synchronous KV in one storage transaction. Import rejects a nonempty target; it never clears or overwrites an existing Workspace. Response receipts are followed by full independent reads and content comparison. All target D1 data and migration bookkeeping are checked before and after Workspace import.

A failed or timed-out request is never retried automatically. Keep both stages in maintenance. Use `verify-target` to inspect completed content. A partly completed multi-Workspace import is not a complete Installation and must not be promoted. A new empty target, or a separately reviewed reconciliation, is required if verification fails; this tool does not delete partial targets.

Normal runtime promotion, health/authentication/Conversation journeys, traffic switching, and rollback are separate reviewed operations. Restore the retained credential and Better Auth keys in memory through the existing deployment secret path. Keep the original runtime and namespace until target journeys and content checks pass. External Artifacts repositories, R2 backup/evidence buckets, CI Workflows, containers, and non-Workspace Durable Objects are retained dependencies, not copied by this path. The promotion plan must bind their reviewed retained resources or complete their own migration; creating empty substitutes is not a valid full Installation transfer. Source deletion and cleanup are never part of this tool.

## Local validation

`bun run test:installation-migration` runs real SQLite conversion tests and local Workerd D1/SQLite/KV tests. The composed test covers encrypted archives, valid encrypted Project credentials, independent D1 import, full Workspace content, 64-bit SQLite integers, duplicate/partial manifests, identity drift, active state, authentication, and nonempty-target rejection. These fixtures establish local behavior only.

Cloudflare documents the protected SQL/KV boundary and synchronous storage transactions in its [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), and atomic D1 batches in its [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/). The installed Alchemy migration bookkeeping implementation is `node_modules/alchemy/src/SQL/Migrations/AlchemyFormat.ts`.
