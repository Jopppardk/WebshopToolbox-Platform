import {NextResponse} from 'next/server';
import {flatpayDraftAction} from '@/db/flatpay-draft';
import {TransferError} from '@/lib/dinero-sale';
export async function POST(request:Request){
 const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json')||(process.env.NODE_ENV==='production'&&request.headers.get('cf-access-authenticated-user-email')?.toLowerCase()!=='rene@sablen.dk'))return reply({error:'Start handlingen fra Toolbox.'},403);
 try{return reply(await flatpayDraftAction(await request.json() as Parameters<typeof flatpayDraftAction>[0]));}catch(e){return reply({error:e instanceof TransferError?e.message:'Kladdeforslaget kunne ikke behandles.'},422);}
}
