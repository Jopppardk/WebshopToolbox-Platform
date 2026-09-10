import {integrationStart} from './integration-start';
import { schemaStatements } from './schema';
import { database } from './database';
import { loadCredentials } from './credentials';
import { calculateFinance, financePeriods, parseEntries, type LedgerEntry, type LedgerYear } from '@/lib/dashboard-finance';

type State = { inventoryComplete?: boolean; loaded: LedgerYear[]; categories: Record<string,string>; cursor: string; checkedAt?: string; retryAt?: number; leaseUntil?: number; owner?: string; error?: string };
const tenant = 'sablen.dk';
export async function syncDashboardFinance() {
  const credentials = await loadCredentials('dinero', true);
  if (!credentials?.organizationId) return { status: 'skipped' as const, message: 'Dinero er ikke forbundet.' };
  const db = database(), startDate=await integrationStart(db,'dinero'), key = 'dashboard_finance:' + credentials.organizationId + (startDate?':'+startDate:'');
  await db.batch(schemaStatements.filter(sql=>sql.includes('dashboard_ledger')).map(sql=>db.prepare(sql)));
  const row = await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,key).first<{ setting_value:string }>();
  const state: State = row ? JSON.parse(row.setting_value) : { loaded:[], categories:{}, cursor: new Date().toISOString() };
  if ((state.leaseUntil || 0) > Date.now() || (state.retryAt || 0) > Date.now()) return { status: 'skipped' as const, message: 'Dashboardets regnskabstal er opdateret eller hentes allerede.' };
  const claim = { ...state, owner:crypto.randomUUID(), leaseUntil:Date.now()+10*60000 };
  const raw = JSON.stringify(claim);
  const lock = row
    ? await db.prepare('UPDATE app_settings SET setting_value=? WHERE tenant=? AND setting_key=? AND setting_value=?').bind(raw,tenant,key,row.setting_value).run()
    : await db.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(tenant,key,raw).run();
  if (lock.meta.changes !== 1) return { status:'skipped' as const, message:'Regnskabstal hentes allerede.' };
  let failure = '';
  try {
    const response = await fetch('https://authz.dinero.dk/dineroapi/oauth/token', { method:'POST', redirect:'manual', signal:AbortSignal.timeout(15000), headers:{ Authorization:`Basic ${btoa(credentials.clientId+':'+credentials.clientSecret)}`, 'Content-Type':'application/x-www-form-urlencoded' }, body:new URLSearchParams({ grant_type:'password',scope:'read write',username:credentials.apiKey,password:credentials.apiKey }) });
    if (!response.ok) throw new Error('Dinero-adgangen kunne ikke fornyes.');
    const token = await response.json() as { access_token?:string };
    if (!token.access_token) throw new Error('Dinero-adgangen kunne ikke fornyes.');
    const read = async (path:string) => {
      const result = await fetch(`https://api.dinero.dk/v1/${encodeURIComponent(credentials.organizationId)}/${path}`, { redirect:'manual',cache:'no-store', signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token.access_token}`,Accept:'application/json'} });
      if (!result.ok) throw new Error(`Dinero-regnskabstal kunne ikke hentes (HTTP ${result.status}).`);
      return result.json();
    };
    const yearRows = await read('accountingyears') as Array<{ FromDate:string; ToDate:string }>;
    if (!Array.isArray(yearRows) || yearRows.some(y=>!/^\d{4}-\d{2}-\d{2}$/.test(y.FromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(y.ToDate))) throw new Error('Dinero returnerede ukendte regnskabsår.');
    const p = financePeriods();
    state.inventoryComplete=yearRows.some(y=>y.FromDate<=p.today&&y.ToDate>=p.today&&y.FromDate>=startDate);
    const years = yearRows.map(y=>({from:y.FromDate>startDate?y.FromDate:startDate,to:y.ToDate})).filter(y=>y.to>=(startDate||p.priorYearStart) && y.from<=p.today && y.from<=y.to).sort((a,b)=>b.from.localeCompare(a.from));
    const accountRows = await read('accounts/entry?fields=AccountNumber,Category') as Array<{AccountNumber:number;Category:string}>;
    if (!Array.isArray(accountRows) || accountRows.some(a=>!Number.isInteger(a.AccountNumber) || typeof a.Category!=='string')) throw new Error('Dinero returnerede en ukendt kontoplan.');
    state.categories = Object.fromEntries(accountRows.map(a=>[a.AccountNumber,a.Category]));
    const missing = years.find(y=>!state.loaded.some(l=>l.from===y.from && l.to===y.to));
    let entries: LedgerEntry[];
    let cursor = state.cursor;
    if (missing) {
      entries = parseEntries(await read('entries?' + new URLSearchParams({fromDate:missing.from,toDate:missing.to,includePrimo:'true'})));
      if (entries.some(e=>e.date<missing.from || e.date>missing.to)) throw new Error('Dinero returnerede posteringer uden for regnskabsåret.');
    } else {
      const end = new Date(Math.min(Date.now(),Date.parse(state.cursor)+30*86400000)).toISOString();
      // Inclusive overlap is safe: EntryGuid upserts replace, including revised primo balances.
      entries = parseEntries(await read('entries/changes?' + new URLSearchParams({ changesFrom:state.cursor,changesTo:end,includePrimo:'true' })));
      cursor = end;
    }
    entries=entries.filter(e=>e.date>=startDate);
    for (let i=0;i<entries.length;i+=100) await db.batch(entries.slice(i,i+100).map(e=>db.prepare('INSERT INTO dashboard_ledger(organization,guid,account,date,minor,type) VALUES(?,?,?,?,?,?) ON CONFLICT(organization,guid) DO UPDATE SET account=excluded.account,date=excluded.date,minor=excluded.minor,type=excluded.type').bind(credentials.organizationId,e.guid,e.account,e.date,e.minor,e.type)));
    if (missing) state.loaded = [...state.loaded.filter(y=>y.from!==missing.from), missing];
    state.cursor = cursor;
    state.checkedAt = new Date().toISOString();
    state.error = undefined;
    state.retryAt = Date.now() + (missing || Date.now()-Date.parse(cursor)>60000 ? 15000 : 300000);
  } catch (error) {
    failure = error instanceof Error && /^(Dinero|Regnskab)/.test(error.message) ? error.message : 'Regnskabstal kunne ikke opdateres. Prøv senere.';
    state.error = failure; state.retryAt = Date.now()+300000;
  }
  const saved = await db.prepare('UPDATE app_settings SET setting_value=?,updated_at=CURRENT_TIMESTAMP WHERE tenant=? AND setting_key=? AND setting_value=?').bind(JSON.stringify({...state,leaseUntil:0,owner:undefined}),tenant,key,raw).run();
  if (saved.meta.changes!==1) throw new Error('Regnskabstallenes slutstatus kunne ikke gemmes.');
  if (failure) throw new Error(failure);
  return { status:'succeeded' as const,message:'Dashboardets Dinero-posteringer blev opdateret.' };
}
export async function dashboardFinance() {
  const credentials = await loadCredentials('dinero',true);
  if (!credentials?.organizationId) return { ready:false, message:'Forbind Dinero under Indstillinger for at se regnskabstal.', data:null };
  const db=database(),startDate=await integrationStart(db,'dinero');
  const row=await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind(tenant,'dashboard_finance:'+credentials.organizationId+(startDate?':'+startDate:'')).first<{setting_value:string}>();
  const state:State|null=row?JSON.parse(row.setting_value):null;
  if (!state || state.leaseUntil || state.error) return { ready:false, message:state?.error || 'Henter regnskabsgrundlaget fra Dinero…',data:null };
  const settings=await db.prepare("SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key='admin_settings'").bind(tenant).first<{setting_value:string}>();
  const account = Number(JSON.parse(settings?.setting_value || '{}').accounts?.inventory?.match(/^\d+/)?.[0]) || null;
  const entries=await db.prepare('SELECT guid,account,date,minor,type FROM dashboard_ledger WHERE organization=? AND date>=?').bind(credentials.organizationId,[startDate,...state.loaded.map(y=>y.from)].filter(Boolean).sort()[0]||'9999-12-31').all<LedgerEntry>();
  const data=calculateFinance(entries.results,state.categories,state.loaded,account && state.categories[account] ? account:null);
  if(startDate&&state.inventoryComplete!==true)data.inventory=null;
  return { ready:true, data, checkedAt:state.checkedAt, through:state.cursor, stale:Date.now()-Date.parse(state.cursor)>10*60000,
    message: account ? 'Bogførte posteringer · resultat før skat · lagerværdi fra Dinero-konto '+account : 'Vælg lagerkonto under Indstillinger for at vise lagerværdi.' };
}
