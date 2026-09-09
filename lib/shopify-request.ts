// Retries are limited to reads; inventory mutations and OAuth writes run once.
export class ShopifyReadError extends Error {}
export const shopifyFailure = (error: unknown, fallback: string) => error instanceof ShopifyReadError ? error.message : fallback;
export async function shopifyFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  let query = '';
  try { const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}'); query = typeof body.query === 'string' ? body.query : ''; } catch {}
  const graphql = url.endsWith('/graphql.json');
  const read = method === 'GET' || (graphql && method === 'POST' && /^\s*(?:query\b|\{)/.test(query) && !/\bmutation\b/.test(query));
  if (!read) return fetch(url, { ...init, redirect: 'manual' });
  const deadline = Date.now() + 30_000;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response: Response | undefined;
    let code = '', transient = false, delay = 1000 * 2 ** (attempt - 1);
    try {
      const timeout = AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now())));
      response = await fetch(url, { ...init, redirect: 'manual', signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    } catch {
      if (init.signal?.aborted) throw new ShopifyReadError('Shopify-læsningen blev afbrudt eller overskred tidsgrænsen.');
      code = 'NETVÆRK/TIMEOUT'; transient = true;
    }
    if (response) {
      transient = [408, 429, 500, 502, 503, 504].includes(response.status);
      code = `HTTP ${response.status}`;
      if (response.ok) {
        if (!graphql) return response;
        let payload: { errors?: Array<{ extensions?: { code?: string } }>; extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } } };
        try { payload = await response.clone().json(); }
        catch { await response.body?.cancel(); throw new ShopifyReadError('Shopify returnerede ulæselige data (HTTP 200). Ingen automatisk gentagelse.'); }
        if (!payload.errors?.length) return response;
        transient = payload.errors.every(error => error.extensions?.code === 'THROTTLED');
        code = transient ? 'THROTTLED' : payload.errors.some(error => error.extensions?.code === 'ACCESS_DENIED') ? 'ACCESS_DENIED' : 'GRAPHQL_FEJL';
        const cost = payload.extensions?.cost, throttle = cost?.throttleStatus;
        if (transient && typeof cost?.requestedQueryCost === 'number' && typeof throttle?.currentlyAvailable === 'number' && typeof throttle.restoreRate === 'number' && throttle.restoreRate > 0)
          delay = Math.max(delay, Math.ceil((cost.requestedQueryCost - throttle.currentlyAvailable) / throttle.restoreRate * 1000));
      }
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        const value = Number(retryAfter);
        const wait = Number.isFinite(value) ? value * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(wait)) delay = Math.max(delay, wait);
      }
      await response.body?.cancel();
    }
    const denied = code === 'HTTP 401' || code === 'HTTP 403' || code === 'ACCESS_DENIED';
    const message = denied
      ? `Shopify afviste adgangen (${code}). Kontrollér forbindelsen og appens rettigheder; Shopify Payments kræver read_shopify_payments_accounts og read_shopify_payments_payouts.`
      : `Shopify-læsningen mislykkedes (${code}) efter ${attempt} forsøg. ${transient ? 'Prøv senere; næste planlagte kørsel kan fortsætte.' : 'Kontrollér forespørgslen og appens API-adgang.'}`;
    if (!transient || attempt === 3 || delay > 5000 || Date.now() + delay >= deadline) throw new ShopifyReadError(message);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new ShopifyReadError('Shopify-læsningen blev afbrudt.');
}
