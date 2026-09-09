# Historical verification records

These reports record tests and investigations of earlier revisions. A passing result applies only to its recorded source, stage, fixture, and scope. Pending tasks, browser sessions, URLs, local paths, and approvals may be stale. Do not use archived commands as current operating instructions.

Use the [current guides](../README.md) and [release smoke runbook](../../tests/release-smoke/README.md) for new work. Preserve an existing fixture until its state and cleanup authorization have been checked.

## Smoke reports

- [Cursor subscription through OpenCode](smoke-tests/cursor-provider-2026-09-08.md)
- [Cursor provider registration verification — 2026-09-08](smoke-tests/cursor-registration-2026-09-08.md)
- [E2E verification handoff — 2026-09-08](smoke-tests/e2e-handoff-2026-09-08.md)
- [Gap 6 concrete actions](smoke-tests/gap6-actions-2026-09-07.md)
- [Gap 6 implementation and evidence](smoke-tests/gap6-readiness-2026-09-07.md)
- [Grok workspace failure, 4 September 2026](smoke-tests/grok-workspace-2026-09-04.md)
- [OpenCode recovery and resource verification](smoke-tests/runtime-reliability-2026-09-04.md)
- [Sandbox agent and D1 todo smoke, 6 September 2026](smoke-tests/sandbox-agent-2026-09-06.md)
- [Todo app smoke test, 4 September 2026](smoke-tests/todo-2026-09-04.md)
- [Isolated todo smoke test, 4 September 2026](smoke-tests/todo-isolated-2026-09-04.md)
- [Todo reliability smoke test, 4 September 2026](smoke-tests/todo-reliability-2026-09-04.md)
- [Workspace companion smoke test, 4 September 2026](smoke-tests/workspace-companion-2026-09-04.md)

The Cursor provider report includes retired HTTP/2 and patched implementations. The registration report records later container and native-shell tests. The E2E handoff predates those results. These reports do not verify the current full lifecycle.

## Service and UI evidence

- [Lifecycle integration report](verification/e2e-gap-closure.md): source-specific local checks and Browser Run service results.
- [Initial browser fixture](verification/browser-service-smoke.json): DOM-only service evidence.
- [Follow-up browser fixture](verification/browser-service-followup-smoke.json): screenshot and coordinate service evidence.
- [Project operations report](verification/project-operations.md): local tests and synthetic UI screenshots ([desktop](verification/project-operations-desktop.png), [mobile](verification/project-operations-mobile.png)).

Fixture JSON is unchanged and tests the policy at its recorded commit. It includes older acceptance rules. The screenshots show synthetic UI fixtures, not live production telemetry.
