import {NextResponse} from 'next/server';
import {manualBooking} from '@/db/manual-booking';
import {TransferError} from '@/lib/dinero-sale';
export async function POST(request:Request){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 const actor=request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase();
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json')||(process.env.NODE_ENV==='production'&&actor!=='rene@sablen.dk'))return reply({error:'Start handlingen fra Toolbox.'},403);
 try{return reply(await manualBooking(await request.json(),actor||'Lokal udvikling'));}
 catch(e){return reply({error:e instanceof TransferError?e.message:'Handlingen kunne ikke gennemføres. Kontrollér status i Dinero før et nyt forsøg.'},422);}
}
