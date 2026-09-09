# Define Cloudflare CI in application code

Sylph defines its pipeline in TypeScript with `@cloudflare/ci`. Project Repositories supply package scripts; Sylph records Checks, reports diagnostics, handles repair, identifies Previews, and stores browser evidence.

Projects need no separate Sylph execution manifest. Add a configurable execution adapter only when multiple supported execution models require it.
