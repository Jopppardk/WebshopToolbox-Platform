// Fetches the orders changed since the automatic run's watermark (POST /shopify/orders with recent: true), page by
// page with the same since, as "Opdatér" on Salg, Fakturaer and Tilbagebetalinger does. Returns how many were
// fetched and Shopify's history warning, if any.
import { tier1Fetch as fetch } from '../platform/transport';

export async function fetchRecentOrders(): Promise<{
  synced: number;
  warning: string;
}> {
  let after: string | null = null,
    since: string | null = null,
    first = true,
    synced = 0,
    warning = '';
  const seen = new Set<string>();
  do {
    const response: Response = await fetch('/api/shopify/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(first ? { recent: true } : { after, since }),
    });
    const data = (await response.json()) as {
      synced: number;
      since?: string | null;
      warning?: string;
      hasNextPage: boolean;
      endCursor: string | null;
      error?: string;
    };
    if (!response.ok)
      throw new Error(data.error || 'Shopify-ordrer kunne ikke hentes.');
    if (first) since = data.since ?? null;
    first = false;
    synced += data.synced;
    if (data.warning) warning = data.warning;
    after = data.hasNextPage ? data.endCursor : null;
    if (data.hasNextPage && (!after || seen.has(after) || seen.size >= 200))
      throw new Error(
        'Hentningen blev stoppet ved en ugyldig fortsættelse. Allerede hentede ordrer er bevaret.',
      );
    if (after) seen.add(after);
  } while (after);
  return { synced, warning };
}
