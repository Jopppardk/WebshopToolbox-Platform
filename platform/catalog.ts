// Code-maintained catalog. No customer credentials or production adapters.
export const catalog = [
  {id:'shopify',name:'Shopify',category:'Webshop',description:'Salg, tilbagebetalinger, udbetalinger og lager.'},
  {id:'dinero',name:'Dinero',category:'Regnskab',description:'Bilag, kontoplan og økonomisk overblik.'},
  {id:'flatpay',name:'Flatpay',category:'Betaling',description:'Transaktioner, afregninger og udbetalinger.'},
  {id:'viabill',name:'ViaBill',category:'Betaling',description:'Betalinger og afregningsdata.'},
  {id:'emballage',name:'Emballage Indberetning',category:'Producentansvar',description:'Kvartalsvis indberetning af emballage.'},
] as const;

export async function apiStatus(requestStatus: typeof fetch = fetch) {
  const checkedAt = new Date().toISOString();
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
  return catalog.map(item=>({...item,availability:'pending',api: item.id==='shopify'
    ? {state,checkedAt,source:'https://www.shopifystatus.com/',detail:'Udbyderens offentlige API-status. Kundens forbindelse er ikke testet.'}
    : {state:'unknown',checkedAt:null,source:null,detail:'Ingen verificeret offentlig API-statuskilde tilknyttet endnu.'}}));
}
