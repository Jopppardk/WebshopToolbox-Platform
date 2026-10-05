// Shared by the Tier 1 data handlers (tier1-data.ts and its area modules).
import { HttpError, type Actor, type PlatformEnv } from './types';
export type DataContext = { request: Request; env: PlatformEnv; actor: Actor; company: string; shop: string; path: string; db: D1Database; url: URL; get: boolean };
export const forwarded=(request:Request,body:unknown,method='POST')=>new Request(request.url,{method,headers:request.headers,body:JSON.stringify(body)});
export function minor(amount:string,currency:string){const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits!;const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);if(!match||/[1-9]/.test((match[3]||'').slice(digits)))throw new HttpError(409,'Ugyldigt beløb.');const n=Number(match[2])*10**digits+Number((match[3]||'').padEnd(digits,'0').slice(0,digits));if(!Number.isSafeInteger(n))throw new HttpError(409,'Beløbet er for stort.');return match[1]?-n:n;}
export function pageNumber(value:string|null,fallback:number,max=100000){const n=value===null?fallback:Number(value);if(!Number.isSafeInteger(n)||n<0||n>max)throw new HttpError(400,'Ugyldigt sidetal.');return n;}
