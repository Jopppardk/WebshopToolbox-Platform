import { assertPlatformRepository } from './platform-repository.mjs';
import { spawnSync } from 'node:child_process';
import { readProductionConfig } from './platform-production-config.mjs';
const task = process.argv[2];
readProductionConfig();
if (['deploy', 'migrate'].includes(task)) assertPlatformRepository();
if (
  task === 'deploy' &&
  process.env.GITHUB_ACTIONS === 'true' &&
  !process.env.CLOUDFLARE_API_TOKEN?.trim()
)
  throw Error(
    'GitHub Environment prod mangler CLOUDFLARE_API_TOKEN. Ingen build/upload startet.',
  );
const tasks = {
  check: null,
  build: ['deploy', '--dry-run'],
  migrate: ['d1', 'migrations', 'apply', 'PLATFORM_DB', '--remote'],
  deploy: ['deploy'],
};
if (!(task in tasks)) throw Error('Brug check, build, migrate eller deploy.');
if (['build', 'deploy'].includes(task)) {
  const build = spawnSync(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'build',
      '--config',
      'platform/tier1/vite.config.mjs',
    ],
    { stdio: 'inherit' },
  );
  if (build.status !== 0) process.exit(build.status ?? 1);
}
if (tasks[task]) {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      ...tasks[task],
      '--config',
      'wrangler.platform-production.json',
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} else console.log('Produktionsressourcer og begrænsninger kontrolleret.');
