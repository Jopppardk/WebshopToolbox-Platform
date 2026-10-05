import {NextResponse} from 'next/server';
import {syncFlatpay} from '@/db/flatpay-sync';
import {POST as readRecords} from '../records/route';
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
// Manual import uses the scheduler's bounded history/recent windows, without
// changing its cursor or requiring automatic processing to be enabled.
export async function POST(request:Request){
 const origin=new URL(request.url).origin;
 if(request.headers.get('origin')!==origin||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Start hentningen fra Toolbox.'},403);
 try{
  const result=await syncFlatpay('payouts',async(path,body)=>{
   if(path!=='/api/flatpay/records')throw Error('Ugyldig hentning.');
   return readRecords(new Request(new URL(path,origin),{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  },new Date(),true);
  if(result.status==='skipped')return reply({error:result.message},422);
  return reply(result);
 }catch(e){return reply({error:e instanceof Error?e.message:'Flatpay-hentningen fejlede.'},422);}
}
