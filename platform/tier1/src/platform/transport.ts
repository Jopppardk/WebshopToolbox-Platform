// The company is always derived from the authenticated user on the server.
// A webshop selector never grants access to that webshop by itself.
let webshopId: string | null = null;
export function selectWebshop(id: string | null) { webshopId = id; }
export function tier1Url(path: string) {
  if (!path.startsWith('/api/') || path.startsWith('/api/platform/'))
    throw new Error('Ugyldig integrationsadresse.');
  return `/api/platform/tier1/shops/${encodeURIComponent(webshopId || 'none')}${path.slice(4)}`;
}
export function tier1Fetch(input: string, options?: RequestInit) {
  return fetch(tier1Url(input), {...options, credentials: 'same-origin'});
}
export async function platformApi<T>(path: string, options?: RequestInit): Promise<T> {
  if (!path.startsWith('/api/platform/')) throw new Error('Ugyldig portaladresse.');
  const response = await fetch(path, {...options, credentials: 'same-origin'});
  const value = await response.json() as T & {error?:string};
  if (!response.ok) throw new Error(value.error || 'Handlingen kunne ikke gennemføres.');
  return value as T;
}
