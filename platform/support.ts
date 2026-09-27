import { HttpError, reply, type Actor, type PlatformEnv } from './types';
import { jsonBody } from './invitations';

export function supportToken(request: Request) {
  return request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('platform_support='))?.slice(17) || '';
}
async function hash(value:string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
}
function cookie(env:PlatformEnv,value='',age=0) {
  return `platform_support=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${env.PLATFORM_ENV!=='local-test'?'; Secure':''}`;
}
type Session={id:string;admin_id:string;user_id:string;company_id:string;expires_at:number;revoked:number};
async function session(request:Request,env:PlatformEnv,admin:Actor) {
  const token=supportToken(request);
  if(!token || !admin.platformAdmin) return null;
  return env.PLATFORM_DB.prepare('SELECT * FROM support_sessions WHERE token_hash=? AND admin_id=?').bind(await hash(token),admin.id).first<Session>();
}
export async function supportActor(request:Request,env:PlatformEnv,admin:Actor):Promise<Actor> {
  if(!supportToken(request)) return admin;
  const row=await session(request,env,admin);
  if(!row || row.revoked || row.expires_at<=Math.floor(Date.now()/1000)) throw new HttpError(403,'Supportadgangen er afsluttet eller udløbet. Tryk Afslut supportadgang.');
  const target=await env.PLATFORM_DB.prepare(`SELECT u.id,u.email,u.full_name,u.phone FROM users u
    JOIN company_memberships m ON m.user_id=u.id AND m.company_id=u.company_id
    JOIN companies c ON c.id=u.company_id WHERE u.id=? AND c.id=? AND u.status='active' AND c.status='active'
    AND u.identity_issuer<>'urn:webshop-toolbox:pending' AND NOT EXISTS(SELECT 1 FROM platform_admins a WHERE a.user_id=u.id)`)
    .bind(row.user_id,row.company_id).first<{id:string;email:string;full_name:string|null;phone:string|null}>();
  if(!target) throw new HttpError(403,'Kundebrugeren har ikke længere adgang. Afslut supportadgang.');
  return {id:target.id,email:target.email,fullName:target.full_name,phone:target.phone,platformAdmin:false,
    support:{sessionId:row.id,adminId:admin.id,adminEmail:admin.email,expiresAt:row.expires_at}};
}
export async function handleSupport(request:Request,env:PlatformEnv,admin:Actor) {
  const db=env.PLATFORM_DB;
  if(request.method==='GET') return reply({active:!!supportToken(request)});
  const input=await jsonBody(request);
  if(request.method==='DELETE') {
    const row=await session(request,env,admin);
    if(row && !row.revoked) await db.batch([
      db.prepare('UPDATE support_sessions SET revoked=1 WHERE id=?').bind(row.id),
      db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,'support.stopped',?,?)")
        .bind(crypto.randomUUID(),row.company_id,admin.id,row.user_id,JSON.stringify({sessionId:row.id})),
    ]);
    return new Response('{}',{headers:{'Content-Type':'application/json','Set-Cookie':cookie(env)}});
  }
  if(request.method!=='POST') throw new HttpError(405,'Ugyldig metode.');
  if(!admin.platformAdmin || !admin.fullName) throw new HttpError(403,'Kræver portaladministrator med udfyldt profil.');
  if(supportToken(request)) throw new HttpError(409,'Afslut den aktuelle supportadgang først.');
  const {companyId,userId,reason}=input;
  if(typeof companyId!=='string'||typeof userId!=='string'||typeof reason!=='string'||reason.trim().length<3||reason.length>300||/[\x00-\x1f]/.test(reason)) throw new HttpError(400,'Vælg virksomhed, bruger og angiv en kort supportårsag.');
  const target=await db.prepare(`SELECT u.id FROM users u JOIN companies c ON c.id=u.company_id
    JOIN company_memberships m ON m.company_id=c.id AND m.user_id=u.id
    WHERE u.id=? AND c.id=? AND u.status='active' AND c.status='active' AND u.full_name IS NOT NULL
    AND u.identity_issuer<>'urn:webshop-toolbox:pending' AND NOT EXISTS(SELECT 1 FROM platform_admins a WHERE a.user_id=u.id)`)
    .bind(userId,companyId).first();
  if(!target) throw new HttpError(403,'Vælg en aktiv, oprettet kundebruger i virksomheden.');
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
  const id=crypto.randomUUID(),expires=Math.floor(Date.now()/1000)+1800;
  await db.batch([
    db.prepare('UPDATE support_sessions SET revoked=1 WHERE admin_id=? AND revoked=0').bind(admin.id),
    db.prepare('INSERT INTO support_sessions(id,token_hash,admin_id,user_id,company_id,reason,expires_at) VALUES(?,?,?,?,?,?,?)').bind(id,await hash(token),admin.id,userId,companyId,reason.trim(),expires),
    db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,'support.started',?,?)").bind(crypto.randomUUID(),companyId,admin.id,userId,JSON.stringify({sessionId:id,reason:reason.trim(),expiresAt:expires})),
  ]);
  return new Response('{}',{status:201,headers:{'Content-Type':'application/json','Set-Cookie':cookie(env,token,28800)}});
}
