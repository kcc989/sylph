# Extend Cloudflare CI without a Project manifest

Sylph defines its CI pipeline as application-owned TypeScript using `@cloudflare/ci`, following Cloudflare's authored-pipeline model. Project Repositories expose recognizable package scripts, while Sylph layers Check persistence, diagnostics, repair, Preview identity, and browser evidence onto the pipeline; Projects do not need proprietary Sylph execution metadata, and a configurable adapter seam should be introduced only when multiple real execution models require one.
