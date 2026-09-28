import {HttpError,type PlatformEnv} from './types';
const day=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function productionWrites(env:PlatformEnv){return env.PLATFORM_ENV==='production'&&String(env.PLATFORM_EXTERNAL_WRITES)==='enabled';}
export async function bookingDate(env:PlatformEnv,company:string,shop:string,provider:string,event:string){
 const dates=(await env.PLATFORM_DB.prepare('SELECT provider,start_date FROM booking_start_dates WHERE company_id=? AND webshop_id=?').bind(company,shop).all<{provider:string;start_date:string}>()).results;
 const start=dates.find(d=>d.provider===provider)?.start_date,account=dates.find(d=>d.provider==='dinero')?.start_date;
 if(!start||!account)throw new HttpError(409,'Gem bogføringsstart for både datakilden og Dinero først.');
 if(!Number.isFinite(Date.parse(event)))throw new HttpError(409,'Posten mangler en gyldig dato.');
 const date=day(event);if(date<start||date<account||date>day(new Date().toISOString()))throw new HttpError(409,'Posten ligger uden for den valgte bogføringsperiode.');
 return date;
}
