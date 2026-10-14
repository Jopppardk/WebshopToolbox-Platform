import { readFileSync } from 'node:fs';
import { validateConfig } from './platform-config.mjs';
export function validateProductionConfig(config) {
  const fail = () => {
    throw Error('Produktionskonfigurationen er ikke isoleret.');
  };
  if (
    config.name !== 'webshop-toolbox-platform-production' ||
    config.workers_dev !== false ||
    config.vars?.PLATFORM_ENV !== 'production' ||
    JSON.stringify(config.routes) !==
      JSON.stringify([
        { pattern: 'portal.webshoptoolbox.dk', custom_domain: true },
      ]) ||
    config.d1_databases?.[0]?.database_name !== config.name ||
    config.d1_databases?.[0]?.database_id !==
      'c3775354-8cc9-4f68-9343-1bde30776245' ||
    config.r2_buckets?.[0]?.bucket_name !== config.name + '-documents' ||
    !/^[a-f0-9]{64}$/.test(config.vars?.PLATFORM_ACCESS_AUD || '') ||
    config.vars.PLATFORM_ACCESS_AUD ===
      '4edbc15bc801d85de33ef29839e2e3803b733ce3cebbe60728d8e3277982e646'
  )
    fail();
  const productionMailRecipients = [
    'rj@itm8.com',
    'rene.jeppesen@live.dk',
    'rene@sablen.dk',
  ];
  if (
    config.vars.PLATFORM_MAIL_TEST_RECIPIENTS !==
      productionMailRecipients.join(',') ||
    JSON.stringify(config.send_email?.[1]) !==
      JSON.stringify({
        name: 'PLATFORM_MAIL_TEST',
        allowed_sender_addresses: ['faktura@webshoptoolbox.dk'],
      })
  )
    fail();
  if (
    !['enabled', 'blocked'].includes(config.vars.PLATFORM_EXTERNAL_WRITES) ||
    !['enabled', 'blocked'].includes(config.vars.PLATFORM_CUSTOMER_EMAIL)
  )
    fail();
  if (
    JSON.stringify(config.triggers) !==
    JSON.stringify({
      crons:
        config.vars.PLATFORM_EXTERNAL_WRITES === 'enabled'
          ? ['*/5 * * * *']
          : [],
    })
  )
    fail();
  // The job queue and CPU limit exist only in production and only in this exact shape:
  // one message per invocation and no retries, so an uncertain external write is never
  // repeated by the queue.
  const queue = config.name + '-jobs';
  if (
    (config.queues !== undefined &&
      JSON.stringify(config.queues) !==
        JSON.stringify({
          producers: [{ binding: 'PLATFORM_JOBS', queue }],
          consumers: [
            {
              queue,
              max_batch_size: 1,
              max_retries: 0,
              max_concurrency: 10,
            },
          ],
        })) ||
    (config.limits !== undefined &&
      JSON.stringify(config.limits) !== JSON.stringify({ cpu_ms: 300000 }))
  )
    fail();
  // Enforce all existing restrictions (blocked writes/mail, bindings, assets, cron, account)
  // after normalizing ONLY the explicitly validated production resource identifiers.
  const normalized = structuredClone(config);
  normalized.name = 'webshop-toolbox-platform-test';
  normalized.workers_dev = false;
  normalized.vars.PLATFORM_ENV = 'remote-test';
  normalized.routes = [
    { pattern: 'dev.webshoptoolbox.dk', custom_domain: true },
  ];
  normalized.d1_databases[0].database_name = normalized.name;
  normalized.d1_databases[0].database_id =
    '438fde65-c538-4719-aa2e-9502ae37c7e6';
  normalized.r2_buckets[0].bucket_name = normalized.name + '-documents';
  normalized.vars.PLATFORM_EXTERNAL_WRITES = 'blocked';
  normalized.vars.PLATFORM_CUSTOMER_EMAIL = 'blocked';
  normalized.triggers = { crons: [] };
  delete normalized.queues;
  delete normalized.limits;
  normalized.vars.PLATFORM_MAIL_TEST_RECIPIENTS =
    'rj@itm8.com,rene.jeppesen@live.dk';
  if (config.vars.PLATFORM_CUSTOMER_LOGIN === 'enabled') {
    if (
      JSON.stringify(config.send_email?.[2]) !==
      JSON.stringify({
        name: 'PLATFORM_AUTH_MAIL',
        allowed_sender_addresses: ['no-reply@webshoptoolbox.dk'],
      })
    )
      fail();
    if (
      config.vars.PLATFORM_INVITATION_MODE !== 'registered' ||
      config.vars.PLATFORM_INVITATION_RECIPIENTS !== undefined ||
      JSON.stringify(config.send_email[0]) !==
        JSON.stringify({
          name: 'PLATFORM_INVITATIONS',
          allowed_sender_addresses: ['no-reply@webshoptoolbox.dk'],
        })
    )
      fail();
    normalized.vars.PLATFORM_INVITATION_MODE = 'restricted';
    normalized.vars.PLATFORM_INVITATION_RECIPIENTS = 'rj@itm8.com';
    normalized.send_email[0].allowed_destination_addresses = ['rj@itm8.com'];
    normalized.send_email[2].allowed_destination_addresses = [
      'rj@itm8.com',
      'rene.jeppesen@live.dk',
    ];
  }
  validateConfig(normalized, true);
  return config;
}
export function readProductionConfig() {
  return validateProductionConfig(
    JSON.parse(readFileSync('wrangler.platform-production.json', 'utf8')),
  );
}
