# External template releases

The template lives in `kcc989/sylph-tanstack-template`. Sylph stores its immutable release pin in `packages/domain/src/template-release.ts`. A pin change affects new Projects only. Existing Projects retain their source and accepted Checkpoints; Sylph does not apply template updates to them.

After committing a candidate in the external repository, verify its scripts, resource plan, tests and build. The local candidate checker compares shared recovery modules with their recorded platform sources and applies the template migrations to a fresh SQLite database to verify the recovery schema and initial writer gate. It writes commit references and source hashes only. It does not generate patches, update Projects, publish the candidate or change the built-in pin.

Use clean, committed checkouts:

```sh
bun tools/template-contract/candidate.mjs \
  /private/tmp/platform-checkout \
  /private/tmp/starter-checkout \
  0.3.0 \
  /private/tmp/reviewed-starter-metadata
bun tools/template-contract/verify.mjs /private/tmp/starter-checkout
```

Review `candidate-sources.json` when shared modules change. It records each source path and any exact import rewrite needed by the standalone template. The resulting `template-candidate.json` records the external candidate commit and verified provenance with `published: false`.

After publication approval, publish the reviewed external commit, verify the remote hash and update the built-in release pin. CI checks the pinned external repository directly. No template source patches are stored in Sylph.
