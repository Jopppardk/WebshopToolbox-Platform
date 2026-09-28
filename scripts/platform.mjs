import {assertPlatformRepository} from './platform-repository.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { readConfig } from './platform-config.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const require = createRequire(import.meta.url),
  wrangler = resolve(
    dirname(require.resolve('wrangler/package.json')),
    'bin/wrangler.js',
  );
const task = process.argv[2],
  remote = ['deploy', 'migrate-remote', 'seed-remote', 'build-remote'].includes(
    task,
  );
const configPath = remote
  ? 'wrangler.platform-test.json'
  : 'wrangler.platform-local.json';
readConfig(configPath, remote);
function run(args) {
  const r = spawnSync(
    process.execPath,
    [wrangler, ...args, '--config', configPath],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_LOG_PATH: resolve(root, '.wrangler/platform-logs'),
      },
    },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
}
function localSecret() {
  const path = '.dev.vars';
  if (!existsSync(path))
    writeFileSync(
      path,
      `PLATFORM_LOCAL_SECRET=${randomBytes(32).toString('hex')}\n`,
      { flag: 'wx' },
    );
  if(!/^PLATFORM_LOGIN_SECRET=/m.test(readFileSync(path,'utf8')))writeFileSync(path,readFileSync(path,'utf8')+'\nPLATFORM_LOGIN_SECRET='+randomBytes(32).toString('hex')+'\n');
  const match = readFileSync(path, 'utf8').match(
    /^PLATFORM_LOCAL_SECRET=([a-f0-9]{64})$/m,
  );
  if (!match)
    throw Error('Lokal testnøgle mangler. Ingen eksisterende fil overskrives.');
  return match[1];
}
if(['deploy','migrate-remote','seed-remote'].includes(task))assertPlatformRepository();
if(task==='deploy'&&process.env.GITHUB_ACTIONS==='true'&&!process.env.CLOUDFLARE_API_TOKEN?.trim())throw Error('GitHub Environment dev mangler CLOUDFLARE_API_TOKEN. Ingen build/upload startet.');
if (['dev','build','build-remote','deploy'].includes(task)) {
  const build = spawnSync(process.execPath, [resolve(root,'node_modules/vite/bin/vite.js'),'build','--config','platform/tier1/vite.config.mjs'], {stdio:'inherit'});
  if(build.error) throw build.error;
  if(build.status!==0) process.exit(build.status || 1);
}
switch (task) {
  case 'check':
    console.log('Lokal testkonfiguration kontrolleret.');
    if (existsSync('wrangler.platform-test.json')) {
      readConfig('wrangler.platform-test.json', true);
      console.log('Fjern-testkonfiguration kontrolleret.');
    }
    break;
  case 'init-local':
    localSecret();
    run([
      'd1',
      'migrations',
      'apply',
      'PLATFORM_DB',
      '--local',
      '--persist-to',
      '.wrangler/platform-state',
    ]);
    break;
  case 'seed-local':
    run([
      'd1',
      'execute',
      'PLATFORM_DB',
      '--local',
      '--persist-to',
      '.wrangler/platform-state',
      '--file',
      'platform/fixtures/seed.sql',
    ]);
    break;
  case 'dev':
    localSecret();
    run([
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      '8790',
      '--persist-to',
      '.wrangler/platform-state',
    ]);
    break;
  case 'local-session': {
    const user = process.argv[3] || 'local-admin';
    if (!['local-admin', 'local-a', 'local-b', 'local-reader'].includes(user))
      throw Error('Ukendt fixturebruger.');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('urn:webshop-toolbox:local-test')
      .setSubject(user)
      .setAudience('platform-local')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(localSecret()));
    mkdirSync('.wrangler', { recursive: true });
    writeFileSync(
      '.wrangler/platform-local-session.json',
      JSON.stringify({ user, token }),
    );
    console.log(
      'Lokal session gemt i ignoreret .wrangler/platform-local-session.json (gyldig 1 time).',
    );
    break;
  }
  case 'build':
  case 'build-remote':
    run(['deploy', '--dry-run', '--outdir', 'dist/platform-check']);
    break;
  case 'migrate-remote':
    run(['d1', 'migrations', 'apply', 'PLATFORM_DB', '--remote']);
    break;
  case 'seed-remote':
    run([
      'd1',
      'execute',
      'PLATFORM_DB',
      '--remote',
      '--file',
      'platform/fixtures/seed.sql',
    ]);
    break;
  case 'deploy':
    run(['deploy']);
    break;
  default:
    throw Error(
      'Brug check, init-local, seed-local, dev, local-session, build, build-remote, migrate-remote, seed-remote eller deploy.',
    );
}
