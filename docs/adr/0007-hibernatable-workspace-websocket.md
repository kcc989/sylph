# Use one Hibernatable WebSocket for each Workspace browser tab

The Workspace browser uses one authenticated WebSocket accepted by the Workspace Durable Object with the Hibernatable WebSocket API. The Website Worker checks the session and Organization membership before it forwards the upgrade with private actor headers. The object stores the actor, writable state, connection time, session, and replay cursor in the socket attachment. User tags support presence, per-user connection limits, and access revocation.

Frames are schema-defined in `@workspace/domain`. The browser sends `hello` with its OpenCode session and last durable sequence. The object replays `sessions.log`, filters events at or below the cursor, then joins one shared live subscription. Events received during replay are buffered until `synced`. Pending permission prompts are listed again at connect because they are ephemeral. Check updates use the same event frame, so the browser does not poll.

Prompt, cancel, permission reply, and question reply remain server functions and Durable Object RPC. Terminal frame variants reserve the protocol shape, but terminal bytes will use a separate sandbox WebSocket after the terminal lifecycle is defined. The OpenCode host and its live subscription can still keep an object active. Lazy runtime boot and a durable permission bridge are separate requirements before duration billing can prove idle hibernation.

This decision supersedes the final sentence of ADR 0004. ADR 0004 remains the rule for mutations and first-party backend surfaces.
