import {NextRequest,NextResponse} from 'next/server';
import {prepareDatabase} from '@/db/database';
import {integrationStart,validStartDate,type DatedIntegration} from '@/db/integration-start';
import {loadHistory} from '@/db/history';
import {historyWindow} from '@/lib/history-policy';
import {financePeriods} from '@/lib/dashboard-finance';
import {loadCredentials} from '@/db/credentials';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
function provider(value:unknown):DatedIntegration {if(value!=='shopify'&&value!=='viabill'&&value!=='dinero')throw Error('Ugyldig integration.');return value;}
export async function GET(request:NextRequest){try{
 const db=await prepareDatabase(),p=provider(request.nextUrl.searchParams.get('provider')),saved=await integrationStart(db,p);
 let inherited:string,source:string;
 if(p==='dinero'){
  const c=await loadCredentials('dinero',true);
  const row=c?await db.prepare('SELECT setting_value FROM app_settings WHERE tenant=? AND setting_key=?').bind('sablen.dk','dashboard_finance:'+c.organizationId).first<{setting_value:string}>():null;
  const years: Array<{from:string}>=row?JSON.parse(row.setting_value).loaded||[]:[];
  inherited=[financePeriods().priorYearStart,...years.map(y=>y.from)].sort()[0];source='Eksisterende regnskabsgrundlag (indeværende og foregående år).';
 }else{const policy=await loadHistory(db);inherited=policy.startDate||historyWindow(policy).effectiveDate;source=policy.startDate?'Arvet fra fælles startdato.':'Rullende historikgrænse. Datoen flytter sig automatisk, indtil du gemmer en fast dato.';}
 return reply({startDate:saved||inherited,inherited:!saved,source:saved?'Individuel startdato.':source});
 }catch{return reply({error:'Startdatoen kunne ikke læses.'},422);}}
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Start handlingen fra indstillingerne.'},403);
 try{const b=await request.json() as {provider:unknown;startDate:unknown};const p=provider(b.provider);if(!validStartDate(b.startDate))throw Error('Vælg en gyldig startdato.');
 const db=await prepareDatabase();await db.prepare('INSERT INTO app_settings(tenant,setting_key,setting_value) VALUES(?,?,?) ON CONFLICT(tenant,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP').bind('sablen.dk','integration_start:'+p,JSON.stringify(b.startDate)).run();return reply({startDate:b.startDate});
 }catch(e){return reply({error:e instanceof Error?e.message:'Startdatoen kunne ikke gemmes.'},422);}
}
