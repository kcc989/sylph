export const commandOutputLimit = 8 * 1024 * 1024
export const commandTimeoutMs = 10 * 60 * 1000

export const commandEnvironment = (
  values: Readonly<Record<string, string | undefined>>,
  deployment = false
) => {
  const names = [
    "TERM",
    "COLORTERM",
    "LANG",
    "LC_ALL",
    "CI",
    "OPENCODE_TERMINAL",
  ]
  if (deployment)
    names.push(
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "BETTER_AUTH_SECRET",
      "SYLPH_PROJECT",
      "SYLPH_CHECKPOINT",
      "SYLPH_DEPLOYMENT"
    )
  return Object.fromEntries(
    names.flatMap((name) =>
      values[name] === undefined ? [] : [[name, values[name]]]
    )
  )
}

export const shellArgument = (value: string) =>
  `'${value.replaceAll("'", "'\\''")}'`

export const commandProcessScript = `
const runCommand = request => new Promise(resolve => {
  const cp = require('node:child_process');
  const stdout = [];
  const stderr = [];
  let size = 0;
  let spawnFailed = false;
  const child = cp.spawn(request.command, request.args, {
    cwd: request.cwd,
    env: { PATH: process.env.PATH, HOME: process.env.HOME || '/root', LANG: 'C.UTF-8', ...request.env },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const timer = setTimeout(stop, Math.min(request.timeoutMs || ${commandTimeoutMs}, ${commandTimeoutMs}));
  const collect = chunks => chunk => {
    size += chunk.length;
    if (size > ${commandOutputLimit}) stop();
    else chunks.push(chunk);
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  child.stdin.on('error', () => {});
  child.stdin.end(Buffer.from(request.stdin || '', 'base64'));
  child.on('error', error => { spawnFailed = true; stderr.push(Buffer.from(error.message)); });
  child.on('close', code => {
    clearTimeout(timer);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    resolve({ exitCode: size > ${commandOutputLimit} ? 125 : spawnFailed ? 127 : code ?? 137, stdout: Buffer.concat(stdout).toString('base64'), stderr: Buffer.concat(stderr).toString('base64') });
  });
});
`

export const ciCommand = (command: string, deployment = false) =>
  `node -e ${shellArgument(`${commandProcessScript}
runCommand({ command: '/bin/bash', args: ['-c', ${JSON.stringify(command)}], cwd: process.cwd(), env: (${commandEnvironment.toString()})(process.env, ${deployment}) }).then(result => {
  process.stdout.write(Buffer.from(result.stdout, 'base64'));
  process.stderr.write(Buffer.from(result.stderr, 'base64'));
  process.exitCode = result.exitCode;
});`)} `
