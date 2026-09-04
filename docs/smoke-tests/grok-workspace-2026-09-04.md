# Grok workspace failure, 4 September 2026

Workspace: `dd187dd2-f970-49aa-9bf1-a9f64416a950` (`quiet-otter`) in Project `test2`, stage `companion-smoke-0904`.

The request failed before file changes with `Provider returned error`. A minimal request to `x-ai/grok-4.6` with the same configured OpenRouter key succeeded. Preserving OpenRouter's nested provider error exposed the actual rejection: `skill_read_resource: tool parameter root must be an object type (root schema is a $ref)`.

The shared domain converter emitted named Effect schemas as root references. It now inlines nonrecursive schemas and emits explicit object schemas for empty tool arguments. Tests cover the roots of all 15 exported workspace tool schemas. OpenRouter errors now preserve the upstream message with credential redaction.

A deployed retry with Grok passed the provider boundary and called `workspace_list_files` with directory `.`. This exposed a second defect: the tool added a slash after normalizing the root to an empty path, filtering out every file. The agent then proposed replacing the starter setup. That turn was interrupted before write permissions were approved.

Directory filtering now lives in `WorkspaceFilesystem.listWorkingFiles`, after path normalization. Tests cover root aliases, subdirectory isolation, and rejection of paths outside the workspace.

Local validation: 58 domain tests, 13 filesystem tests, 4 provider-response tests, web typecheck, lint, and formatting passed. Both fixes were deployed through Alchemy to the existing isolated stage. Production was not changed.

Final live verification in the same workspace with Grok 4.6 passed: `workspace_list_files` with directory `.` completed and found the starter files; `workspace_read_file` successfully read `package.json` and `src/routes/index.tsx`. The agent identified the existing TanStack Start template correctly and completed the diagnostic turn without a provider error or file changes. The earlier proposed replacement files were never approved.
