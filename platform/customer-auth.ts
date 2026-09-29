import {HttpError,type Actor,type PlatformEnv} from './types';

const encoder=new TextEncoder(),seconds=()=>Math.floor(Date.now()/1000);
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const sessionName='__Host-toolbox_session',challengeName='__Host-toolbox_challenge';
// A normal session lasts 6 hours and ends after 30 idle minutes; a trusted device lasts 30 days and ends after 7 idle days.
const sessionLife={normal:{total:21600,idle:1800},trusted:{total:2592000,idle:604800}};
const cookie=(name:string,value:string,age:number)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
function getCookie(request:Request,name:string){return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';}
function address(value:unknown){if(typeof value!=='string'||value.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value)||/[<>\x00-\x1f]/.test(value))throw new HttpError(400,'Angiv en gyldig mailadresse.');return value.trim().toLowerCase();}
export async function loginHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
async function mac(env:PlatformEnv,value:string){
 if(!/^[a-f0-9]{64}$/.test(env.PLATFORM_LOGIN_SECRET||''))throw new HttpError(503,'Kundelogin er ikke klar endnu.');
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.PLATFORM_LOGIN_SECRET!.match(/../g)!,b=>parseInt(b,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(JSON.stringify([env.PLATFORM_ENV,'customer-login-v1',value])))),b=>b.toString(16).padStart(2,'0')).join('');
}
async function input(request:Request){
 if(request.method!=='POST'||request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(403,'Start fra login-siden.');
 const raw=await request.text();if(raw.length>2048)throw new HttpError(413,'Forespørgslen er for stor.');
 try{const data=JSON.parse(raw);if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data as Record<string,unknown>;}catch{throw new HttpError(400,'Ugyldig forespørgsel.');}
}
async function limit(env:PlatformEnv,key:string,max:number,period:number){
 const now=seconds(),bucket=Math.floor(now/period),id=await mac(env,key+':'+bucket);
 const row=await env.PLATFORM_DB.prepare('INSERT INTO customer_login_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(id,(bucket+2)*period).first<{count:number}>();
 if(!row||row.count>max)throw new HttpError(429,'For mange forsøg. Vent lidt, og prøv igen.');
}
export const loginLimit=limit;
export async function customerActor(request:Request,env:PlatformEnv):Promise<Actor>{
 const token=getCookie(request,sessionName);if(!/^[a-f0-9]{64}$/.test(token))throw new HttpError(401,'Log ind for at fortsætte.');
 const now=seconds(),hash=await loginHash(token);
 const user=await env.PLATFORM_DB.prepare(`SELECT u.id,u.email,u.full_name,u.phone FROM customer_sessions s JOIN users u ON u.id=s.user_id JOIN companies c ON c.id=u.company_id
 WHERE s.token_hash=? AND s.expires_at>? AND s.last_seen+s.idle_seconds>? AND u.status='active' AND c.status='active'
 AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=u.company_id AND m.user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM platform_admins a WHERE a.user_id=u.id)`).bind(hash,now,now).first<{id:string;email:string;full_name:string|null;phone:string|null}>();
 if(!user)throw new HttpError(401,'Din session er udløbet. Log ind igen.');
 const trial=await env.PLATFORM_DB.prepare('SELECT trial_ends_at FROM public_signups WHERE company_id=(SELECT company_id FROM users WHERE id=?)').bind(user.id).first<{trial_ends_at:number|null}>();
 if(trial?.trial_ends_at&&trial.trial_ends_at<=now)throw new HttpError(403,'Din gratis prøveperiode er udløbet. Kontakt info@webshoptoolbox.dk for at aftale fortsættelse. Der er ikke opkrævet betaling.');
 await env.PLATFORM_DB.prepare('UPDATE customer_sessions SET last_seen=? WHERE token_hash=?').bind(now,hash).run();
 return {id:user.id,email:user.email,fullName:user.full_name,phone:user.phone,platformAdmin:false};
}
export async function customerLogout(request:Request,env:PlatformEnv){
 if(request.method!=='POST'||request.headers.get('origin')!==new URL(request.url).origin)throw new HttpError(403,'Start fra portalen.');
 const hash=await loginHash(getCookie(request,sessionName));await env.PLATFORM_DB.prepare('DELETE FROM customer_sessions WHERE token_hash=?').bind(hash).run();
 const headers=new Headers({Location:'/login'});headers.append('Set-Cookie',cookie(sessionName,'',0));headers.append('Set-Cookie',cookie(challengeName,'',0));return new Response(null,{status:303,headers});
}
export async function customerLogin(request:Request,env:PlatformEnv,action:string){
 const body=await input(request),db=env.PLATFORM_DB,now=seconds(),ip=request.headers.get('cf-connecting-ip')||(env.PLATFORM_ENV==='local-test'?'local':null);
 if(!ip)throw new HttpError(403,'Åbn portalen via dens sikre adresse.');
 await limit(env,'ip:'+ip+':'+action,action==='start'?10:30,600);
 if(action==='start'){
  const email=address(body.email),invitation=typeof body.invitation==='string'&&/^[a-f0-9]{64}$/.test(body.invitation)?body.invitation:null;
  await limit(env,'email:'+email,3,600);await limit(env,'global-mail',50,600);
  await db.batch([db.prepare('DELETE FROM customer_login_limits WHERE expires_at<?').bind(now),db.prepare('DELETE FROM customer_login_challenges WHERE expires_at<?').bind(now),db.prepare('DELETE FROM customer_sessions WHERE expires_at<? OR last_seen+idle_seconds<?').bind(now,now)]);
  const invitationHash=invitation?await loginHash(invitation):null;
  const user=await db.prepare(`SELECT u.id,i.id invitation_id,i.token_hash FROM users u JOIN companies c ON c.id=u.company_id LEFT JOIN invitations i ON i.user_id=u.id
   WHERE lower(u.email)=? AND c.status='active' AND NOT EXISTS(SELECT 1 FROM platform_admins a WHERE a.user_id=u.id)
   AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=u.company_id AND m.user_id=u.id)
   AND ((u.status='active' AND ? IS NULL) OR (u.identity_issuer='urn:webshop-toolbox:pending' AND i.state='pending' AND i.expires_at>? AND i.token_hash=?))`).bind(email,invitationHash,now,invitationHash).first<{id:string;invitation_id:string|null;token_hash:string|null}>();
  const id=random(),browser=random();let n:number;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=4200000000);const code=String(n%100000000).padStart(8,'0');
  await db.prepare('INSERT INTO customer_login_challenges(id,user_id,code_hash,browser_hash,invitation_id,invitation_hash,expires_at) VALUES(?,?,?,?,?,?,?)').bind(id,user?.id||null,await mac(env,id+':'+code),await loginHash(browser),invitation?user?.invitation_id||null:null,invitation?user?.token_hash||null:null,now+600).run();
  let preview:string|undefined;
  if(user){
   if(env.PLATFORM_ENV==='local-test')preview=code;
   else if(env.PLATFORM_AUTH_MAIL&&(env.PLATFORM_ENV==='production'||['rj@itm8.com','rene.jeppesen@live.dk'].includes(email))){
    // One attempt per challenge. On uncertainty we never repeat this external write.
    await db.prepare("UPDATE customer_login_challenges SET delivery='uncertain' WHERE id=?").bind(id).run();
    try{const result=await env.PLATFORM_AUTH_MAIL.send({from:{email:'no-reply@webshoptoolbox.dk',name:'WebshopToolbox'},to:email,subject:'Din login-kode til WebshopToolbox',text:`Din login-kode er: ${code}\n\nKoden gælder i 10 minutter og kan kun bruges én gang i den browser, hvor du bad om den. Del aldrig koden med andre.\n\nHvis du ikke har bedt om koden, kan du ignorere denne mail.\n\nWebshopToolbox`});if(result?.messageId)await db.prepare("UPDATE customer_login_challenges SET delivery='accepted' WHERE id=?").bind(id).run();}catch{/* Keep uncertain; generic response prevents account enumeration. */}
   }
  }
  return new Response(JSON.stringify({challenge:id,message:'Hvis adressen har adgang, modtager du en mail med en kode.',...(preview?{previewCode:preview}:{})}),{headers:{'Content-Type':'application/json','Set-Cookie':cookie(challengeName,browser,600)}});
 }
 if(action!=='verify')throw new HttpError(404,'Loginsiden findes ikke.');
 const id=typeof body.challenge==='string'?body.challenge:'',code=typeof body.code==='string'?body.code.replace(/\s/g,''):'',browser=getCookie(request,challengeName);
 if(!/^[a-f0-9]{64}$/.test(id)||!/^\d{8}$/.test(code)||!browser)throw new HttpError(401,'Koden er ugyldig eller udløbet.');
 const browserHash=await loginHash(browser),codeHash=await mac(env,id+':'+code);
 const row=await db.prepare(`UPDATE customer_login_challenges SET attempts=attempts+1 WHERE id=? AND browser_hash=? AND expires_at>? AND consumed=0 AND attempts<5 RETURNING user_id,code_hash,invitation_id,invitation_hash`).bind(id,browserHash,now).first<{user_id:string|null;code_hash:string;invitation_id:string|null;invitation_hash:string|null}>();
 if(!row||!row.user_id||row.code_hash!==codeHash)throw new HttpError(401,'Koden er ugyldig eller udløbet.');
 const name=typeof body.name==='string'?body.name.trim():'',phone=typeof body.phone==='string'?body.phone.trim():'';
 if(row.invitation_id&&(name.length<2||name.length>120||phone.length>40||/[\x00-\x1f]/.test(name+phone)))throw new HttpError(400,'Udfyld dit fulde navn og eventuelt telefonnummer.');
 const claim=random(),token=random(),hash=await loginHash(token),life=body.trustDevice===true?sessionLife.trusted:sessionLife.normal;
 const statements=[db.prepare('UPDATE customer_login_challenges SET consumed=1,claim_id=? WHERE id=? AND consumed=0 AND expires_at>? AND code_hash=? AND browser_hash=?').bind(claim,id,now,codeHash,browserHash)];
 if(row.invitation_id){
  statements.push(db.prepare(`UPDATE invitations SET state='accepted',claim_id=? WHERE id=? AND state='pending' AND expires_at>? AND token_hash=? AND EXISTS(SELECT 1 FROM customer_login_challenges WHERE id=? AND claim_id=?)`).bind(claim,row.invitation_id,now,row.invitation_hash,id,claim));
  statements.push(db.prepare(`UPDATE users SET identity_issuer='urn:webshop-toolbox:customer',identity_subject=id,full_name=?,phone=?,status='active' WHERE id=? AND company_id IS NOT NULL AND identity_issuer='urn:webshop-toolbox:pending' AND EXISTS(SELECT 1 FROM invitations WHERE id=? AND claim_id=?)`).bind(name,phone,row.user_id,row.invitation_id,claim));
 }
 // Session insertion is last and still validates role/status; an Access identity never promotes a customer.
 statements.push(db.prepare(`INSERT INTO customer_sessions(token_hash,user_id,expires_at,last_seen,created_at,idle_seconds) SELECT ?,u.id,?,?,?,? FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=? AND u.status='active' AND c.status='active' AND NOT EXISTS(SELECT 1 FROM platform_admins a WHERE a.user_id=u.id) AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=u.company_id AND m.user_id=u.id) AND EXISTS(SELECT 1 FROM customer_login_challenges WHERE id=? AND claim_id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM invitations WHERE id=? AND claim_id=?))`).bind(hash,now+life.total,now,now,life.idle,row.user_id,id,claim,row.invitation_id,row.invitation_id,claim));
 const result=await db.batch(statements);
 if(result[result.length-1].meta.changes!==1)throw new HttpError(401,'Koden er brugt, eller adgangen er ændret.');
 await db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,company_id,id,'customer.login',id,'{}' FROM users WHERE id=?").bind(crypto.randomUUID(),row.user_id).run();
 const old=getCookie(request,sessionName);if(old)await db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').bind(await loginHash(old)).run();
 const headers=new Headers({'Content-Type':'application/json'});headers.append('Set-Cookie',cookie(sessionName,token,life.total));headers.append('Set-Cookie',cookie(challengeName,'',0));return new Response(JSON.stringify({ok:true}),{headers});
}
