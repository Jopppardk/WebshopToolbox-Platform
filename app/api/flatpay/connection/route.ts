import {validStartDate} from '@/db/integration-start';
import { NextResponse } from 'next/server';
import { loadCredentials,saveCredentials } from '@/db/credentials';
import { flatpayRead,safeAgreement } from '@/lib/flatpay-api';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){try{const c=await loadCredentials('flatpay');return reply(c?{connected:true,agreementNumber:c.agreementNumber,startDate:c.startDate}:{connected:false});}catch{return reply({error:'Flatpay-forbindelsen kunne ikke læses.'},503);}}
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Start handlingen fra integrationssiden.'},403);
 try{
  const b=await request.json() as {username:string;password:string;agreementNumber:string;startDate:string;action:string};
  if(b.action==='start-date'){if(!b.startDate||!validStartDate(b.startDate))throw Error('Angiv en gyldig startdato.');const c=await loadCredentials('flatpay');if(!c)throw Error('Forbind Flatpay først.');await saveCredentials('flatpay',{...c,startDate:b.startDate},'Flatpay · '+c.agreementNumber);return reply({connected:true,startDate:b.startDate});}
  if(typeof b.username!=='string'||typeof b.password!=='string'||b.username.length>300||b.password.length>2000)throw Error('Angiv API-brugernavn og adgangskode.');
  const access={username:b.username.trim(),password:b.password};
  const agreements=(await flatpayRead(access,'agreements')).map(safeAgreement);
  if(!agreements.length)throw Error('Flatpay accepterede forespørgslen, men returnerede ingen aftaler. Bed Flatpay bekræfte, at API-brugeren er knyttet til jeres indløsningsaftale.');
  if(b.action==='validate')return reply({agreements});
  if(b.action!=='save')throw Error('Ugyldig handling.');
  const matches=agreements.filter(a=>a.agreementNumber===b.agreementNumber);
  if(matches.length!==1)throw Error('Vælg én entydig Flatpay-aftale fra listen.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(b.startDate)||!Number.isFinite(Date.parse(b.startDate))||new Date(b.startDate).toISOString().slice(0,10)!==b.startDate)throw Error('Angiv en gyldig startdato.');
  await saveCredentials('flatpay',{...access,...matches[0],agreementId:matches[0].id,startDate:b.startDate},'Flatpay · '+matches[0].agreementNumber);
  return reply({connected:true,agreementNumber:matches[0].agreementNumber,startDate:b.startDate});
 }catch(e){return reply({error:e instanceof Error?e.message:'Flatpay kunne ikke forbindes.'},422);}
}
