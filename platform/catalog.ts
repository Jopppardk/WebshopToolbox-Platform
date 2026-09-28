// Code-maintained catalog. No customer credentials or production adapters.
export const catalog = [
  {id:'shopify',name:'Shopify',category:'Webshop',description:'Salg, tilbagebetalinger, udbetalinger og lager.'},
  {id:'dinero',name:'Dinero',category:'Regnskab',description:'Bilag, kontoplan og økonomisk overblik.'},
  {id:'flatpay',name:'Flatpay',category:'Betaling',description:'Transaktioner, afregninger og udbetalinger.'},
  {id:'viabill',name:'ViaBill',category:'Betaling',description:'Betalinger og afregningsdata.'},
  {id:'emballage',name:'Emballage Indberetning',category:'Producentansvar',description:'Kvartalsvis indberetning af emballage.'},
] as const;

// API base addresses the adapters call. The probe sends no credentials and reads no body.
const endpoints: Record<(typeof catalog)[number]['id'], string> = {
  shopify: 'https://admin.shopify.com/',
  dinero: 'https://api.dinero.dk/v1',
  flatpay: 'https://api.saga.valitor.com/panthro',
  viabill: 'https://secure.viabill.com/api',
  emballage: 'https://app.emballageindberetning.dk/api/public/v1',
};

// Any HTTP answer (also 401/404) proves the API can be reached from the platform; 5xx is an error at the provider.
async function reachability(url: string, request: typeof fetch) {
  const started = Date.now();
  try {
    const response = await request(url, {method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
    await response.body?.cancel().catch(() => {});
    return {state: response.status >= 500 ? 'provider_error' : 'reachable', httpStatus: response.status, ms: Date.now() - started, url};
  } catch {
    return {state: 'unreachable', httpStatus: null, ms: Date.now() - started, url};
  }
}

// Active companies with a saved connection per integration, plus those that only selected it.
export async function integrationUsage(db: D1Database) {
  const active = (table: string, extra = '') => `SELECT count(DISTINCT t.company_id) FROM ${table} t JOIN companies c ON c.id=t.company_id WHERE c.status='active'${extra}`;
  const row = await db.prepare(`SELECT
    (${active('webshop_connections', " AND t.provider='shopify'")}) AS shopify,
    (${active('accounting_connections')}) AS dinero,
    (${active('payment_connections', " AND t.provider='flatpay'")}) AS flatpay,
    (${active('payment_connections', " AND t.provider='viabill'")}) AS viabill,
    (${active('emballage_connections')}) AS emballage`).first<Record<string, number>>();
  const selected = (await db.prepare(`SELECT i.integration_id AS id,count(DISTINCT i.company_id) AS n FROM company_integrations i JOIN companies c ON c.id=i.company_id WHERE c.status='active' GROUP BY i.integration_id`).all<{id:string;n:number}>()).results;
  return Object.fromEntries(catalog.map(item => [item.id, {connected: row?.[item.id] || 0, selected: selected.find(s => s.id === item.id)?.n || 0}]));
}

export async function apiStatus(requestStatus: typeof fetch = fetch) {
  const checkedAt = new Date().toISOString();
  const connectivity = await Promise.all(catalog.map(item => reachability(endpoints[item.id], requestStatus)));
  return catalog.map((item,index)=>({...item,connectivity:{...connectivity[index],checkedAt}}));
}
