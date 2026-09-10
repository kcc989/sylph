# Use one Hibernatable WebSocket per Workspace browser tab

The app Worker checks the session and Organization membership, then forwards the WebSocket upgrade to `WorkspaceDO` with private actor headers. The object accepts it through the Hibernatable WebSocket API. Its attachment stores the actor, write access, connection time, session, and replay cursor. User tags support presence, connection limits, and access revocation.

Frames use schemas from `@workspace/domain`. The browser sends `hello` with its OpenCode session and last durable sequence. The object replays newer `sessions.log` events, then joins one shared live subscription. It buffers live events during replay until `synced`. It lists pending permission prompts again on connection because they are not durable. Check updates use the same stream; active-state polling recovers missed terminal events.

Prompts, cancellation, and permission and question replies use server functions and RPC. Reserved terminal frames do not implement a terminal; terminal bytes will need a separate sandbox WebSocket. OpenCode and its live subscription can keep the object active. The runtime now boots lazily on an operation or socket hello. Durable permission storage and a bounded live-subscription lifetime are still needed before idle hibernation can be verified through duration billing.

This replaces the earlier SSE transport in [ADR 0004](0004-server-function-middleware-and-durable-object-rpc.md). Product mutations still use server functions and typed RPC.
