# Sandbox agent execution

OpenCode runs in `WorkspaceDO`, exported by the app Worker. There is no separate OpenCode Worker. Native file and search tools use the durable Workspace filesystem; Linux commands run in a dedicated Cloudflare Sandbox.

## Files and commands

Commands run one at a time per Workspace. Before each command, Sylph copies durable files and Git metadata to the sandbox. After exit, including failure, it imports tracked and unignored source changes that pass synchronization checks. Dependencies and ignored build output stay in the sandbox unless they were already in the input snapshot. If both the command and the product changed a file to different contents, synchronization rejects the conflict.

Synchronization accepts regular files only, with limits of five MiB per file and 50 MiB per snapshot. Invalid paths, symlinks, unsupported file types, and exceeded limits prevent the command result from being imported.

Shell Git commits are temporary. Use the Checkpoint action or `workspace_checkpoint` to save a durable commit. Sylph also supplies `skill_read_resource`, `workspace_run_checks`, `workspace_sync_project`, `workspace_preview`, and `workspace_browser`.

Native edit and shell permissions approve Workspace changes by default. The sandbox receives selected terminal and locale variables, without the Worker's infrastructure credentials. Production deployment requires a product action.

The sandbox can sleep after five idle minutes; its dependency cache is disposable. A pending command record lets a new Durable Object instance wait for the process and import its result before starting another command. It does not guarantee that external side effects occur exactly once. Missing results or conflicting edits stop further commands and preserve unsaved work.

Commands stop after ten minutes or when combined stdout and stderr exceed eight MiB. Output is returned after completion. Exceeding the output limit returns exit code 125. Interactive stdin and additional file descriptors are unsupported. Use shell syntax for pipelines. OpenCode's foreground tool timeout is separate.

## Checks and dependencies

Agent and Check commands share the process runner for environment selection, deadlines, process-group cancellation, exit codes, and output limits. CI checks an immutable Checkpoint in a separate sandbox and records each stage's result. Verification commands receive no deployment credentials; Preview and production commands use the deployment environment.

Install dependencies with native `bun install`. The retired dependency-repair Workflow accepts no new jobs or retries. Its body, schemas, and idempotent callback remain so existing jobs can finish. Remove that compatibility code only after those jobs finish. Correct dependency failures in the shell, then save a Checkpoint and run a Check.

Automatic Check repair is off by default. With `autoRepair: true`, a failed Check starts a normal agent Turn with the exact Checkpoint and diagnostics. The agent fixes the cause and runs Checks again. Each Workspace allows three consecutive repair Turns; a new User message or passing Check resets the count. Successful Checks and production Deployments do not start Turns. The count and delivery receipts are durable. See [ADR 0008](adr/0008-workspace-owned-check-loop.md).

## Conversation updates

OpenCode controls session execution and inbox state. The domain event policy selects which events reach the browser and which snapshots to refresh. Event bursts, reconnect recovery, and active-state polling share one refresh queue. The socket advances its replay cursor only after applying an event. Polling recovers missed terminal events.

Consecutive completed inspections, file changes, and commands appear in expandable summaries. Messages, failures, active calls, and product actions retain their positions. Each expanded call keeps its input, output, and inspection link. Grouping makes no model requests.

## Verification

Tests cover real local processes and native tools in Workerd. The optional D1 todo scenario in the [release smoke runbook](../tests/release-smoke/README.md) tests the deployed Sandbox and D1 lifecycle. Local tests alone do not verify that lifecycle.
