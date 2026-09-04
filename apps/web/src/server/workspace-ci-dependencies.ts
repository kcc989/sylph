export const installCacheInputs = [
  "package.json",
  "**/package.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  ".yarnrc.yml",
  "package-lock.json",
  ".npmrc",
]

export const dependencyInstallCommand = [
  "if [ -f bun.lock ] || [ -f bun.lockb ]; then bun install --frozen-lockfile",
  "elif [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile",
  "elif [ -f yarn.lock ]; then corepack yarn install --immutable",
  "elif [ -f package-lock.json ]; then npm ci",
  "else npm install --ignore-scripts=false; fi",
].join("; ")
