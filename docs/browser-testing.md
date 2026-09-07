# Agent browser testing

The built-in OpenCode agent uses `workspace_browser` to test the current Checkpoint Preview through Cloudflare Browser Run. It can click, fill fields, select options, press keys, scroll, reload, wait for elements, and assert results. No additional agent or model is required.

Finish the current Check first. Unsaved changes, older Checkpoints, pending Checks, and changed Check attempts cannot be used as current-change evidence.

Start a session:

```json
{ "action": { "type": "start" } }
```

Use `session.id` from the result as `sessionId` on subsequent actions. Each call returns page text, controls, accessibility, its sequence, and screenshot Evidence. Observe the page to choose CSS selectors; interactions require exactly one matching element.

```json
{"sessionId":"<returned id>","action":{"type":"fill","selector":"#title","value":"Test todo"}}
{"sessionId":"<returned id>","action":{"type":"click","selector":"#create"}}
{"sessionId":"<returned id>","action":{"type":"wait","selector":".todo","state":"visible"}}
{"sessionId":"<returned id>","action":{"type":"assert","assertion":{"type":"text","selector":".todo","value":"Test todo"}}}
{"sessionId":"<returned id>","action":{"type":"reload"}}
{"sessionId":"<returned id>","action":{"type":"assert","assertion":{"type":"count","selector":".todo","value":1}}}
{"sessionId":"<returned id>","action":{"type":"close"}}
```

Assertions support exact trimmed text, field value, element count, checked state, and visibility. A failed action or assertion has `outcome: "failed"`; its evidence is retained and the conversation shows a failure. An observation or screenshot alone does not mark a journey as passed. The built-in Check's browser stage still verifies rendered Checkpoint identity.

Cookies and local storage remain in the remote browser across calls, reloads, and Workspace runtime restarts. Sessions expire after ten idle minutes. An expired or lost session does not replay an action or silently open a new unauthenticated page. Start again and sign in with the test account. Closing a session discards its login state; archiving the Workspace closes it too.

This tool tests a single page on the Preview origin. External OAuth redirects and popups are unsupported. The Preview iframe is a separate browser context; its login is not transferred to Browser Run. Browser page content is untrusted input to the agent.

Run the [Browser Run smoke](../tools/browser-smoke/README.md) for deployed interaction proof. The OpenCode Workerd smoke also verifies dispatch and output handling using deterministic browser results.
