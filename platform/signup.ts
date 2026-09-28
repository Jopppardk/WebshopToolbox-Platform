import {HttpError,reply,type Actor,type PlatformEnv} from './types';
import {jsonBody} from './invitations';
import {loginHash, loginLimit} from './customer-auth';

export const signupTerms='2026-09-28';
type Template={subject:string;body:string;version:number};
export async function welcomeTemplate(env:PlatformEnv){
 const row=await env.PLATFORM_DB.prepare('SELECT subject,body,version FROM welcome_template WHERE id=1').first<Template>();
 if(!row)throw new HttpError(503,'Tilmelding er ikke klar endnu.');return row;
}
export function renderWelcome(template:Template,values:{name:string;company:string;link:string}){
 const render=(text:string)=>text.replace(/\{\{(name|company|link)\}\}/g,(_,key:keyof typeof values)=>values[key]);
 return {subject:render(template.subject),text:render(template.body)+'\n\nLinket gælder i 48 timer. Log ind med den mailadresse, du tilmeldte dig med. Linket giver ikke adgang uden bekræftelse af mailadressen.'};
}
export async function signupSettings(request:Request,env:PlatformEnv,actor:Actor){
 if(!actor.platformAdmin||actor.support)throw new HttpError(403,'Kræver Toolbox-administrator.');
 if(request.method==='GET')return reply(await welcomeTemplate(env));
 if(request.method!=='PUT')throw new HttpError(405,'Metoden understøttes ikke.');
 const b=await jsonBody(request,10000),subject=typeof b.subject==='string'?b.subject.trim():'',body=typeof b.body==='string'?b.body.trim():'';
 if(!subject||subject.length>160||/[\x00-\x1f]/.test(subject)||body.length<20||body.length>6000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body)||!body.includes('{{link}}')||!Number.isInteger(b.version))throw new HttpError(400,'Angiv emne og tekst med {{link}}.');
 if([... (subject+' '+body).matchAll(/\{\{([^}]+)\}\}/g)].some(m=>!['name','company','link'].includes(m[1])))throw new HttpError(400,'Brug kun {{name}}, {{company}} og {{link}}.');
 const db=env.PLATFORM_DB,claim=crypto.randomUUID();
 const result=await db.batch([
 db.prepare('UPDATE welcome_template SET subject=?,body=?,version=version+1 WHERE id=1 AND version=?').bind(subject,body,b.version),
 db.prepare("INSERT INTO audit_events(id,actor_id,action,resource_id,details_json) SELECT ?,?,'signup.template.saved','welcome','{}' WHERE changes()=1").bind(claim,actor.id)]);
 if(result[0].meta.changes!==1)throw new HttpError(409,'Skabelonen er ændret. Genindlæs før du gemmer.');return reply({ok:true});
}
export async function signupOverview(request:Request,env:PlatformEnv,actor:Actor){
 if(!actor.platformAdmin||actor.support)throw new HttpError(403,'Kræver Toolbox-administrator.');
 const db=env.PLATFORM_DB;
 if(request.method==='POST'){
  const body=await jsonBody(request);if(typeof body.companyId!=='string')throw new HttpError(400,'Vælg en virksomhed.');
  const result=await db.batch([db.prepare('UPDATE public_signups SET contacted_at=unixepoch() WHERE company_id=? AND trial_started_at IS NOT NULL AND contacted_at IS NULL').bind(body.companyId),db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,?,?,'signup.contacted',?,'{}' WHERE changes()=1").bind(crypto.randomUUID(),body.companyId,actor.id,body.companyId)]);
  if(!result[0].meta.changes)throw new HttpError(409,'Virksomheden er allerede markeret eller endnu ikke aktiveret.');return reply({ok:true});
 }
 if(request.method!=='GET')throw new HttpError(405,'Metoden understøttes ikke.');
 const rows=await db.prepare(`SELECT s.*,c.name,u.email,i.delivery,i.state invitation_state FROM public_signups s JOIN companies c ON c.id=s.company_id JOIN users u ON u.id=s.user_id JOIN invitations i ON i.user_id=u.id ORDER BY s.contacted_at IS NOT NULL,s.contact_due_at IS NULL,s.contact_due_at,s.accepted_at`).all();return reply({signups:rows.results});
}
export async function publicSignup(request:Request,env:PlatformEnv){
 if(env.PLATFORM_SIGNUP!=='enabled'||env.PLATFORM_CUSTOMER_LOGIN!=='enabled')throw new HttpError(503,'Tilmelding åbner snart.');
 if(request.method!=='POST')throw new HttpError(405,'Brug tilmeldingsformularen.');
 const b=await jsonBody(request,3000),field=(key:string,max:number)=>{const v=typeof b[key]==='string'?(b[key] as string).trim():'';if(!v||v.length>max||/[<>\x00-\x1f]/.test(v))throw new HttpError(400,'Udfyld alle felter korrekt.');return v;};
 const name=field('name',120),company=field('company',120),email=field('email',254).toLowerCase(),cvr=field('cvr',8);
 if(name.length<2||!/^\d{8}$/.test(cvr)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||b.accept!==true||b.website)throw new HttpError(400,'Kontrollér navn, CVR, mailadresse og accept af vilkår.');
 const ip=request.headers.get('cf-connecting-ip')||(env.PLATFORM_ENV==='local-test'?'local':null);if(!ip)throw new HttpError(403,'Brug portalens sikre adresse.');
 await loginLimit(env,'signup:ip:'+ip,5,3600);await loginLimit(env,'signup:mail:'+email,3,86400);await loginLimit(env,'signup:global',30,3600);
 const local=env.PLATFORM_ENV==='local-test';
 if(!local&&(!env.PLATFORM_INVITATIONS||env.PLATFORM_INVITATION_FROM!=='no-reply@webshoptoolbox.dk'||(env.PLATFORM_ENV==='remote-test'&&!(env.PLATFORM_INVITATION_RECIPIENTS||'').split(',').includes(email))))throw new HttpError(503,'Tilmeldingsmail er ikke aktiveret for denne adresse.');
 const db=env.PLATFORM_DB,template=await welcomeTemplate(env),now=Math.floor(Date.now()/1000);
 await db.prepare('DELETE FROM customer_login_limits WHERE expires_at<?').bind(now).run();
 const response=()=>reply({message:'Hvis oplysningerne kan bruges til en ny tilmelding, sender vi en velkomstmail med et link. Har du allerede adgang, skal du bruge Log ind. Modtager du ikke mailen, så kontakt info@webshoptoolbox.dk.'},202);
 if(await db.prepare('SELECT id FROM users WHERE lower(email)=? UNION ALL SELECT company_id id FROM public_signups WHERE cvr=?').bind(email,cvr).first())return response();
 const companyId=crypto.randomUUID(),userId=crypto.randomUUID(),invitation=crypto.randomUUID(),token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
 try{await db.batch([
  db.prepare('INSERT INTO companies(id,name) VALUES(?,?)').bind(companyId,company),
  db.prepare("INSERT INTO users(id,email,identity_issuer,identity_subject,company_id,status,full_name) VALUES(?,?,'urn:webshop-toolbox:pending',?,?,'inactive',?)").bind(userId,email,userId,companyId,name),
  db.prepare("INSERT INTO company_memberships(company_id,user_id,role) VALUES(?,?,'admin')").bind(companyId,userId),
  db.prepare('INSERT INTO invitations(id,user_id,token_hash,expires_at,created_by) VALUES(?,?,?,?,?)').bind(invitation,userId,await loginHash(token),now+172800,userId),
  db.prepare('INSERT INTO public_signups(company_id,user_id,cvr,terms_version,accepted_at,template_version) VALUES(?,?,?,?,?,?)').bind(companyId,userId,cvr,signupTerms,now,template.version),
  db.prepare("INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,'signup.created',?,'{}')").bind(crypto.randomUUID(),companyId,userId,companyId)
 ]);}catch(e){if(e instanceof Error&&/UNIQUE constraint failed/.test(e.message))return response();throw e;}
 const origin=local?new URL(request.url).origin:env.PLATFORM_ENV==='production'?'https://portal.webshoptoolbox.dk':'https://dev.webshoptoolbox.dk';
 const link=origin+'/onboarding?invitation='+token;
 if(local){await db.prepare("UPDATE invitations SET delivery='preview' WHERE id=?").bind(invitation).run();return reply({previewLink:link},202);}
 // Claim before the external write; duplicate submissions never resend an uncertain mail.
 await db.prepare("UPDATE invitations SET delivery='uncertain' WHERE id=?").bind(invitation).run();
 try{const result=await env.PLATFORM_INVITATIONS!.send({from:env.PLATFORM_INVITATION_FROM!,to:email,...renderWelcome(template,{name,company,link})});
 if(result&&typeof result==='object'&&'messageId' in result&&result.messageId)await db.prepare("UPDATE invitations SET delivery='sent' WHERE id=?").bind(invitation).run();
 }catch{/* The administrator can issue a new invitation after checking delivery. */}
 return response();
}
