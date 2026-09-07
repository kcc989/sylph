# Sandbox agent execution

OpenCode runs in the Workspace Durable Object. Its workspace provider starts Linux commands in a dedicated Cloudflare Sandbox. The native file and search tools continue to use the durable Workspace filesystem.

Before each command, Sylph copies the durable files and Git metadata to the sandbox. After exit, including a nonzero exit, it saves tracked and unignored source changes. Dependencies and ignored build output remain in the sandbox. Changes to files edited concurrently in the product cause a conflict instead of an overwrite. Commands are serialized per Workspace.

Sylph owns durable Checkpoints and Repository synchronization. Shell Git commits are temporary sandbox state. Use the Checkpoint action or workspace_checkpoint for durable commits. The remaining agent tools are skill_read_resource, workspace_checkpoint, workspace_run_checks, workspace_sync_project, workspace_preview, and workspace_browser.

OpenCode's native edit and shell permissions auto-approve Workspace mutations by default. The sandbox receives a small set of terminal and locale variables, never the Worker's infrastructure credentials. Production deployment remains a product action.

The sandbox can sleep after five idle minutes. Its dependency cache is disposable. A pending command record lets a new Durable Object instance wait for the existing process and import its result before another command starts. This is not an exactly-once guarantee for external command side effects. Missing results or conflicting source changes stop further commands rather than discard unsaved work.

Commands have a ten-minute limit and eight MiB of captured output. Output is returned after the process finishes. Interactive stdin and additional file descriptors are not supported. Use shell syntax for pipelines. These limits are separate from OpenCode's foreground tool timeout.

Verification includes local real-process tests, a Workerd native-tool fixture, and the optional deployed D1 todo scenario in tests/release-smoke/README.md. Only the deployed scenario proves the full Cloudflare Sandbox and D1 lifecycle.

The conversation groups consecutive completed inspections, file changes, and commands into expandable action summaries. Text messages, failures, active calls, and distinct product actions keep their original positions. Expanded summaries retain every call's input, output, and inspection link. Grouping uses recorded tool data and makes no model requests.
