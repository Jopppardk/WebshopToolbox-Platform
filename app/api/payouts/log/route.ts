import {NextRequest,NextResponse} from 'next/server';
import {prepareDatabase} from '@/db/database';
import {readPayoutLog} from '@/db/payout-log';
export async function GET(request:NextRequest){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 const id=request.nextUrl.searchParams.get('externalId')||'',provider=request.nextUrl.searchParams.get('provider')||'',offset=Number(request.nextUrl.searchParams.get('offset')||0);
 if(!id||id.length>300||!['flatpay','shopify_payments','viabill'].includes(provider)||!Number.isSafeInteger(offset)||offset<0)return reply({error:'Ugyldig udbetaling eller side.'},400);
 try{const log=await readPayoutLog(await prepareDatabase(),id,provider,offset);return log?reply(log):reply({error:'Udbetalingen findes ikke på den aktuelle integration i den valgte historik.'},404);}catch{return reply({error:'Udbetalingsloggen kunne ikke hentes. Prøv igen.'},503);}
}
