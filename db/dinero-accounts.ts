import { loadCredentials } from './credentials';
import type { PreviewAccount } from '@/lib/sales-preview';

// Authentication plus GETs only. This helper never creates a voucher or invoice.
export async function readDineroAccounts(supplied?: Record<string, string>): Promise<PreviewAccount[]> {
  const credentials = supplied ?? await loadCredentials('dinero', true);
  if (!credentials) throw new Error('Dinero er endnu ikke forbundet.');
  const tokenResponse = await fetch('https://authz.dinero.dk/dineroapi/oauth/token', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', scope: 'read write', username: credentials.apiKey, password: credentials.apiKey }),
  });
  const token = await tokenResponse.json() as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error('Dinero-adgangen kunne ikke fornyes.');
  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' };
  const accounts = new Map<string, PreviewAccount>();
  for (const kind of ['entry', 'deposit'] as const) {
    const fields = kind === 'entry' ? 'AccountNumber,Name,VatCode,Category' : 'AccountNumber,Name,IsDefault,IsHidden';
    const response = await fetch(`https://api.dinero.dk/v1/${encodeURIComponent(credentials.organizationId)}/accounts/${kind}?fields=${fields}`, { headers, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Kontoplanen kunne ikke hentes fra Dinero (HTTP ${response.status}). Kontrollér organisation og API-adgang.`);
    const payload = await response.json() as Record<string, unknown> | unknown[];
    const collection = Array.isArray(payload) ? payload : payload?.collection ?? payload?.Collection;
    if (!Array.isArray(collection)) throw new Error('Dinero returnerede en ukendt kontoplan.');
    for (const raw of collection as Record<string, unknown>[]) {
      const number = String(raw.accountNumber ?? raw.AccountNumber ?? '');
      const name = String(raw.name ?? raw.Name ?? '').trim().replace(/\s+/g, ' ');
      if (!/^\d+$/.test(number) || !name) throw new Error('Dinero returnerede en ugyldig konto.');
      const next: PreviewAccount = { number, name, vatCode: String(raw.vatCode ?? raw.VatCode ?? '').trim(), kind, hidden: (raw.isHidden ?? raw.IsHidden) === true };
      const previous = accounts.get(number);
      if (previous) {
        if (previous.name.toLocaleLowerCase('da') !== name.toLocaleLowerCase('da') || (kind === 'entry' && previous.vatCode !== next.vatCode) || (kind === 'deposit' && next.vatCode && next.vatCode !== previous.vatCode)) throw new Error(`Dinero returnerede modstridende oplysninger for konto ${number}. Den gemte kontoplan bevares.`);
        // Deposit omits VAT; preserve entry VAT and mark the shared account as a deposit.
        accounts.set(number, { ...previous, kind: kind === 'deposit' ? 'deposit' : previous.kind, hidden: previous.hidden || next.hidden });
      } else accounts.set(number, next);
    }
  }
  return [...accounts.values()].sort((a, b) => Number(a.number) - Number(b.number));
}
