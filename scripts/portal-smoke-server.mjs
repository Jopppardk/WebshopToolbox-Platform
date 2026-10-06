// Local server for the portal smoke test (npm run test:portal): a fresh local database with the migrations,
// the fixture seed and tests/portal/fixtures.sql, served on port 8791. Never touches a remote environment.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const wrangler = resolve(
  dirname(require.resolve('wrangler/package.json')),
  'bin/wrangler.js',
);
const state = '.wrangler/portal-smoke-state',
  config = 'wrangler.platform-local.json';
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
if (!existsSync('.dev.vars'))
  writeFileSync(
    '.dev.vars',
    `PLATFORM_LOCAL_SECRET=${randomBytes(32).toString('hex')}\nPLATFORM_LOGIN_SECRET=${randomBytes(32).toString('hex')}\n`,
    { flag: 'wx' },
  );
if (!/^PLATFORM_LOGIN_SECRET=/m.test(readFileSync('.dev.vars', 'utf8')))
  writeFileSync(
    '.dev.vars',
    readFileSync('.dev.vars', 'utf8') +
      `\nPLATFORM_LOGIN_SECRET=${randomBytes(32).toString('hex')}\n`,
  );
rmSync(state, { recursive: true, force: true });
const run = (...args) => {
  const r = spawnSync(
    process.execPath,
    [wrangler, ...args, '--local', '--persist-to', state, '--config', config],
    { stdio: 'inherit', env },
  );
  if (r.status !== 0) process.exit(r.status || 1);
};
run('d1', 'migrations', 'apply', 'PLATFORM_DB');
run('d1', 'execute', 'PLATFORM_DB', '--file', 'platform/fixtures/seed.sql');
run('d1', 'execute', 'PLATFORM_DB', '--file', 'tests/portal/fixtures.sql');
const server = spawn(
  process.execPath,
  [
    wrangler,
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    '8791',
    '--persist-to',
    state,
    '--config',
    config,
  ],
  { stdio: 'inherit', env },
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.kill(signal);
    process.exit(0);
  });
server.on('exit', (code) => process.exit(code ?? 0));
