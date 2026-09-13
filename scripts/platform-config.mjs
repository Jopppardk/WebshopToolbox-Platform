import { readFileSync } from 'node:fs';
export function validateConfig(config, remote = false) {
  const allowed = new Set([
    'name',
    'main',
    'account_id',
    'compatibility_date',
    'compatibility_flags',
    'workers_dev',
    'preview_urls',
    'assets',
    'vars',
    'd1_databases',
    'r2_buckets',
    'triggers',
    'observability',
  ]);
  for (const key of Object.keys(config))
    if (!allowed.has(key))
      throw Error(`Ikke tilladt konfigurationsfelt: ${key}`);
  const name = remote
    ? 'webshop-toolbox-platform-test'
    : 'webshop-toolbox-platform-local';
  const fail = () => {
    throw Error('Testkonfigurationen er ikke isoleret.');
  };
  if (
    config.name !== name ||
    config.main !== 'platform/worker.ts' ||
    config.preview_urls !== false ||
    config.workers_dev !== remote
  )
    fail();
  if (JSON.stringify(config.triggers) !== JSON.stringify({ crons: [] })) fail();
  if (
    config.assets?.directory !== 'platform/public' ||
    config.assets.binding !== 'ASSETS' ||
    config.assets.run_worker_first !== true ||
    Object.keys(config.assets).length !== 3
  )
    fail();
  if (
    config.vars?.PLATFORM_ENV !== (remote ? 'remote-test' : 'local-test') ||
    config.vars.PLATFORM_AUTH !==
      (remote ? 'cloudflare-access' : 'local-jwt') ||
    config.vars.PLATFORM_EXTERNAL_WRITES !== 'blocked' ||
    config.vars.PLATFORM_CUSTOMER_EMAIL !== 'blocked'
  )
    fail();
  const vars = [
    'PLATFORM_ENV',
    'PLATFORM_AUTH',
    'PLATFORM_EXTERNAL_WRITES',
    'PLATFORM_CUSTOMER_EMAIL',
    ...(remote ? ['PLATFORM_ACCESS_ISSUER', 'PLATFORM_ACCESS_AUD'] : []),
  ];
  if (Object.keys(config.vars).some((key) => !vars.includes(key))) fail();
  if (config.d1_databases?.length !== 1 || config.r2_buckets?.length !== 1)
    fail();
  const db = config.d1_databases[0],
    bucket = config.r2_buckets[0];
  if (
    db.binding !== 'PLATFORM_DB' ||
    db.database_name !== name ||
    db.migrations_dir !== 'platform/migrations' ||
    Object.keys(db).some(
      (k) =>
        !['binding', 'database_name', 'database_id', 'migrations_dir'].includes(
          k,
        ),
    )
  )
    fail();
  if (
    !/^[a-f0-9-]{36}$/.test(db.database_id) ||
    db.database_id === '154e8b5d-7f6c-42d7-b751-1defa0dd2549' ||
    (remote && db.database_id.startsWith('00000000'))
  )
    fail();
  if (
    bucket.binding !== 'PLATFORM_DOCUMENTS' ||
    bucket.bucket_name !== name + '-documents' ||
    Object.keys(bucket).length !== 2
  )
    fail();
  if (
    remote &&
    (config.account_id !== 'cab062dd85faea98c9b8c4969175c39f' ||
      db.database_id !== '438fde65-c538-4719-aa2e-9502ae37c7e6')
  )
    fail();
  if (
    remote &&
    config.vars.PLATFORM_ACCESS_AUD ===
      'ddda465e15f3bae8973ad8ac8b8667c42cf01948d4a8ac5515bd6f10abcdc681'
  )
    fail();
  return config;
}
export function readConfig(path, remote = false) {
  return validateConfig(JSON.parse(readFileSync(path, 'utf8')), remote);
}
