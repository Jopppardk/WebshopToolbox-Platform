import { HttpError, type PlatformEnv } from './types';

export function assertTestRuntime(env: PlatformEnv) {
  if (
    !['local-test', 'remote-test', 'production'].includes(env.PLATFORM_ENV) ||
    !(env.PLATFORM_ENV==='production'?['blocked','enabled']:['blocked']).includes(env.PLATFORM_EXTERNAL_WRITES) ||
    !(env.PLATFORM_ENV==='production'?['blocked','enabled']:['blocked']).includes(env.PLATFORM_CUSTOMER_EMAIL)
  ) {
    throw new HttpError(503, 'Platformens sikkerhedsindstillinger mangler.');
  }
  if (
    env.PLATFORM_ENV !== 'local-test' &&
    env.PLATFORM_AUTH !== 'cloudflare-access'
  ) {
    throw new HttpError(503, 'Fjernmiljøet kræver Cloudflare Access.');
  }
  if(env.PLATFORM_ENV==='production' && (!/^[a-f0-9]{64}$/.test(env.PLATFORM_ACCESS_AUD||'') || ['4edbc15bc801d85de33ef29839e2e3803b733ce3cebbe60728d8e3277982e646','ddda465e15f3bae8973ad8ac8b8667c42cf01948d4a8ac5515bd6f10abcdc681'].includes(env.PLATFORM_ACCESS_AUD!)))throw new HttpError(503,'Produktionsportalen kræver sin egen loginopsætning.');
  // No legacy bindings or provider secrets are accepted by this entrypoint.
  for (const key of Object.keys(env)) {
    if (
      /^(DB|INVOICES|INVOICE_EMAIL|CREDENTIALS_ENCRYPTION_KEY)$/.test(key) ||
      /^(DINERO|SHOPIFY|FLATPAY|VIABILL|EMBALLAGE)_/.test(key)
    ) {
      throw new HttpError(503, 'Testmiljøet har en ikke-tilladt binding.');
    }
  }
}

// All future adapters must enter through this policy. No live adapter is shipped.
export function externalWrite(_operation: string): never {
  throw new HttpError(403, 'Eksterne skrivninger er blokeret i testmiljøet.');
}
export function customerEmail(): never {
  throw new HttpError(403, 'Kundemail er blokeret i testmiljøet.');
}
export function scheduled() {
  return {
    status: 'disabled',
    reason: 'Ingen integrationsjobs i administrationens testmiljø.',
  };
}
