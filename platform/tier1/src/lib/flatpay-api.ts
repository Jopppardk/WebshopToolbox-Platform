import { asText } from './format';
// Contract: Saga ExternalPanthroAPI v1, retrieved 2026-09-10.
export type FlatpayAccess = { username: string; password: string };
export type FlatpayAgreement = {
  id: string;
  agreementNumber: string;
  merchantID: string;
  currency: string;
  status: string;
};
const base = 'https://api.saga.valitor.com/panthro';
const resources = [
  'agreements',
  'transactions',
  'settlements',
  'payments',
] as const;
// Live Saga responses use PascalCase; Swagger describes camelCase.
// Canonicalize only casing, and reject ambiguous duplicate keys.
export function flatpayObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const canonical: Record<string, string> = {
    id: 'id',
    merchantid: 'merchantID',
    agreementid: 'agreementID',
    partnerid: 'partnerID',
    transactionid: 'transactionID',
    settlementid: 'settlementID',
    paymentid: 'paymentID',
  };
  const result: Record<string, unknown> = {},
    seen = new Set<string>();
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (seen.has(lower))
      throw Error('Flatpay returnerede tvetydige feltnavne.');
    seen.add(lower);
    const name = canonical[lower] || key.charAt(0).toLowerCase() + key.slice(1);
    Object.defineProperty(result, name, {
      value: item,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}
export async function flatpayRead(
  access: FlatpayAccess,
  resource: (typeof resources)[number],
  query: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  if (
    !resources.includes(resource) ||
    !access.username ||
    access.username.includes(':') ||
    !access.password
  )
    throw Error('Ugyldige Flatpay-adgangsoplysninger eller forespørgsel.');
  const bytes = new TextEncoder().encode(
    access.username + ':' + access.password,
  );
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const url = new URL(base + '/api/' + resource);
  for (const [key, value] of Object.entries(query))
    url.searchParams.set(key, value);
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Basic ' + btoa(binary),
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw Error(
        'Flatpay svarede ikke efter tre læseforsøg. Prøv igen senere.',
      );
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    if (!response.ok)
      throw Error(
        response.status === 401
          ? 'Flatpay afviste API-brugernavn eller adgangskode (HTTP 401).'
          : response.status === 403
            ? 'Flatpay-adgangen mangler rettigheder (HTTP 403).'
            : `Flatpay-læsningen fejlede (HTTP ${response.status}).`,
      );
    let payload: Record<string, unknown>;
    try {
      const raw = await response.text();
      if (raw.length > 15000000) throw Error();
      payload = JSON.parse(raw);
    } catch {
      throw Error(
        'Flatpay returnerede et ugyldigt eller for stort svar. Vælg en kortere periode.',
      );
    }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object')
      throw Error(
        `Flatpay /${resource}: svaret er ${payload === null ? 'null' : Array.isArray(payload) ? 'en direkte liste' : typeof payload}; forventede et objekt med feltet ${resource}.`,
      );
    payload = flatpayObject(payload);
    if (Object.hasOwn(payload, resource) && payload[resource] === null)
      return [];
    if (!Array.isArray(payload[resource])) {
      const value = payload[resource];
      const shape = Object.hasOwn(payload, resource) ? typeof value : 'mangler';
      throw Error(
        `Flatpay /${resource}: feltet ${resource} ${shape === 'mangler' ? 'mangler' : 'har typen ' + shape}. Forventede en liste eller null. HTTP ${response.status}.`,
      );
    }
    const rows = payload[resource] as Record<string, unknown>[];
    if (
      rows.length >= 10000 ||
      rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))
    )
      throw Error(
        'Flatpay-svaret skal kontrolleres for fuldstændighed. Vælg en kortere periode.',
      );
    return rows.map(flatpayObject);
  }
  throw Error('Flatpay kunne ikke læses.');
}
export function safeAgreement(row: Record<string, unknown>): FlatpayAgreement {
  if (
    typeof row.id !== 'string' ||
    !row.id ||
    typeof row.agreementNumber !== 'string' ||
    !row.agreementNumber ||
    typeof row.merchantID !== 'string' ||
    !row.merchantID
  )
    throw Error('Flatpay-aftalen mangler ID eller aftalenummer.');
  return {
    id: row.id,
    agreementNumber: row.agreementNumber,
    merchantID: row.merchantID,
    currency: asText(row.currency || row.currencyCode || ''),
    status: asText(row.status || ''),
  };
}
export function flatpayDateRange(
  start: string,
  end: string,
  startDate: string,
) {
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (
    !valid(start) ||
    !valid(end) ||
    !valid(startDate) ||
    start < startDate ||
    end < start ||
    Date.parse(end) - Date.parse(start) > 30 * 86400000 ||
    end > new Date().toISOString().slice(0, 10)
  )
    throw Error(
      'Vælg højst 31 dage fra integrationens startdato og frem til i dag.',
    );
}
