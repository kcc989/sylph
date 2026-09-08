# Real partial cleanup proof

This helper adds a temporary R2 retention rule to an existing disposable Preview bucket. It does not create resources, change ownership rows, or manufacture provider receipts. Resource deployment and deletion remain with the existing Alchemy and Sylph lifecycle paths.

Cloudflare documents that [bucket locks prevent object deletion](https://developers.cloudflare.com/r2/buckets/bucket-locks/) and that removing a rule uses the [bucket lock configuration API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/locks/methods/update/). The helper uses a Date condition that expires two hours after planning. Remove the rule after the failed cleanup; do not rely on expiry to remove the bucket configuration.

1. Deploy the integrated smoke installation. Run the lifecycle journey through concurrent Previews. Use the oldest retained Preview with the `FILES` application bucket and its `lifecycle-proof.txt` object, created through the application UI.
2. From that run's observed inventory, write `target.json` with `accountId`, `databaseId` (the installation database), `projectId`, `scope` (`preview:<check-id>:<attempt>`), `runId` (the original CI Workflow), and `bucketName`.
3. Prepare a read-only plan:

   ```sh
   bun scripts/cleanup-lock.ts plan --target /private/tmp/target.json --plan /private/tmp/cleanup-lock-plan.json
   ```

4. Inspect the exact bucket, account, scope, generation, and expiry. After approval for the disposable Preview failure experiment, install the rule:

   ```sh
   bun scripts/cleanup-lock.ts install --plan /private/tmp/cleanup-lock-plan.json --confirm-bucket EXACT_BUCKET --receipt /private/tmp/cleanup-lock-installed.json
   ```

5. Use the application Settings UI to clean up that Preview and confirm its exact scope and original run. Wait for the maintenance Workflow to exhaust its retries and stop. Preserve the actual Workflow error and the inventory showing both removed resources and the remaining R2 bucket. A lock receipt alone is not proof of partial cleanup.
6. Remove only the planned retention rule:

   ```sh
   bun scripts/cleanup-lock.ts remove --plan /private/tmp/cleanup-lock-plan.json --confirm-bucket EXACT_BUCKET --receipt /private/tmp/cleanup-lock-removed.json
   ```

7. Run the journey's `partial-failure-cleanup` action. It must use the actual Retry cleanup UI, verify provider absence, and verify retained production data. Do not rewrite Workflow state or mark a proof phase as successful by hand.

`remove` also permits early recovery if the experiment stops before cleanup. It rejects a replaced bucket or modified experiment rule and preserves unrelated rules. Run the helper without concurrent bucket configuration edits: Cloudflare's replace-all lock API does not provide a compare-and-swap precondition. Each invocation loads only the configured smoke credential file; the plan and receipt contain no token. Receipt files must use fresh paths.

## Resource ownership audit

The current resource remover checks all Worker bindings and Queue consumers before deletion. Queue consumers must be detached by deploying a change to the owning Alchemy stack. A standalone Durable Object class deletion needs that Worker stack's migration. Deleting an entire verified host Worker with its namespace claims is the supported resource retirement path; recovery control namespaces remain independently owned.

These are real ownership constraints. A generic consumer-delete API or raw namespace deletion would bypass the stack state. A complete UI operation needs a persisted application source change, an Alchemy deployment, provider verification, and then resource retirement. The cleanup lock experiment does not implement or claim those separate operations.
