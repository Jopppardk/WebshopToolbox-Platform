import { asText } from './tier1/src/lib/format';
import { identity, requireCompany } from './auth';
import {welcomeTemplate,renderWelcome} from './signup';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

export async function jsonBody(request: Request, maxLength = 4096): Promise<Record<string, unknown>> {
  if (request.headers.get('origin') !== new URL(request.url).origin ||
      !request.headers.get('content-type')?.startsWith('application/json'))
    throw new HttpError(403, 'Start handlingen fra portalen.');
  const raw = await request.text();
  if (raw.length > maxLength) throw new HttpError(413, 'Forespørgslen er for stor.');
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { throw new HttpError(400, 'Ugyldig JSON.'); }
}
function email(value: unknown) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()))
    throw new HttpError(400, 'Angiv en gyldig mailadresse.');
  return value.trim().toLowerCase();
}
function profile(input: Record<string, unknown>) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  if (name.length < 2 || name.length > 120 || /[\x00-\x1f]/.test(name) || phone.length > 40 || /[\x00-\x1f]/.test(phone))
    throw new HttpError(400, 'Angiv navn og eventuelt telefonnummer.');
  return { name, phone };
}
async function hash(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
}
function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
}
function deliveryConfig(request: Request, env: PlatformEnv, recipient: string) {
  if (env.PLATFORM_INVITATION_MODE === 'preview' && env.PLATFORM_ENV === 'local-test' &&
      ['127.0.0.1','localhost','[::1]'].includes(new URL(request.url).hostname)) return 'preview';
  if(env.PLATFORM_ENV==='production'&&env.PLATFORM_CUSTOMER_LOGIN==='enabled'&&env.PLATFORM_INVITATION_MODE==='registered'&&env.PLATFORM_INVITATIONS&&env.PLATFORM_INVITATION_FROM==='no-reply@webshoptoolbox.dk')return 'registered';
  const allowed = (env.PLATFORM_INVITATION_RECIPIENTS || '').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  if (env.PLATFORM_INVITATION_MODE !== 'restricted' || !env.PLATFORM_INVITATIONS ||
      !env.PLATFORM_INVITATION_FROM || !allowed.includes(recipient))
    throw new HttpError(503, 'Invitationsmail er ikke aktiveret for denne testmodtager endnu.');
  return 'restricted';
}
async function deliver(request: Request, env: PlatformEnv, invitation: string, recipient: string, token: string, mode: string, adminInvite: boolean) {
  // Origin is deployment configuration, never a client-supplied redirect.
  const origin = env.PLATFORM_ENV === 'local-test' ? new URL(request.url).origin : env.PLATFORM_ENV==='production' ? 'https://portal.webshoptoolbox.dk' : 'https://dev.webshoptoolbox.dk';
  const invitationOrigin=adminInvite&&env.PLATFORM_ADMIN_HOST?'https://'+env.PLATFORM_ADMIN_HOST:origin;
  const link = `${invitationOrigin}${env.PLATFORM_CUSTOMER_LOGIN==='enabled'&&adminInvite?'/admin':''}/onboarding?invitation=${token}`;
  if (mode === 'preview') {
    await env.PLATFORM_DB.prepare("UPDATE invitations SET delivery='preview' WHERE id=?").bind(invitation).run();
    return { delivery: 'preview', previewLink: link };
  }
  // Mark before sending. A timeout is uncertain and must never be retried blindly.
  await env.PLATFORM_DB.prepare("UPDATE invitations SET delivery='uncertain' WHERE id=?").bind(invitation).run();
  try {
    const signup=await env.PLATFORM_DB.prepare('SELECT u.full_name name,c.name company FROM public_signups s JOIN users u ON u.id=s.user_id JOIN companies c ON c.id=s.company_id JOIN invitations i ON i.user_id=u.id WHERE i.id=?').bind(invitation).first<{name:string;company:string}>();
    const welcome=signup?renderWelcome(await welcomeTemplate(env),{...signup,link}):null;
    await env.PLATFORM_INVITATIONS!.send({
      from: env.PLATFORM_INVITATION_FROM!, to: recipient,
      subject: 'Du er inviteret til WebshopToolbox'+(env.PLATFORM_ENV==='production'?'':' (testmiljø)'),
      text: `Du er inviteret til WebshopToolbox. Åbn linket og log ind med denne mailadresse. Udfyld derefter dit navn. Linket gælder i 48 timer og kan kun bruges én gang.\n\n${link}${env.PLATFORM_ENV==='production'?'':'\n\nDette er en testinvitation.'}`,
      ...welcome,
    });
  } catch { return { delivery: 'uncertain' }; }
  await env.PLATFORM_DB.prepare("UPDATE invitations SET delivery='sent' WHERE id=?").bind(invitation).run();
  return { delivery: 'sent' };
}
export async function invite(request: Request, env: PlatformEnv, actor: Actor, company: string | null) {
  if(actor.support) throw new HttpError(403,'Afslut supportadgang og send invitationen fra Toolbox-administrationen.');
  if (company) await requireCompany(env.PLATFORM_DB, actor, company, true);
  else if (!actor.platformAdmin) throw new HttpError(403, 'Kræver portaladministrator.');
  const input = await jsonBody(request), recipient = email(input.email);
  const mode = deliveryConfig(request, env, recipient);
  const role = input.role || 'member';
  if (!['admin','member'].includes(asText(role))) throw new HttpError(400, 'Ugyldig rolle.');
  const id = crypto.randomUUID(), invitation = crypto.randomUUID(), token = newToken();
  const db = env.PLATFORM_DB;
  await db.batch([
    db.prepare("INSERT INTO users(id,email,identity_issuer,identity_subject,company_id,status) VALUES(?,?,'urn:webshop-toolbox:pending',?,?,'inactive')").bind(id,recipient,id,company),
    company
      ? db.prepare(`INSERT INTO company_memberships(company_id,user_id,role) SELECT ?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM company_memberships WHERE company_id=?) THEN 'admin' ELSE ? END`).bind(company,id,company,role)
      : db.prepare('INSERT INTO platform_admins(user_id) VALUES(?)').bind(id),
    db.prepare('INSERT INTO invitations(id,user_id,token_hash,expires_at,created_by) VALUES(?,?,?,?,?)').bind(invitation,id,await hash(token),Math.floor(Date.now()/1000)+172800,actor.id),
    db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,'invitation.created',?,'{}')").bind(crypto.randomUUID(),company,actor.id,id),
  ]);
  return reply({id, ...await deliver(request,env,invitation,recipient,token,mode,company===null)},201);
}
export async function renewInvitation(request: Request, env: PlatformEnv, actor: Actor, company: string | null, id: string) {
  if(actor.support) throw new HttpError(403,'Administrér invitationer fra Toolbox-administrationen.');
  if(company) await requireCompany(env.PLATFORM_DB,actor,company,true);
  else if(!actor.platformAdmin) throw new HttpError(403,'Kræver portaladministrator.');
  await jsonBody(request);
  const db=env.PLATFORM_DB;
  const row=await db.prepare(`SELECT i.id,u.email FROM invitations i JOIN users u ON u.id=i.user_id WHERE u.id=? AND u.company_id IS ? AND i.state<>'accepted'`).bind(id,company).first<{id:string;email:string}>();
  if(!row) throw new HttpError(404,'Invitationen findes ikke.');
  const revoke=request.method==='DELETE', token=newToken();
  const mode=revoke ? '' : deliveryConfig(request,env,row.email);
  const result=await db.batch([
    db.prepare("UPDATE invitations SET token_hash=?,expires_at=?,state=?,delivery='pending' WHERE id=? AND state<>'accepted'").bind(await hash(token),Math.floor(Date.now()/1000)+172800,revoke?'revoked':'pending',row.id),
    db.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),company,actor.id,revoke?'invitation.revoked':'invitation.renewed',id,'{}'),
  ]);
  if(result[0].meta.changes!==1) throw new HttpError(409,'Invitationen er allerede accepteret.');
  return reply(revoke ? {ok:true} : await deliver(request,env,row.id,row.email,token,mode,company===null));
}
export async function onboarding(request: Request, env: PlatformEnv) {
  const claim=await identity(request,env), db=env.PLATFORM_DB;
  if(request.method==='GET') return reply({email:claim.email || ''});
  const input=await jsonBody(request), details=profile(input);
  const token=typeof input.token==='string' ? input.token : '';
  if(!/^[a-f0-9]{64}$/.test(token) || !claim.email) throw new HttpError(400,'Åbn det gyldige invitationslink og log ind med den inviterede mailadresse.');
  const tokenHash=await hash(token), now=Math.floor(Date.now()/1000), claimId=crypto.randomUUID();
  const row=await db.prepare(`SELECT i.id,u.id user_id,u.company_id FROM invitations i JOIN users u ON u.id=i.user_id
    WHERE i.token_hash=? AND i.state='pending' AND i.expires_at>? AND lower(u.email)=? AND u.identity_issuer='urn:webshop-toolbox:pending'
    AND (u.company_id IS NULL OR EXISTS(SELECT 1 FROM companies c WHERE c.id=u.company_id AND c.status='active'))`).bind(tokenHash,now,email(claim.email)).first<{id:string;user_id:string;company_id:string|null}>();
  if(!row) throw new HttpError(403,'Invitationen er udløbet, brugt, tilbagekaldt eller tilhører en anden mailadresse.');
  const result=await db.batch([
    db.prepare("UPDATE invitations SET state='accepted',claim_id=? WHERE id=? AND token_hash=? AND state='pending' AND expires_at>?").bind(claimId,row.id,tokenHash,now),
    db.prepare("UPDATE users SET identity_issuer=?,identity_subject=?,full_name=?,phone=?,status='active' WHERE id=? AND EXISTS(SELECT 1 FROM invitations WHERE id=? AND claim_id=?)").bind(claim.issuer,claim.subject,details.name,details.phone,row.user_id,row.id,claimId),
    db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,?,?,'invitation.accepted',?,'{}' WHERE EXISTS(SELECT 1 FROM invitations WHERE id=? AND claim_id=?)").bind(crypto.randomUUID(),row.company_id,row.user_id,row.user_id,row.id,claimId),
  ]);
  if(result[0].meta.changes!==1) throw new HttpError(409,'Invitationen er allerede brugt.');
  return reply({ok:true});
}
export async function saveProfile(request: Request, env: PlatformEnv, actor: Actor) {
  const details=profile(await jsonBody(request));
  await env.PLATFORM_DB.batch([
    env.PLATFORM_DB.prepare('UPDATE users SET full_name=?,phone=? WHERE id=?').bind(details.name,details.phone,actor.id),
    env.PLATFORM_DB.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,company_id,?,'profile.saved',?,'{}' FROM users WHERE id=?").bind(crypto.randomUUID(),actor.id,actor.id,actor.id),
  ]);
  return reply({ok:true});
}
