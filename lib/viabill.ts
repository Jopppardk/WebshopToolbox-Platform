// ViaBill Merchant API, settlement endpoints (Stoplight, reviewed 2026-09-04).
// No checkout/capture/refund/cancel endpoints are exposed by this client.
export class ViaBillError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); }
}
export type ViaBillKeys = { apiKey: string; secret: string };
export type ViaBillAccount = { id: string; name: string };
export type ViaBillRecord = {
  id: string; provider: 'viabill'; accountId: string; entryUUID: string;
  date: string; amountMinor: number; currency: string; orderNumber: string | null;
  transactionId: string | null; bookingStatus?: string;
  entries?: ViaBillEntry[]; reconciled?: boolean;
};
export type ViaBillEntry = { date: string; type: string; text: string; orderNumber: string | null; transactionId: string | null; amountMinor: number; currency: string };
type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ViaBillError('ViaBill returnerede et ukendt dataformat. Ingen poster fra denne portion er gemt.');
  return value as ObjectValue;
}
export function keys(value: unknown): ViaBillKeys {
  const body = object(value);
  for (const field of ['apiKey', 'secret']) if (typeof body[field] !== 'string' || !(body[field] as string).trim() || (body[field] as string).length > 2048) throw new ViaBillError('Udfyld både ViaBill API key og secret.');
  return { apiKey: (body.apiKey as string).trim(), secret: (body.secret as string).trim() };
}
export async function signature(credentials: ViaBillKeys) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${credentials.apiKey}#${credentials.secret}`));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function identifier(value: unknown) {
  const result = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof result !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(result)) throw new ViaBillError('ViaBill returnerede et ugyldigt konto- eller posterings-ID.');
  return result;
}
export function dateOnly(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new ViaBillError('ViaBill returnerede en ugyldig dato.');
  return value;
}
export function amount(value: unknown) {
  const row = object(value);
  if (typeof row.amount !== 'number' || !Number.isSafeInteger(row.amount) || typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)) throw new ViaBillError('ViaBill returnerede et ugyldigt beløb eller en ukendt valuta.');
  // The documented contract is integer cents/øre, not decimal major units.
  if (new Intl.NumberFormat('en', { style: 'currency', currency: row.currency }).resolvedOptions().maximumFractionDigits !== 2) throw new ViaBillError('ViaBills valuta kræver en særskilt beløbskontrol før import.');
  return { amountMinor: row.amount, currency: row.currency };
}
const optional = (value: unknown) => typeof value === 'string' && value.length <= 500 ? value : null;
export async function viabillRequest(credentials: ViaBillKeys, path: string, body?: unknown): Promise<unknown> {
  if (!/^\/public\/merchant\/accounts(?:\/[a-zA-Z0-9_-]+\/(?:entries\/download\/JSON|payout\/[a-zA-Z0-9_-]+))?$/.test(path) || (body !== undefined) !== path.endsWith('/entries/download/JSON')) throw new ViaBillError('Denne ViaBill-handling er ikke tilladt.');
  const url = new URL(`https://secure.viabill.com/api${path}`);
  url.searchParams.set('apikey', credentials.apiKey);
  url.searchParams.set('signature', await signature(credentials));
  let response: Response;
  try {
    // Workerd rejects redirect:'error' before making a request. Manual mode
    // plus explicit rejection below keeps credentials on the original URL.
    response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(15000) });
  } catch { throw new ViaBillError('ViaBill kunne ikke kontaktes. Prøv igen om lidt.'); }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new ViaBillError('ViaBill omdirigerede API-kaldet. Forbindelsen er stoppet for at beskytte adgangsnøglerne.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    const operation = path === '/public/merchant/accounts' ? 'kontolisten' : 'afregningsdata for den valgte Merchant Account';
    const message = response.status === 401
      ? `ViaBill kunne ikke godkende API key og secret (HTTP 401) ved hentning af ${operation}. Kontrollér nøgleparret hos ViaBill.`
      : response.status === 403
        ? `ViaBill afviste adgang til ${operation} (HTTP 403). Svaret afgør ikke, om årsagen er nøgleparret eller manglende rettigheder. Bed ViaBill bekræfte adgang til dette endpoint.`
        : response.status === 400
          ? `ViaBill afviste forespørgslen til ${operation} (HTTP 400). Det beviser ikke, at konto-ID’et er forkert. Bed ViaBill bekræfte Merchant Account ID og API-adgang.`
          : response.status === 429 ? 'ViaBill begrænser hentningen (HTTP 429). Vent lidt og prøv igen.'
          : `ViaBill kunne ikke hente ${operation} (HTTP ${response.status}). Prøv senere.`;
    throw new ViaBillError(message, response.status);
  }
  // Bound memory even when the upstream ignores pagination. Never log the URL,
  // response body or fetch exception: the signature is a reusable credential.
  const reader = response.body?.getReader();
  if (!reader) throw new ViaBillError('ViaBill returnerede et tomt svar.');
  let size = 0; let text = ''; const decoder = new TextDecoder();
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 2_000_000) { await reader.cancel(); throw new ViaBillError('ViaBill returnerede for mange data. Vælg en kortere periode.'); } text += decoder.decode(chunk.value, { stream: true }); }
    return JSON.parse(text + decoder.decode());
  } catch (error) { if (error instanceof ViaBillError) throw error; throw new ViaBillError('ViaBill returnerede ikke læsbare JSON-data.'); }
}
// Accounts/export responses have no response schema in the published spec.
// Accept explicit list envelopes only; fail visibly on other formats, never
// interpret an unknown response as an empty successful import.
export function list(value: unknown, key: 'accounts' | 'entries'): unknown[] {
  if (Array.isArray(value)) return value;
  const body = object(value);
  const rows = body[key] ?? body.list;
  if (!Array.isArray(rows)) throw new ViaBillError(`ViaBills ${key === 'accounts' ? 'kontoliste' : 'posteringsliste'} har et ukendt format. Formatet skal kontrolleres før import.`);
  return rows;
}
export async function accounts(credentials: ViaBillKeys): Promise<ViaBillAccount[]> {
  const rows = list(await viabillRequest(credentials, '/public/merchant/accounts'), 'accounts');
  if (rows.length > 100) throw new ViaBillError('ViaBill returnerede uventet mange konti.');
  return rows.map(value => { const row = object(value); const id = identifier(row.accountId ?? row.id); return { id, name: optional(row.name) || `Konto ${id}` }; });
}
export async function verifyAccount(credentials: ViaBillKeys, accountIdValue: unknown) {
  const accountId = identifier(accountIdValue);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // The entries export is the authoritative account-scoped endpoint documented
  // by ViaBill. An empty list is a valid verification result.
  list(await viabillRequest(credentials, `/public/merchant/accounts/${accountId}/entries/download/JSON`, {
    filter: { transactions: true, transfers: true, dateRange: { startDate: today, endDate: today } },
    entryPage: { first: 1, pageLength: 1 }, sorting: [],
  }), 'entries');
  return accountId;
}
export function payment(value: unknown, accountId: string): ViaBillRecord | null {
  const row = object(value);
  if (typeof row.type !== 'string') throw new ViaBillError('ViaBills postering mangler type. Import er stoppet for at undgå at forveksle betalinger og udbetalinger.');
  if (row.type.toLowerCase() !== 'capture') {
    if (!['refund', 'transfer', 'tx_fee', 'invoice', 'subscription_fee', 'payout_fee', 'other'].includes(row.type.toLowerCase())) throw new ViaBillError('ViaBill returnerede en ukendt posteringstype.');
    return null;
  }
  const entryUUID = identifier(row.entryUUID);
  return { id: `viabill:${accountId}:${entryUUID}`, provider: 'viabill', accountId, entryUUID, date: dateOnly(row.date), ...amount(row.amount), orderNumber: optional(row.orderNumber), transactionId: optional(row.transactionId) };
}
export function payout(value: unknown, accountId: string, entryUUID: string): ViaBillRecord {
  const body = object(value);
  if (identifier(body.accountId) !== accountId || !Array.isArray(body.list) || body.list.length !== 1) throw new ViaBillError('ViaBill returnerede ikke den forventede udbetaling.');
  const row = object(body.list[0]);
  const total = amount(row.total);
  if (!Array.isArray(row.merchantEntryPostDTOs) || row.merchantEntryPostDTOs.length > 5000) throw new ViaBillError('ViaBills udbetalingsposter kunne ikke kontrolleres.');
  const entries = row.merchantEntryPostDTOs.map(value => {
    const entry = object(value); const money = amount(entry.amount);
    if (money.currency !== total.currency || typeof entry.type !== 'string') throw new ViaBillError('ViaBills afregningsposter har forskellige valutaer eller mangler type.');
    return { date: dateOnly(entry.date), type: entry.type, text: optional(entry.text) || '', orderNumber: optional(entry.orderNumber), transactionId: optional(entry.transactionId), ...money };
  });
  const sum = entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
  if (!Number.isSafeInteger(sum)) throw new ViaBillError('ViaBills afregningsbeløb er for stort.');
  return { id: `viabill:${accountId}:${entryUUID}`, provider: 'viabill', accountId, entryUUID, date: dateOnly(row.transferDate), ...total, orderNumber: null, transactionId: null, entries, reconciled: sum === total.amountMinor };
}
export const publicError = (error: unknown) => error instanceof ViaBillError ? error.message : 'ViaBill-handlingen mislykkedes. Prøv igen; der er ikke ændret noget hos ViaBill.';
