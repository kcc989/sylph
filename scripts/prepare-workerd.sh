#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

workerd_bin="$(bun -e 'process.stdout.write(require("workerd").default)')"

if [[ ! -x "$workerd_bin" ]]; then
  exit 0
fi

if bun -e 'const result = Bun.spawnSync([process.argv[1], "--version"], { stdout: "ignore", stderr: "ignore" }); process.exit(result.exitCode ?? 1)' "$workerd_bin"; then
  exit 0
fi

codesign --force --sign - "$workerd_bin"
"$workerd_bin" --version >/dev/null
