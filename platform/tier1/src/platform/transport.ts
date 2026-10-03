// The company is always derived from the authenticated user on the server.
// A webshop selector never grants access to that webshop by itself.
let webshopId: string | null = null;
let actorContext: string | null = null;
export function selectWebshop(id: string | null) {
  webshopId = id;
}
// Toolbox support opens this portal under /admin/kundeportal/ as the customer user it acts for.
export const supportMode =
  typeof location !== 'undefined' && location.pathname.startsWith('/admin/');
export const portalRoot = supportMode ? '/admin' : '';
// Ties write requests to the session they were loaded in, so an ended support session cannot act.
export function setActor(user: {
  id: string;
  support?: { sessionId: string } | null;
}) {
  actorContext = user.id + ':' + (user.support?.sessionId || '');
}
function withActor(options?: RequestInit): RequestInit {
  const headers = new Headers(options?.headers);
  if (actorContext) headers.set('X-Platform-Actor', actorContext);
  return { ...options, headers, credentials: 'same-origin' };
}
export function tier1Url(path: string) {
  if (!path.startsWith('/api/') || path.startsWith('/api/platform/'))
    throw new Error('Ugyldig integrationsadresse.');
  return `${portalRoot}/api/platform/tier1/shops/${encodeURIComponent(webshopId || 'none')}${path.slice(4)}`;
}
export function tier1Fetch(input: string, options?: RequestInit) {
  return fetch(tier1Url(input), withActor(options));
}
export async function platformApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  if (!path.startsWith('/api/platform/'))
    throw new Error('Ugyldig portaladresse.');
  const response = await fetch(portalRoot + path, withActor(options));
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(value.error || 'Handlingen kunne ikke gennemføres.');
  return value as T;
}
