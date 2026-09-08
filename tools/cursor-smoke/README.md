# Local Cursor provider probe

Run from the repository root with Node 24:

```sh
node tools/cursor-smoke/run.mjs --login --diagnostics
```

The script uses the installed, unmodified `cursor-opencode-provider` directly. It does not start Sylph, OpenCode, Workerd, or a Cloudflare container. It creates a temporary package.json fixture and tests a text response followed by a read-tool response. Credentials remain in process memory. The script does not read the deployed connection or the smoke environment file.

Use `--model=<id>` to select another advertised Cursor model. The default is `grok-4.6`. Existing `CURSOR_API_KEY` or `CURSOR_ACCESS_TOKEN` environment variables can replace browser login. Never put credentials in command arguments or commit them.

`--diagnostics` observes incoming HTTP/2 data through [Node's diagnostics channel](https://nodejs.org/download/release/v24.16.0/docs/api/diagnostics_channel.html). It prints only the code and message from a [Connect terminal error envelope](https://connectrpc.com/docs/protocol/). It does not alter provider requests, log authorization headers, or dump model response frames. Omit the flag for the smallest reproduction.

A four-minute process deadline keeps Node alive while the provider uses unreferenced handles. Each probe also receives a 90-second abort signal. A successful tool probe must actually read the fixture and report its package name; HTTP 200 or an unfinished stream does not pass.

## Recorded result, 2026-09-08

Node v24.16.0, unmodified cursor-opencode-provider 0.6.6, model grok-4.6, browser OAuth using the same Cursor account as the deployed fixture:

```json
{"test":"text-only","passed":false,"name":"CursorServerError","code":"invalid_argument","message":"Cursor API error (code=invalid_argument)"}
{"test":"read-tool","passed":false,"name":"CursorServerError","code":"invalid_argument","message":"Cursor API error (code=invalid_argument)"}
```

The incoming Connect envelope in both cases contained code `invalid_argument` and message `Error`. This reproduces the rejection without Sylph, OpenCode, or Cloudflare. It does not yet distinguish a provider protocol defect from model/account/backend behavior. Authentication and model discovery succeeded.

A no-tool request intentionally omits the OpenCode session header. With that header, the upstream provider waits for a sibling request to publish the session's tool catalog; that is not a standalone text probe. Read-tool continuations retain one session identity.
