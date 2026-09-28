import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkReleaseHealth(target, fetcher = fetch) {
  if (!['dev', 'prod'].includes(target)) throw Error('Miljø skal være dev eller prod.');
  const host = target === 'dev' ? 'dev.webshoptoolbox.dk' : 'portal.webshoptoolbox.dk';
  const filename = target === 'dev' ? 'wrangler.platform-test.json' : 'wrangler.platform-production.json';
  const { vars } = JSON.parse(readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'));
  const request = path => fetcher(`https://${host}${path}`, {
    method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000),
    headers: { 'Cache-Control': 'no-cache' },
  });
  const health = await request('/healthz');
  if (health.status !== 200) throw Error(`${host}/healthz: forventede 200, fik ${health.status}.`);
  const data = await health.json();
  if (data.status !== 'ok' || data.environment !== vars.PLATFORM_ENV ||
      data.bookkeeping !== vars.PLATFORM_EXTERNAL_WRITES || data.customerEmail !== vars.PLATFORM_CUSTOMER_EMAIL)
    throw Error(`${host}: healthz stemmer ikke med miljøets sikkerhedsindstillinger.`);
  const login = await request('/login');
  if (login.status !== 200 || !login.headers.get('content-type')?.includes('text/html'))
    throw Error(`${host}/login: kundelogin er ikke tilgængeligt.`);
  const api = await request('/api/orders');
  if (api.status !== 401) throw Error(`${host}: anonymt ordre-API skal svare 401, fik ${api.status}.`);
  const admin = await request('/admin/');
  const location = admin.headers.get('location');
  const issuer = new URL(vars.PLATFORM_ACCESS_ISSUER);
  let destination;
  try { destination = new URL(location); } catch { /* Missing/relative login destination is not Access. */ }
  if (![302, 303].includes(admin.status) || destination?.origin !== issuer.origin ||
      !destination.pathname.startsWith('/cdn-cgi/access/login/'))
    throw Error(`${host}: administrationen sender ikke til den forventede Cloudflare Access-login.`);
  return `${target}: healthz, kundelogin, anonymt API og Access-beskyttelse OK.`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  checkReleaseHealth(process.argv[2]).then(console.log).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
