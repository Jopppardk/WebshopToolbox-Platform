import { requireCompany } from './auth';
import { seal, unseal } from './connections';
import { jsonBody } from './invitations';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

type MailRow = {company_id:string;sender_name:string;reply_to:string;custom_from:string;account_id:string;credentials_encrypted:string|null;revision:string;verified_revision:string|null};
export function mailAddress(value:unknown, optional=false) {
 const s=typeof value==='string'?value.trim().toLowerCase():'';
 if(optional && !s)return '';
 if(s.length>254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s))throw new HttpError(400,'Angiv en gyldig mailadresse.');
 return s;
}
function senderName(value:unknown){
 if(typeof value!=='string'||!value.trim()||value.length>120||/[\x00-\x1f<>]/.test(value))throw new HttpError(400,'Angiv et gyldigt afsendernavn.');
 return value.trim();
}
async function row(env:PlatformEnv,company:string){return env.PLATFORM_DB.prepare('SELECT * FROM company_mail WHERE company_id=?').bind(company).first<MailRow>();}
function standardFrom(env:PlatformEnv){return mailAddress(env.PLATFORM_MAIL_FROM || 'faktura@webshoptoolbox.dk');}
export function effectiveSender(settings:MailRow|null,standard:string){
 return settings?.custom_from && settings.credentials_encrypted && settings.verified_revision===settings.revision?settings.custom_from:standard;
}
async function defaultSenderName(env:PlatformEnv,company:string){
 const value=await env.PLATFORM_DB.prepare(`SELECT COALESCE(NULLIF(i.name,''),c.name) AS name FROM companies c LEFT JOIN invoice_settings i ON i.company_id=c.id WHERE c.id=?`).bind(company).first<{name:string}>();
 return value!.name;
}
async function info(env:PlatformEnv,company:string,actor:Actor){
 const settings=await row(env,company);
 const fallbackName=await defaultSenderName(env,company);
 const from=standardFrom(env);
 const allowed=(env.PLATFORM_MAIL_TEST_RECIPIENTS||'').split(',').includes(actor.email.toLowerCase());
 return {senderName:settings?.sender_name||fallbackName,replyTo:settings?.reply_to||'',customFrom:settings?.custom_from||'',accountId:settings?.account_id||'',credentialsSaved:!!settings?.credentials_encrypted,
  status:!settings?.custom_from?'standard':settings.verified_revision===settings.revision?'verified':'pending',standardFrom:from,effectiveFrom:effectiveSender(settings,from),
  testRecipient:actor.email,testEnabled:!actor.support&&(env.PLATFORM_ENV==='local-test'||allowed),localPreview:env.PLATFORM_ENV==='local-test'};
}
function audit(env:PlatformEnv,company:string,actor:Actor,action:string,details:Record<string,unknown>){
 return env.PLATFORM_DB.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),company,actor.id,action,company,JSON.stringify(details));
}
export async function handleMail(request:Request,env:PlatformEnv,actor:Actor,company:string,action?:string,invoice?:{subject:string;text:string;allowAnyRecipient?:boolean;attachment:{content:ArrayBuffer;filename:string;type:string;disposition:"attachment"}}){
 await requireCompany(env.PLATFORM_DB,actor,company,request.method!=='GET');
 if(request.method==='GET'&&!action)return reply(await info(env,company,actor));
 if(actor.support)throw new HttpError(403,'Afslut impersonering før mailopsætning eller testmail.');
 const input=await jsonBody(request);
 if(request.method==='PUT'&&!action){
  const current=await row(env,company),name=senderName(input.senderName),replyTo=mailAddress(input.replyTo,true),custom=mailAddress(input.customFrom,true);
  const account=custom&&typeof input.accountId==='string'?input.accountId.trim():'';
  if(custom&&!/^[a-f0-9]{32}$/.test(account))throw new HttpError(400,'Angiv Cloudflare Account ID (32 tegn).');
  const token=typeof input.apiToken==='string'?input.apiToken.trim():'';
  let credentials:string|null=null;
  if(custom){
   if(token){
    if(!/^[A-Za-z0-9_-]{20,256}$/.test(token))throw new HttpError(400,'Angiv et gyldigt Cloudflare API-token.');
    credentials=await seal(env,[company,'mail',custom,account],{token});
   }else if(current?.custom_from===custom&&current.account_id===account)credentials=current.credentials_encrypted;
   if(!credentials)throw new HttpError(400,'Indtast et API-token til kundens Cloudflare Email Sending.');
  }
  const revision=crypto.randomUUID();
  const verified=custom&&current?.custom_from===custom&&current.account_id===account&&!token&&current.verified_revision===current.revision?revision:null;
  await env.PLATFORM_DB.batch([
   env.PLATFORM_DB.prepare(`INSERT INTO company_mail(company_id,sender_name,reply_to,custom_from,account_id,credentials_encrypted,revision,verified_revision) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(company_id) DO UPDATE SET sender_name=excluded.sender_name,reply_to=excluded.reply_to,custom_from=excluded.custom_from,account_id=excluded.account_id,credentials_encrypted=excluded.credentials_encrypted,revision=excluded.revision,verified_revision=excluded.verified_revision,updated_at=CURRENT_TIMESTAMP`).bind(company,name,replyTo,custom,account,credentials,revision,verified),
   audit(env,company,actor,'mail.settings.saved',{mode:custom?'custom':'standard'})
  ]);
  return reply(await info(env,company,actor));
 }
 if(request.method!=='POST'||action!=='test')throw new HttpError(404,'Mailfunktionen findes ikke.');
 // Sender checks stay self-only. The invoice demo may use an explicit, validated recipient,
 // but its subject, text and attachment are still generated exclusively on the server.
 const allowAnyRecipient=invoice?.allowAnyRecipient===true;
 if((!allowAnyRecipient&&input.recipient!==undefined)||input.to!==undefined||input.subject!==undefined||input.text!==undefined)throw new HttpError(400,'Testmailens indhold eller modtager kan ikke ændres her.');
 const id=typeof input.requestId==='string'?input.requestId:'';
 if(!/^[a-f0-9-]{36}$/.test(id))throw new HttpError(400,'Testmail mangler et gyldigt forespørgsels-ID.');
 if(!['standard','custom'].includes(String(input.mode)))throw new HttpError(400,'Vælg afsender til testmail.');
 const recipient=mailAddress(allowAnyRecipient?input.recipient:actor.email),local=env.PLATFORM_ENV==='local-test';
 const selfAllowed=(env.PLATFORM_MAIL_TEST_RECIPIENTS||'').split(',').includes(recipient);
 if(!local && (!env.PLATFORM_MAIL_TEST||(!allowAnyRecipient&&!selfAllowed)))throw new HttpError(403,'Denne adresse er ikke godkendt til afsendertest.');
 const previous=await env.PLATFORM_DB.prepare('SELECT actor_id,status,recipient,sender FROM mail_test_deliveries WHERE company_id=? AND request_id=?').bind(company,id).first<{actor_id:string;status:string;recipient:string;sender:string}>();
 if(previous){if(previous.actor_id!==actor.id)throw new HttpError(409,'Testmailen tilhører en anden session.');return reply(previous);}
 const settings=await row(env,company),custom=input.mode==='custom';
 if(custom&&(!settings?.custom_from||!settings.credentials_encrypted))throw new HttpError(400,'Gem din egen afsender og Cloudflare-oplysninger først.');
 const from=custom?settings!.custom_from:standardFrom(env);
 const name=settings?.sender_name||await defaultSenderName(env,company);
 const message={from:{email:from,name},to:recipient,...(settings?.reply_to?{replyTo:settings.reply_to}:{}),subject:'Testmail fra '+name+' · WebshopToolbox',text:`Dette er en test af din mailopsætning i WebshopToolbox.\n\nAfsender: ${name} <${from}>\nSvaradresse: ${settings?.reply_to||from}\n\nDer er ingen faktura vedhæftet, og der er ikke foretaget bogføring.`};
 if(invoice){message.subject=invoice.subject;message.text=invoice.text;}
 let secret:{token:string}|undefined;
 if(custom&&!local)secret=await unseal(env,[company,'mail',from,settings!.account_id],settings!.credentials_encrypted!);
 const now=Math.floor(Date.now()/1000);
 // Atomic claim and company-wide cooldown serialize concurrent tabs and hold uncertain sends.
 const claim=await env.PLATFORM_DB.prepare(`INSERT INTO mail_test_deliveries(company_id,request_id,actor_id,recipient,sender,mode,status,created_at)
  SELECT ?,?,?,?,?,?,'uncertain',? WHERE NOT EXISTS(SELECT 1 FROM mail_test_deliveries WHERE company_id=? AND created_at>?) ON CONFLICT DO NOTHING`).bind(company,id,actor.id,recipient,from,input.mode,now,company,now-60).run();
 if(claim.meta.changes!==1)throw new HttpError(429,'Vent mindst ét minut mellem testmails. Et uafklaret forsøg genafsendes ikke automatisk.');
 if(local){
  await env.PLATFORM_DB.prepare("UPDATE mail_test_deliveries SET status='preview' WHERE company_id=? AND request_id=?").bind(company,id).run();
  return reply({status:'preview',recipient,sender:from,preview:message});
 }
 try{
  let receipt:string;
  if(custom){
   // Customer-supplied account credentials authorize only this fixed Cloudflare endpoint; never follow redirects.
   const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${settings!.account_id}/email/sending/send`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+secret!.token,'Content-Type':'application/json'},body:JSON.stringify({... (invoice?{attachments:[{...invoice.attachment,content:btoa(Array.from(new Uint8Array(invoice.attachment.content),b=>String.fromCharCode(b)).join(''))}]}:{}),from:{address:from,name},to:recipient,subject:message.subject,text:message.text,...(settings?.reply_to?{reply_to:settings.reply_to}:{})})});
   const result=await response.json() as {success?:boolean;result?:{delivered?:string[];queued?:string[];permanent_bounces?:string[]}};
   if(!response.ok||result.success!==true||!result.result||result.result.permanent_bounces?.includes(recipient)||!(result.result.delivered?.includes(recipient)||result.result.queued?.includes(recipient)))throw Error('Unconfirmed delivery');
   receipt=JSON.stringify(result.result);
  }else{
   const result=await env.PLATFORM_MAIL_TEST!.send({...message,...(invoice?{attachments:[invoice.attachment]}:{})});
   if(!result?.messageId)throw Error('Missing receipt');
   receipt=result.messageId;
  }
  await env.PLATFORM_DB.batch([
   env.PLATFORM_DB.prepare("UPDATE mail_test_deliveries SET status='accepted',receipt=? WHERE company_id=? AND request_id=?").bind(receipt,company,id),
   ...(custom?[env.PLATFORM_DB.prepare('UPDATE company_mail SET verified_revision=revision WHERE company_id=? AND revision=?').bind(company,settings!.revision)]:[]),
   audit(env,company,actor,'mail.test.accepted',{requestId:id,mode:input.mode,recipient})
  ]);
  return reply({status:'accepted',recipient,sender:from});
 }catch{
  // Any send may have been accepted. Keep the durable claim and invalidate custom selection until an explicit new test succeeds.
  if(custom)await env.PLATFORM_DB.prepare('UPDATE company_mail SET verified_revision=NULL WHERE company_id=? AND revision=?').bind(company,settings!.revision).run();
  return reply({status:'uncertain',recipient,sender:from});
 }
}
