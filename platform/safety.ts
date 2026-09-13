import { HttpError, type PlatformEnv } from './types';

export function assertTestRuntime(env: PlatformEnv) {
  if (
    !['local-test', 'remote-test'].includes(env.PLATFORM_ENV) ||
    env.PLATFORM_EXTERNAL_WRITES !== 'blocked' ||
    env.PLATFORM_CUSTOMER_EMAIL !== 'blocked'
  ) {
    throw new HttpError(503, 'Testmiljøets sikkerhedsindstillinger mangler.');
  }
  if (
    env.PLATFORM_ENV === 'remote-test' &&
    env.PLATFORM_AUTH !== 'cloudflare-access'
  ) {
    throw new HttpError(503, 'Fjernmiljøet kræver Cloudflare Access.');
  }
  // No production bindings or provider secrets are accepted by this entrypoint.
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
