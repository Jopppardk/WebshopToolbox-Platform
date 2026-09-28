import {runProductionJobs} from './production-jobs';
import {productionWrites} from './production-policy';
import { customerActor, customerLogin, customerLogout } from './customer-auth';
import { publicFeed } from './feeds';
import { handleTier1 } from './tier1-api';
import { InvoiceCheckError } from '../lib/invoice-check';
import { handleSupport, supportActor, supportToken } from './support';
import { identity } from './auth';
import { onboarding, saveProfile } from './invitations';
import { authenticate } from './auth';
import { handleAdmin } from './admin';
import { assertTestRuntime, scheduled } from './safety';
import { HttpError, reply, type PlatformEnv } from './types';

async function asset(request:Request,env:PlatformEnv,admin=false){
 const response=await env.ASSETS.fetch(request);
 if(!response.headers.get('content-type')?.includes('text/html'))return response;
 let body=await response.text();
 if(env.PLATFORM_ENV==='production')body=body.replaceAll('Testmiljø','Produktionsportal');
 if(admin)body=body.replaceAll('src="/admin.js"','src="/admin/admin.js"').replaceAll('src="/onboarding.js"','src="/admin/onboarding.js"').replaceAll('action="/logout"','action="/admin/logout"').replaceAll('href="/"','href="/admin/"');
 const headers=new Headers(response.headers);for(const key of ['Content-Length','Content-Encoding','ETag'])headers.delete(key);
 return new Response(body,{status:response.status,headers});
}
const globalAsset=asset;
function secure(response: Response, tier1 = false) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set(
    'Content-Security-Policy',
    tier1
      ? "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      : "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async fetch(request: Request, env: PlatformEnv) {
    try {
      assertTestRuntime(env);
      const url=new URL(request.url),customerEnabled=env.PLATFORM_CUSTOMER_LOGIN==='enabled';
      if(customerEnabled&&env.PLATFORM_ENV==='local-test'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new HttpError(503,'Lokal loginadgang er kun tilgængelig lokalt.');
      if(env.PLATFORM_ADMIN_HOST){
        const adminHost=url.hostname===env.PLATFORM_ADMIN_HOST,isAdminPath=url.pathname==='/admin'||url.pathname.startsWith('/admin/');
        if(adminHost&&url.pathname==='/')return secure(new Response(null,{status:303,headers:{Location:'/admin/'}}));
        if(adminHost&&!isAdminPath&&!['/robots.txt','/styles.css','/favicon.png','/brand/webshoptoolbox-logo.png'].includes(url.pathname))throw new HttpError(404,'Siden findes ikke.');
        if(!adminHost&&isAdminPath){
          if(!['GET','HEAD'].includes(request.method))throw new HttpError(403,'Åbn administrationsportalen på dens egen adresse.');
          const target=new URL(request.url);target.protocol='https:';target.hostname=env.PLATFORM_ADMIN_HOST;target.port='';
          return secure(new Response(null,{status:303,headers:{Location:target.href}}));
        }
      }
      const admin=customerEnabled&&(url.pathname==='/admin'||url.pathname.startsWith('/admin/'));
      if(admin){url.pathname=url.pathname.slice(6)||'/';request=new Request(url,request);}
      const path=url.pathname;
      if(!admin&&path.startsWith('/feeds/'))return secure(await publicFeed(request,env));
      if(path==='/robots.txt'&&['GET','HEAD'].includes(request.method))return secure(new Response(request.method==='HEAD'?null:'User-agent: *\nDisallow:\n# Indexing is disabled by X-Robots-Tag on every response.\n',{headers:{'Content-Type':'text/plain; charset=utf-8'}}));
      if(customerEnabled&&!admin){
        if(['/auth/start','/auth/verify'].includes(path))return secure(await customerLogin(request,env,path.slice(6)));
        if(path==='/logout')return secure(await customerLogout(request,env));
        if(path==='/onboarding'&&request.method==='GET'){
          const invitation=url.searchParams.get('invitation')||'';
          return secure(new Response(null,{status:303,headers:{Location:'/login'+(/^[a-f0-9]{64}$/.test(invitation)?'?invitation='+invitation:'')}}));
        }
        if(['/login','/login.js','/login.css','/styles.css'].includes(path)&&request.method==='GET'){
          return secure(await asset(path==='/login'?new Request(new URL('/login.html',url)):request,env));
        }
        if(path==='/api/platform/onboarding'||path==='/onboarding.js')throw new HttpError(404,'Åbn linket i din invitation.');
      }
      if(['GET','HEAD'].includes(request.method) && ['/favicon.png','/brand/webshoptoolbox-logo.png'].includes(path))
        return secure(await asset(request,env));
      if (path === '/logout' && request.method === 'POST') {
        if(request.headers.get('origin') !== new URL(request.url).origin)
          throw new HttpError(403,'Start fra portalen.');
        const local=env.PLATFORM_ENV==='local-test';
        const headers=new Headers({Location:local?'/local-login':'/cdn-cgi/access/logout'});
        headers.append('Set-Cookie','platform_local=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        headers.append('Set-Cookie','platform_support=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(local?'':'; Secure'));
        return secure(new Response(null,{status:303,headers}));
      }
      if (path === '/healthz' && request.method === 'GET')
        return secure(
          reply({
            status: 'ok',
            environment: env.PLATFORM_ENV,
            bookkeeping: env.PLATFORM_EXTERNAL_WRITES,
            customerEmail: env.PLATFORM_CUSTOMER_EMAIL,
          }),
        );
      if (
        path === '/local-login' &&
        env.PLATFORM_ENV === 'local-test' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(
          new URL(request.url).hostname,
        )
      ) {
        if (request.method === 'GET')
          return secure(
            new Response(
              `<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Lokal testadgang</title><body><h1>Lokal testadgang</h1><p>Indsæt en lokal testsession fra scripts/platform.mjs local-session.</p><form method="post"><label>Testsession <input type="password" name="token" required autocomplete="off" maxlength="2048"></label><button>Åbn administration</button></form></body></html>`,
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            ),
          );
        if (request.method === 'POST') {
          if (request.headers.get('origin') !== new URL(request.url).origin)
            throw new HttpError(403, 'Start fra den lokale loginside.');
          const raw = await request.text();
          if (raw.length > 4096)
            throw new HttpError(413, 'Testsessionen er for stor.');
          const token = new URLSearchParams(raw).get('token') || '';
          if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))
            throw new HttpError(401, 'Ugyldig testsession.');
          await identity(
            new Request(request.url, {
              headers: { authorization: `Bearer ${token}` },
            }),
            env,
          );
          return secure(
            new Response(null, {
              status: 303,
              headers: {
                Location: customerEnabled?'/admin/':'/',
                'Set-Cookie': `platform_local=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
              },
            }),
          );
        }
      }
      if (path === '/api/platform/onboarding' && ['GET','POST'].includes(request.method))
        {
        if(supportToken(request)) throw new HttpError(403,'Afslut supportadgang før onboarding.');
        return secure(await onboarding(request,env));
      }
      if (['/onboarding','/onboarding.js','/styles.css'].includes(path) && request.method==='GET') {
        await identity(request,env);
        const asset = path==='/onboarding' ? new Request(new URL('/onboarding.html',request.url)) : request;
        return secure(await globalAsset(asset,env,admin));
      }
      let realActor;
      try{realActor=customerEnabled&&!admin?await customerActor(request,env):await authenticate(request,env);}
      catch(error){if(customerEnabled&&!admin&&['/','/index.html'].includes(path)&&request.method==='GET'&&error instanceof HttpError&&error.status===401)return secure(new Response(null,{status:303,headers:{Location:'/login'}}));throw error;}
      if(admin&&!realActor.platformAdmin)throw new HttpError(403,'Kræver Toolbox-administrator.');
      if(path==='/api/platform/support'&&customerEnabled&&!admin){if(request.method==='GET')return secure(reply({active:false}));throw new HttpError(403,'Kræver Toolbox-administrator.');}
      if(path==='/api/platform/support' && (!customerEnabled||admin)) return secure(await handleSupport(request,env,realActor));
      const actor = path.startsWith('/api/platform/') && (!customerEnabled||admin) ? await supportActor(request,env,realActor) : realActor;
      const context=request.headers.get('x-platform-actor');
      const expected=actor.id+':'+(actor.support?.sessionId||'');
      if(path.startsWith('/api/platform/') && ((context && context!==expected) || (actor.support && !['GET','HEAD'].includes(request.method) && context!==expected)))
        throw new HttpError(409,'Din session er ændret. Genindlæs siden før du fortsætter.');
      if(actor.support && path==='/api/platform/profile') throw new HttpError(403,'Profilen kan kun ændres af brugeren selv.');
      if(path==='/api/platform/profile' && request.method==='POST') return secure(await saveProfile(request,env,actor));
      if(path.startsWith('/api/platform/') && path!=='/api/platform/me' && !actor.fullName)
        throw new HttpError(428,'Udfyld din profil for at fortsætte.');
      if(path.startsWith('/api/platform/tier1/')) return secure(await handleTier1(request,env,actor));
      if(customerEnabled&&!admin&&request.method==='GET'&&['/','/index.html'].includes(path)) {
        if(actor.platformAdmin||actor.support)throw new HttpError(403,'Åbn Tier 1 med en virksomhedsbruger.');
        return secure(await asset(new Request(new URL('/tier1-next/index.html',url)),env),true);
      }
      if(!admin&&request.method==='GET'&&(path==='/tier1-next/'||path==='/tier1-next/assets/geist-OFL.txt'||/^\/tier1-next\/assets\/[\w.-]+\.(js|css|woff2)$/.test(path))) {
        if(actor.platformAdmin||actor.support)throw new HttpError(403,'Åbn Tier 1 med en virksomhedsbruger.');
        return secure(await asset(path==='/tier1-next/'?new Request(new URL('/tier1-next/index.html',url)):request,env),true);
      }
      if (path.startsWith('/api/platform/'))
        return secure(await handleAdmin(request, env.PLATFORM_DB, actor, env));
      if (
        request.method === 'GET' &&
        ['/', '/index.html', '/admin.js', '/customer.js', '/styles.css'].includes(path)
      )
        return secure(await asset(request,env,admin));
      throw new HttpError(
        404,
        'Funktionen findes ikke i administrationens testmiljø.',
      );
    } catch (error) {
      if(error instanceof InvoiceCheckError)return secure(reply({error:error.message},409));
      if (error instanceof HttpError)
        return secure(reply({ error: error.message }, error.status));
      if(error instanceof Error && /LAST_COMPANY_ADMIN/.test(error.message))
        return secure(reply({error:'Virksomheden skal have mindst én aktiv administrator.'},409));
      // Never expose SQL, tokens, provider errors or user payloads.
      if (
        error instanceof Error &&
        /UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(
          error.message,
        )
      )
        return secure(
          reply(
            { error: 'Data findes allerede, eller relationen er ugyldig.' },
            409,
          ),
        );
      return secure(
        reply({ error: 'Handlingen kunne ikke gennemføres.' }, 500),
      );
    }
  },
  async scheduled(_event: ScheduledController, env: PlatformEnv) {
    assertTestRuntime(env);
    return productionWrites(env)?runProductionJobs(env):scheduled();
  },
};
