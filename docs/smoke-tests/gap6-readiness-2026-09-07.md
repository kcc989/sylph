# Gap 6 implementation and evidence

Branch: `codex/e2e-proof`. Base: `301860e7b33af5dfb68b14e04148bb2681709b7b`.

The built-in template remains `kcc989/sylph-tanstack-template` at `bed6b52785eab6e79680041ee1367f2831f59296` (0.1.1). This branch does not publish or change the template. No fresh combined stage was deployed. No final integrated source commit has been verified.

Implemented:

- Clean source/template/stage identity recording and a stage-only deployed identity endpoint. Tests cannot run from a different or dirty checkout.
- A combined phase runner with tracked action hashes, exact approval digests, one attempt per phase, recorded failures, actual Cloudflare API probes and hashed browser/provider evidence. A complete report requires all twelve paths with matching identities and evidence.
- Encrypted earlier-Installation D1 preservation, identity and old credential-key checks, verified local import, retained Worker deployment/namespace inventory, and explicit nonportable state boundaries.
- Operator and integration runbooks. The earlier Installation is retained; the reset schema is not replayed over it.

Local verification:

| Check                                                           | Result                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Frozen dependency installation                                  | Passed                                                                                                                           |
| Focused release-smoke tests                                     | 41 passed, 0 failed                                                                                                              |
| Full `bun run test`                                             | Passed; initial sandbox attempt failed at a loopback HTTP/2 listener, approved retry passed                                      |
| `bun run typecheck`                                             | Passed                                                                                                                           |
| Oxlint / Oxfmt / `git diff --check`                             | Passed                                                                                                                           |
| `bun run build`                                                 | Passed                                                                                                                           |
| D1 archive/import round trip                                    | Local SQLite fixture passed, including binary content, credential decryptability, schema/content hashes and refusal to overwrite |
| Wrong-key / tampered archive / mismatched identity / unsafe SQL | Rejected by local tests                                                                                                          |

Cloudflare evidence: `smoke:release:doctor -- --auth magic` loaded the existing saved configuration and returned `Cloudflare account: accepted`. The first network request was sandbox-blocked; the standard approved retry succeeded. This proves saved account access only. The saved configuration was not sourced, printed or copied into the checkout.

Outstanding work:

1. Integrate all relevant implementation branches, publish the compatible starter after explicit approval, and record the exact integrated source/template commits.
2. Implement the concrete scenario action files against those final APIs and selectors. The general runner is not a substitute for those actions. Review every probe against the required observations in `tests/release-smoke/COMBINED.md`.
3. Deploy a fresh stage using Node 24, open it and execute the approved paths. Model generation must use the persistent bounded budget; no inference retry was run here.
4. Prepare exact production/failure/restore/undo/cleanup targets and obtain explicit approval immediately before those actions. No such live action was executed here.
5. Supply the earlier Installation's actual source descriptor and private key configuration before real D1 capture. Local fixture round trips do not establish live preservation. Verify old Workspace files/transcripts/pending state through the retained old runtime.

The combined lifecycle and a live earlier-Installation transition remain **unverified**. The new D1 archive is not a complete Installation backup and does not convert the old schema into the reset schema.
