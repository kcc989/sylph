# Starter candidate and Project upgrades

Candidate generation is local. It does not publish the external repository, update the built-in pin, or edit accepted Project history.

Wait until the starter changes are committed and its working tree is clean. Commit the platform source changes too. Review `candidate-sources.json` before generation. Every vendored module and recovery migration needs an exact mapping. Add the R2 module, domain, and additive migration when those files land; include the R2 control schema in `controlSchemas`. The only allowed source rewrites are the listed import specifiers. Oxfmt checks the resulting TypeScript bytes against the committed starter.

`recovery-migrations/0001-recovery.sql` remains mapped to the historical platform commit that shipped it. Do not remap it to today's combined `control.sql` or rewrite that published migration. The group migration maps to `control-upgrade.sql`; later changes append another migration. The generator applies the ordered starter migrations to SQLite and compares the resulting canonical schema and initial writer gate with fresh platform control schemas. It separately rejects modification or deletion of every migration present in the previous published starter.

Run with exact immutable base and previous published commits, a candidate version, and an output directory outside both checkouts:

```sh
bun tools/template-contract/candidate.mjs \
  /private/tmp/platform-checkout \
  /private/tmp/starter-checkout \
  bed6b52785eab6e79680041ee1367f2831f59296 \
  36860839fb2b1536228775998f3cce730f5b028c \
  0.3.0 \
  /private/tmp/reviewed-starter-bundle
bun tools/template-contract/verify.mjs /private/tmp/starter-checkout
```

The bundle contains `template.patch` from the legacy base, `template-upgrade.patch` from the previous published release, and `template-candidate.json`. The metadata always says `published: false`. It records exact source commits, source and template hashes, migration hashes, patch hashes, and the candidate commit. Each patch is applied to an isolated Git index and must reproduce the candidate's exact tree. Generation never pushes a commit or changes a release pin. Repeat generation from the same commits and mapping to obtain identical bytes.

After the contract checks, frozen install, tests, typecheck, lint and build pass, review and copy the bundle into `tools/resource-management/` as a platform change. Publication and pin changes remain separate approved actions; an unpublished candidate hash must not become the shipped pin.

For an existing Project, the upgrade helper tries the verified incremental patch first, then the full patch. It verifies recorded patch hashes before applying them. It creates a new worktree and leaves the accepted checkout and its HEAD untouched:

```sh
bun tools/template-contract/upgrade.mjs /path/to/project /private/tmp/project-upgrade codex/template-contract-upgrade
```

Conflicts stop before creating the upgrade worktree. Projects with incompatible changes need a manual reviewed upgrade. Run their checks and commit a new Checkpoint, then accept and deploy through the normal Project flow. A clean patch and a matching SQLite schema establish source compatibility; they do not prove a live Cloudflare restore or deployment.
