---
target: workspace chat and tool windows
total_score: 22
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
timestamp: 2026-09-04T20-27-51Z
slug: packages-ui-src-components-workspace-workspace-tsx
---

Method: dual-agent (A: /root/design_review; B: /root/detector_review). Source assessment; rendered inspection unavailable.

The workspace makes people manage tools before they can inspect work. Keep conversation as the stable home, with one companion pane for Preview, Changes, and Activity. Preserve the warm dark palette and coral accents.

## Findings

- P1: Seven tool types fragment the workflow. Changes, Review, Checks, and global Accept split one decision. Combine evidence and review around an explicitly selected checkpoint.
- P1: Tab bookkeeping adds no useful capability for singleton tools. Closing the last tab leaves the pane empty; browser tabs share the same browser state. Replace the plus menu and close controls with persistent destinations and one pane toggle.
- P1: Browser refresh, test, expand, and Open in editor controls have no connected action in the inspected surface. The URL field does not navigate. Terminal is a waiting placeholder. Wire supported actions and remove misleading controls.
- P2: Stacked toolbars and a default equal split consume space. Remove the chat header that only holds the pane toggle, and add an explicit expanded inspection mode.
- P2: Mobile uses a fixed overlay without local focus management. Custom tabs lack arrow-key navigation; several controls are 24px. Use a Conversation / Inspect switch and accessible standard controls.

## Proposed interaction

Chat remains mounted and preserves draft and scroll position. The companion pane has Preview, Changes, and Activity; More holds Files and deployment history. Changes includes Working copy / Checkpoint selection, diff, matching checks, review comments, and acceptance with the exact commit visible. Activity contains execution status and logs, without duplicating the conversation. Individual tool calls remain ordered and expandable in chat.

Result links such as View changes, Open preview, and Inspect failure select the relevant evidence directly. Agent progress may update badges but must not steal focus. Desktop supports one resizable companion pane and an explicit expand action. Mobile shows Conversation or Inspect with an obvious return action.

## Heuristic assessment

| Heuristic           | Score /4 | Main issue                                     |
| ------------------- | -------: | ---------------------------------------------- |
| System status       |        3 | Some preview details are misleading            |
| Match to real world |        2 | Tool categories dominate the workflow          |
| User control        |        3 | Too many pane controls                         |
| Consistency         |        2 | Active-looking actions do nothing              |
| Error prevention    |        3 | Acceptance blockers rely on tooltip metadata   |
| Recognition         |        2 | Review evidence is split                       |
| Efficiency          |        2 | Unnecessary window management                  |
| Minimalism          |        1 | Repeated toolbars                              |
| Recovery            |        3 | Useful runtime recovery, weak preview recovery |
| Help                |        1 | Weak contextual guidance                       |
| Total               |    22/40 | Provisional source-based assessment            |

Strengths: persistent conversation, workspace-specific layout state, expandable individual tool calls, cancellation and restart controls, coherent color tokens.

Cognitive load: seven peer tool options; grouping and working-memory failures. Emotional journey: calm start in chat, navigation friction while inspecting, fragmented confidence at acceptance. First-time users must learn Changes versus Review; power users manage redundant tabs; keyboard users lack standard tab navigation.

Minor: the preview defaults to mobile width while its badge says 1440 x 900. File counts repeat.

Detector: exit 0, zero findings, no rule locations or false positives. This does not validate interaction design. Browser: connection refused, then URL policy blocked the generated error page. No screenshot, overlay, or production verification. Storybook stopped and debug log removed; browser tab cleanup also hit the policy block. Ignore list absent. First baseline; no trend comparison.

Validation for implementation: open result evidence in one action; inspect and accept a checkpoint without changing destinations; maintain draft/scroll on view changes; avoid automatic focus changes; verify keyboard and narrow-screen navigation.

Questions skipped: the user requested an assessment and concrete recommendation; no further input is needed to deliver it.
