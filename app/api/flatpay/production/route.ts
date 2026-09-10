import {NextResponse} from 'next/server';
import {flatpayProduction} from '@/db/flatpay-production';
import {TransferError} from '@/lib/dinero-sale';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){try{return reply(await flatpayProduction());}catch{return reply({error:'Driftsstatus kunne ikke hentes.'},503);}}
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json')||(process.env.NODE_ENV==='production'&&request.headers.get('cf-access-authenticated-user-email')?.toLowerCase()!=='rene@sablen.dk'))return reply({error:'Start handlingen fra Toolbox.'},403);
 try{return reply(await flatpayProduction(true));}catch(e){return reply({error:e instanceof TransferError?e.message:'Flatpay kunne ikke aktiveres.'},422);}
}
