import {HttpError,type PlatformEnv} from './types';
export type ReceiptKey={company:string;shop:string;provider:string;module:string;externalId:string;destination:string};
export type Receipt={phase:'prepared'|'creating'|'draft'|'booking'|'booked'|'sending'|'accepted'|'uncertain';version:string;payload:Record<string,any>};
const args=(key:ReceiptKey)=>[key.company,key.shop,key.provider,key.module,key.externalId,key.destination];
const where='company_id=? AND webshop_id=? AND provider=? AND module=? AND external_id=? AND destination=?';
export async function readReceipt(env:PlatformEnv,key:ReceiptKey):Promise<Receipt|null>{
 const row=await env.PLATFORM_DB.prepare('SELECT phase,version,payload_json FROM production_receipts WHERE '+where).bind(...args(key)).first<{phase:Receipt['phase'];version:string;payload_json:string}>();
 return row?{phase:row.phase,version:row.version,payload:JSON.parse(row.payload_json)}:null;
}
export async function saveReceipt(env:PlatformEnv,key:ReceiptKey,previous:Receipt|null,phase:Receipt['phase'],payload:Record<string,any>):Promise<Receipt>{
 const transitions:Record<string,string[]>={prepared:['prepared','creating'],creating:['creating','draft','booked','uncertain'],draft:['booking'],booking:['booked','uncertain'],sending:['accepted','uncertain'],uncertain:['booked'],booked:[],accepted:[]};
 if(previous?!transitions[previous.phase].includes(phase):!['prepared','sending'].includes(phase))throw new HttpError(409,'En afsluttet eller uafklaret behandling kan ikke genstartes.');
 const version=crypto.randomUUID();
 const result=previous?await env.PLATFORM_DB.prepare('UPDATE production_receipts SET phase=?,version=?,payload_json=?,updated_at=CURRENT_TIMESTAMP WHERE '+where+' AND version=?').bind(phase,version,JSON.stringify(payload),...args(key),previous.version).run():await env.PLATFORM_DB.prepare('INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(...args(key),phase,version,JSON.stringify(payload)).run();
 if(result.meta.changes!==1)throw new HttpError(409,'Posten behandles allerede eller er ændret. Hent status igen.');
 return {phase,version,payload};
}
export async function uncertainReceipt(env:PlatformEnv,key:ReceiptKey,current:Receipt){
 if(['accepted','booked'].includes(current.phase))return;
 try{await saveReceipt(env,key,current,'uncertain',current.payload);}catch{/* A durable earlier claim still prevents a second write. */}
}
