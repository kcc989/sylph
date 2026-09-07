export const sandboxCommandEnvironment = (
  values: Readonly<Record<string, string | undefined>>
) =>
  Object.fromEntries(
    ["TERM", "COLORTERM", "LANG", "LC_ALL", "CI", "OPENCODE_TERMINAL"].flatMap(
      (name) => (values[name] === undefined ? [] : [[name, values[name]]])
    )
  )

export const shellArgument = (value: string) =>
  `'${value.replaceAll("'", "'\\''")}'`

export const workspaceCommandScript = `
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const request = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const root = request.root ?? '/workspace';
const resolve = name => {
  if (!name || name.startsWith('/') || name.split('/').some(p => p === '..') || name.includes('\\0')) throw Error('Invalid workspace path');
  const target = path.join(root, name);
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Workspace symlinks cannot be synchronized');
  }
  return target;
};
fs.mkdirSync(root, { recursive: true });
const previousPath = request.previousPath ?? '/tmp/sylph-workspace-files.json';
const previous = fs.existsSync(previousPath) ? JSON.parse(fs.readFileSync(previousPath, 'utf8')) : [];
const names = new Set(request.files.map(f => f.path));
for (const name of previous) if (!names.has(name)) fs.rmSync(resolve(name), { force: true });
for (const file of request.files) {
  const target = resolve(file.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(file.content, 'base64'));
}
fs.writeFileSync(previousPath, JSON.stringify([...names]));
let stdout = [];
let stderr = [];
let size = 0;
const child = cp.spawn(request.command, request.args, {
  cwd: request.cwd,
  env: { PATH: process.env.PATH, HOME: '/root', LANG: 'C.UTF-8', ...request.env },
  detached: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
process.on('SIGTERM', stop);
const timer = setTimeout(stop, 600000);
const collect = chunks => chunk => {
  size += chunk.length;
  if (size > 8 * 1024 * 1024) stop();
  else chunks.push(chunk);
};
child.stdout.on('data', collect(stdout));
child.stderr.on('data', collect(stderr));
child.stdin.on('error', () => {});
child.stdin.end(Buffer.from(request.stdin, 'base64'));
child.on('error', error => stderr.push(Buffer.from(error.message)));
child.on('close', code => {
  clearTimeout(timer);
  try {
    const listing = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    const candidates = new Set([...listing.toString().split('\\0').filter(Boolean), ...request.files.filter(f => !f.path.startsWith('.git/')).map(f => f.path)]);
    const files = [];
    let total = 0;
    for (const name of candidates) {
      const target = resolve(name);
      if (!fs.existsSync(target)) continue;
      if (!fs.lstatSync(target).isFile()) throw Error('Only regular Workspace files can be saved');
      const data = fs.readFileSync(target);
      total += data.length;
      if (data.length > 5 * 1024 * 1024 || total > 50 * 1024 * 1024) throw Error('Workspace file limit exceeded');
      files.push({ path: name, content: data.toString('base64') });
    }
    fs.writeFileSync(request.result, JSON.stringify({ exitCode: size > 8 * 1024 * 1024 ? 125 : code ?? 137, stdout: Buffer.concat(stdout).toString('base64'), stderr: Buffer.concat(stderr).toString('base64'), files }));
    fs.writeFileSync(previousPath, JSON.stringify([...names].filter(n => n.startsWith('.git/')).concat(files.map(f => f.path))));
  } catch (error) {
    fs.writeFileSync(request.result + '.error', String(error));
    process.exitCode = 125;
  }
});
`
