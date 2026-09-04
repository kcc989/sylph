import { DependencyRepairOutput, isDependencyInput } from "@workspace/domain"
import { Schema } from "effect"

const outputMarker = "SYLPH_DEPENDENCY_RESULT="

export const dependencyRepairCommand = `node <<'SYLPH_DEPENDENCIES'
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const digest = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const accepts = ${isDependencyInput.toString()};
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\\0').filter(Boolean);
const inputs = [...new Set(paths)].filter(accepts).sort().map(path => ({ path, digest: digest(path) }));
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (manifest.packageManager && !manifest.packageManager.startsWith('bun@')) throw new Error('Dependency repair currently requires Bun');
if (!manifest.packageManager && !fs.existsSync('bun.lock')) throw new Error('Set packageManager to bun@<version> before requesting Bun dependency repair');
if (fs.existsSync('bun.lockb')) throw new Error('Convert the legacy binary bun.lockb to bun.lock before requesting dependency repair');
execFileSync('bun', ['install', '--lockfile-only', '--ignore-scripts'], { stdio: 'inherit' });
execFileSync('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], { stdio: 'inherit' });
const lockfile = fs.readFileSync('bun.lock', 'utf8');
if (!lockfile.length || Buffer.byteLength(lockfile) > 5 * 1024 * 1024) throw new Error('Generated lockfile exceeds Workspace limits');
for (const input of inputs) {
  if (input.path !== 'bun.lock' && digest(input.path) !== input.digest) throw new Error('Dependency installation changed ' + input.path);
}
console.log('${outputMarker}' + Buffer.from(JSON.stringify({ inputs, lockfile })).toString('base64'));
SYLPH_DEPENDENCIES`

export const readDependencyRepairOutput = (stdout: string) => {
  const frames = stdout
    .split("\n")
    .filter((line) => line.startsWith(outputMarker))
  if (frames.length !== 1 || !frames[0]) {
    throw new Error(
      "Dependency runner must return exactly one generated lockfile"
    )
  }
  const encoded = frames[0].slice(outputMarker.length)
  if (encoded.length > 20 * 1024 * 1024) {
    throw new Error("Dependency runner output exceeds Workspace limits")
  }
  const bytes = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0)
  )
  return Schema.decodeUnknownSync(DependencyRepairOutput)(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  )
}
