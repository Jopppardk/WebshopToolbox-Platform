import { NextResponse } from 'next/server';
import { prepareDatabase } from '@/db/database';
import { integrationSelection,selectIntegration } from '@/db/integration-selection';
import { integrationCatalog,type IntegrationId } from '@/lib/integration-catalog';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET() {
  try {return reply(await integrationSelection(await prepareDatabase()));}
  catch {return reply({error:'Valgte integrationer kunne ikke hentes.'},503);}
}
export async function POST(request:Request) {
  if(request.headers.get('origin')!==new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json')) return reply({error:'Start handlingen fra integrationssiden.'},403);
  let body:{provider?:unknown;action?:unknown};
  try {body=await request.json() as typeof body;} catch {return reply({error:'Ugyldig handling.'},400);}
  if(!body || !integrationCatalog.some(p=>p.id===body.provider) || (body.action!=='add' && body.action!=='remove')) return reply({error:'Ugyldig integration eller handling.'},400);
  try {
    const db=await prepareDatabase();
    if(!await selectIntegration(db,body.provider as IntegrationId,body.action==='add')) return reply({error:'Integrationen er forbundet og kan derfor ikke fjernes fra oversigten.'},409);
    return reply(await integrationSelection(db));
  } catch {return reply({error:'Valget kunne ikke gemmes. Prøv igen.'},503);}
}
