# Codex subscription smoke

Stage: `codex-smoke-0b1a-0905`

Workspace: https://sylph-website-codex-smoke-0b1a-0905-lfpxlp7v2bic4pye.apingot.workers.dev/projects/codex-subscription-smoke/workspaces/e5d2d298-d825-4875-8bd8-050c70bf1936

Verified on 2026-09-05 with the connected personal ChatGPT subscription and `openai/gpt-5.6-sol`:

- Direct Workerd requests returned an HTML 403 page identifying the shared cross-zone Worker address.
- The anonymous Node Container probe reached the same endpoint and returned JSON 401.
- The private Container fallback returned HTTP 200 and `CODEX_CONTAINER_OK` in the workspace conversation.
- The agent read `package.json`, wrote `CODEX_SMOKE_PROOF.txt`, and read back `CODEX_SUBSCRIPTION_SMOKE_OK_0b1a`.
- The file inspector independently showed the persisted marker.
- The cleaned runtime was redeployed as Worker version `90a06cc7-23bc-4717-883d-4eb5ed021fb4`; a new turn read the proof file and check status successfully after restart.
- The agent started check `check-608924d9-f694-4059-942b-eeebb3b2ef75`. After a sandbox reset during deployment and an explicit workflow restart at 02:56:58 UTC, installation and the combined typecheck, lint, test, and build verification passed. Preview deployment then failed because the template could not load `@effect/platform-node/NodeServices` from Alchemy. No passing preview or browser check is claimed.

The fallback applies only to HTML 403 responses from the exact Codex Responses endpoint. The Container is accessed through a private Durable Object binding, forwards a fixed header allowlist to a fixed upstream, does not follow redirects, and does not persist credentials. Other provider requests keep their existing transport. This implementation still makes one rejected Workerd request before each Container fallback.

`probe.ts` and its separate Alchemy stack are the anonymous diagnostic probe, not the authenticated transport. The authenticated implementation is in `apps/web/src/server/codex-container.ts` and `codex-container-response.ts`.

Deploy with Alchemy using an external stage environment file. Do not commit credentials. This stage is isolated; production has not been deployed.

## Isolated cause of the 403

A local credential-free curl test on 2026-09-05 kept the endpoint, request body, process environment, and network fixed:

| Request | Result |
| --- | --- |
| No CF-Worker header | 401 application/json, Unauthorized |
| CF-Worker: sylph-smoke.workers.dev | 403 text/html, Unable to load site |
| No CF-Worker header again | 401 application/json, Unauthorized |

Adding the header alone is sufficient to reproduce the rejection before successful authentication. This narrows the earlier egress hypothesis: a different IP or TLS client is not necessary to trigger this failure. The exact internal OpenAI filtering rule remains unobservable.

Cloudflare documents that fetch subrequests acquire CF-Worker automatically: https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-worker

An independent authenticated experiment reports 200 without the header and 403 with it, and unsuccessful attempts to remove the runtime-added header: https://github.com/ColeMurray/background-agents/issues/1374

The private Container creates a fresh Node request with an explicit header allowlist that excludes CF-Worker. The successful authenticated smoke turn verifies that path.
