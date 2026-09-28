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

export async function apiStatus(requestStatus: typeof fetch = fetch) {
  const checkedAt = new Date().toISOString();
  const probes = Promise.all(catalog.map(item => reachability(endpoints[item.id], requestStatus)));
  let state = 'unknown';
  try {
    // Public, provider-reported API health only. Never follow redirects or use credentials.
    const response = await requestStatus('https://www.shopifystatus.com/api/v2/components.json',
      {method:'GET',redirect:'error',signal:AbortSignal.timeout(5000)});
    if(response.ok) {
      const data = await response.json() as {components?: {name:string;status:string}[]};
      const api = data.components?.find(c=>c.name==='API & Mobile' || c.name==='API');
      if(api?.status==='operational') state='available';
      else if(api && ['degraded_performance','partial_outage','major_outage','under_maintenance'].includes(api.status)) state='disrupted';
    }
  } catch { /* Unknown is not proof of provider downtime. */ }
  const connectivity = await probes;
  return catalog.map((item,index)=>({...item,availability:'pending',connectivity:{...connectivity[index],checkedAt},api: item.id==='shopify'
    ? {state,checkedAt,source:'https://www.shopifystatus.com/',detail:'Udbyderens offentlige API-status. Kundens forbindelse er ikke testet.'}
    : {state:'unknown',checkedAt:null,source:null,detail:'Ingen verificeret offentlig API-statuskilde tilknyttet endnu.'}}));
}
