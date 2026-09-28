import { TransferError, normalizeRemote } from '../lib/dinero-sale';

export class DineroHttpError extends TransferError {
  constructor(public readonly status:number){super(`Dinero svarede HTTP ${status}. Kontrollér bilagsstatus før et nyt forsøg.`);}
}

// This client never retries writes and never follows redirects carrying credentials.
export async function dineroClient(credentials: Record<string, string>) {
  const tokenResponse = await fetch('https://authz.dinero.dk/dineroapi/oauth/token', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', scope: 'read write', username: credentials.apiKey, password: credentials.apiKey }),
  });
  const token = await tokenResponse.json() as { access_token?: string };
  if (!tokenResponse.ok || !token.access_token) throw new TransferError('Dinero-adgangen kunne ikke fornyes.');
  return async (path: string, method: 'GET' | 'POST', body?: unknown) => {
    if (!/^(files|vouchers\/manuel(?:\/[\da-f-]{36}(?:\/book)?)?)$/.test(path)) throw new TransferError('Ugyldigt Dinero-kald.');
    const multipart = body instanceof FormData;
    const response = await fetch(`https://api.dinero.dk/v1/${encodeURIComponent(credentials.organizationId)}/${path}`, {
      method, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json', ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'GET' ? undefined : multipart ? body : JSON.stringify(body),
    });
    if (!response.ok) throw new DineroHttpError(response.status);
    return normalizeRemote(await response.json());
  };
}
