# Browser journeys and acceptance

`workspace_browser` uses the Workspace's persistent Cloudflare Browser Run. The Browser tab can operate that same remote page. The application iframe is a separate context; its activity does not count as journey proof.

A passing Check verifies the homepage's rendered Checkpoint identity. Acceptance also requires a User-configured browser policy. In the Browser tab, set named journeys, ordered assertions, required desktop/mobile viewports, and a reason. Each policy revision records the User and timestamp and closes the old browser. Empty policies block acceptance until a User records an explicit exception.

Every journey result is bound to the exact Workspace, Conversation, Check ID, attempt, commit, policy revision, and browser session. A journey must pass all required assertions at every required viewport and finish on the application Preview. Changing a Check attempt, commit, Conversation, or policy makes older proof inapplicable. A newer failed Check cannot fall back to an older passing Check.

```json
{"requestId":"start-1","action":{"type":"start"}}
{"requestId":"journey-1","sessionId":"<session>","action":{"type":"journey_begin","requirementId":"<policy journey id>"}}
{"requestId":"fill-1","sessionId":"<session>","action":{"type":"fill","selector":"#title","value":"Test todo"}}
{"requestId":"save-1","sessionId":"<session>","action":{"type":"click","selector":"#save"}}
{"requestId":"assert-1","sessionId":"<session>","action":{"type":"assert","assertion":{"type":"text","selector":"#saved","value":"Saved"}}}
{"requestId":"mobile-1","sessionId":"<session>","action":{"type":"viewport","viewport":"mobile"}}
```

Repeat the required assertions at each viewport, then call `journey_finish`. Desktop is 1440 × 900; mobile is 390 × 844. The browser checks actual viewport dimensions and saves each assertion's Evidence with its sequence and viewport. Screenshots and observations alone cannot complete a required journey.

Policies require screenshots and accessibility Evidence by default. A User can explicitly select **DOM assertions only (no screenshots)** and record a reason. This creates a new policy revision and requires new proof. DOM-only mode still uses the actual browser, cookies, guarded navigation, viewport dimensions, and ordered assertions. It does not verify visual appearance. The UI shows page text and selector controls without a stale screenshot.

On September 7, 2026, the deployed smoke reproduced a Browser Run limitation: `Page.captureScreenshot` timed out after `Page.setWebLifecycleState` freeze/resume, even with Cloudflare's client alone and no disconnect or Sylph guard. DOM and accessibility reads worked. Repainting the viewport did not restore capture. Required-screenshot policies fail closed; DOM-only mode is explicit policy handling for supported journeys. The diagnostic evidence is recorded in smoke stage `smoke-browser-mtrvv2f3`, commit `043cf7a`, and the repaint comparison in `smoke-browser-mtrvxu51`, commit `63df582`.

A failed assertion or action invalidates that attempt. Start a new journey attempt and repeat its required proof. Failures outside a named journey also block acceptance until required proof is repeated or a User records an exception. Starting another journey, closing the browser, expiry, failed reconnect, failed Evidence storage, or interruption cannot turn incomplete proof into a pass. Results and failed attempts remain in durable storage.

Use a unique `requestId` for every action except an optional observation. Retrying the same input and ID returns its saved result. Changing that input or its Check binding is rejected. A pending receipt is never replayed: observe the page and begin a new attempt after checking its state. Human controls also send the observed sequence to prevent a click on an outdated screenshot.

A policy exception records the User, reason, exact binding, and event order. Later activity can invalidate it. Agents cannot configure policy, record exceptions, or take control away from a User. Acceptance rechecks browser proof in the same serialized queue as browser actions, closes the browser, and reserves the Workspace before merge creation.

# Human control and authentication

Start the shared browser or select **Take control**. The agent can observe while human control is active, but it cannot mutate, restart, or close the session. The Browser tab sends clicks, field input, keyboard actions, viewport changes, and assertions through the same service. **Release to agent** returns control without transferring or recreating cookies. Text typed here goes to the actual remote page. Receipts keep input fingerprints rather than field input. Page-visible content, accessibility, and screenshots remain normal Workspace Evidence.

Navigation defaults to the Preview origin. Only a User can add exact public HTTPS origins to the browser policy. These can be used for external test-account sign-in, redirects, and popups. Wildcards, credentials in URLs, ports, local names, and IP literals are rejected. New popup documents are paused and guarded before navigation. Observe the returned `pages`, then use `switch_page` with an observed page ID. `popup` opens an explicitly allowed URL in the same browser context. No arbitrary JavaScript is exposed.

The browser stops pending navigation and freezes pages before disconnecting, then installs navigation guards before resuming. This preserves cookies across reconnects without permitting unattended navigation between calls. Long-running background activity may need another explicit action or wait. Sessions expire after ten idle minutes. Start again and sign in with a test account after expiry.

Cloudflare also offers [Live View](https://developers.cloudflare.com/browser-run/features/live-view/). This implementation does not mint transferable Live View control URLs: human actions stay behind Workspace authorization, ownership, ordering, and navigation policy. It is an action-driven shared browser, with an updated screenshot after each action. It does not stream video or transfer the application iframe's login. External identity providers can still reject Browser Run traffic; a blocked provider is a failed/incomplete journey, not proof of successful OAuth.

Run the [Browser Run smoke](../tools/browser-smoke/README.md) for exact-source runtime evidence. The fixture tests external sign-in and popup mechanics, not a real identity provider's OAuth protocol.
