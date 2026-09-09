# Browser journeys and acceptance

`workspace_browser` and the Browser tab control the same persistent Cloudflare Browser Run session. The application iframe has a separate browser context; actions there do not count as journey evidence.

Browser evidence is optional. Request a Preview, then select **Browser Run** to use the shared session. Select **Capture browser evidence** when needed. A Check alone does not create a Preview or start a browser.

## Required journeys

Acceptance requires browser evidence only when a User configures required journeys. The policy specifies named journeys, ordered assertions, desktop/mobile viewports, and a reason. A policy change records the User and time, closes the browser, and requires new evidence. An empty policy adds no requirement.

Each result records the Workspace, Conversation, Check ID, attempt, commit, policy revision, and browser session. A journey must pass every assertion at each required viewport and finish on the Preview. A change to any recorded binding invalidates the result. An unrelated verification Check does not invalidate Preview evidence.

```json
{"requestId":"start-1","action":{"type":"start"}}
{"requestId":"journey-1","sessionId":"<session>","action":{"type":"journey_begin","requirementId":"<policy journey id>"}}
{"requestId":"fill-1","sessionId":"<session>","action":{"type":"fill","selector":"#title","value":"Test todo"}}
{"requestId":"save-1","sessionId":"<session>","action":{"type":"click","selector":"#save"}}
{"requestId":"assert-1","sessionId":"<session>","action":{"type":"assert","assertion":{"type":"text","selector":"#saved","value":"Saved"}}}
{"requestId":"mobile-1","sessionId":"<session>","action":{"type":"viewport","viewport":"mobile"}}
```

Repeat the assertions at each viewport, then call `journey_finish`. Desktop is 1440 × 900; mobile is 390 × 844. The browser verifies these dimensions and stores each assertion's Evidence, sequence, and viewport. Screenshots and observations alone do not complete a journey.

Policies require screenshots and accessibility Evidence by default. A User can choose **DOM testing (no screenshots or pointer checks)** and record a reason. That creates a new policy revision. DOM-only mode checks cookies, navigation, viewport dimensions, and ordered assertions. Selector clicks use `HTMLElement.click()`; waits poll DOM state. Coordinate clicks are rejected. The UI shows text and selector controls. This mode does not test appearance or pointer hit targets.

The browser keeps its rendering connection and navigation checks active between actions. It no longer freezes and resumes the page, which caused screenshot timeouts.

## Failures and retries

A failed action or assertion fails the attempt. Start a new attempt and repeat the required assertions. With required journeys configured, a failure outside a named journey requires all journeys to be repeated or a User exception. Closing, expiring, reconnecting, or interrupting the browser cannot complete an unfinished journey. Failed Evidence storage also prevents a pass. Results and failed attempts remain stored.

Use a unique `requestId` for each action; observation can omit it. Retrying the same ID and input returns the saved result. Changed input or Check binding is rejected. Pending actions are not replayed: inspect the page before starting another attempt. Human controls include the observed sequence to reject clicks on outdated screenshots.

A User exception records the reason, exact binding, and event order. Later actions can invalidate it. Agents cannot change policy, record exceptions, or take control from a User. Before merging, Acceptance rechecks evidence in the browser action queue, closes the browser, and reserves the Workspace.

## Human control and authentication

Select **Take control** to use the shared browser. The agent can observe but cannot change, restart, or close it. **Release to agent** keeps the same session and cookies. Input goes to the remote page. Action receipts store input fingerprints, not field values; page text, accessibility data, and screenshots remain Workspace Evidence.

Navigation allows the Preview origin by default. A User can add exact public HTTPS origins for sign-in, redirects, and popups. Wildcards, URL credentials, ports, local names, and IP literals are rejected. New popup pages are paused and checked before navigation. Read `pages`, then call `switch_page` with an observed page ID. `popup` opens an allowed URL in the same context. Arbitrary JavaScript is not supported.

The Durable Object retains the browser connection and navigation interceptor. Tabs use a Chromium context with `disposeOnDetach: true`; navigation checks remain active while idle. Closing the connection destroys the context. A reconstructed Workspace service can reuse a retained browser connection, but a new Durable Object instance cannot recover the login. Sessions close after ten idle minutes. After expiry, start a session and sign in again.

Sylph does not issue transferable [Live View](https://developers.cloudflare.com/browser-run/features/live-view/) URLs. Human actions use Workspace access checks and navigation policy. Screenshots update after each action; video streaming and iframe login transfer are not supported. If an identity provider rejects Browser Run traffic, the sign-in journey remains failed or incomplete.

Run the [Browser Run smoke](../tools/browser-smoke/README.md) to test a specific source revision. Its fixture tests external sign-in and popups, not a real identity provider's OAuth protocol.
