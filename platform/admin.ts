import { handleTier1Data } from './tier1-data';
import { financeService } from './finance-source';
import { signupSettings,signupOverview } from './signup';
import { jsonBody } from './invitations';
import { handleStocktake } from './stocktake';
import { handlePayments } from './payments';
import { handleDocuments } from './documents';
import { handlePackaging } from './packaging';
import { handleAccounting } from './accounting';
import { handleOperations, dashboardData } from './operations';
import { handleTickets } from './tickets';
import { handleInvoices } from './invoices';
import { handleMail } from './mail';
import { connectionStatement, website } from './connections';
import { invite, renewInvitation } from './invitations';
import { catalog, apiStatus } from './catalog';
import { requireCompany, requireWebshop } from './auth';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

type Body = Record<string, unknown>;
function text(body: Body, key: string, max = 120): string {
  const value = body[key];
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f]/.test(value)
  )
    throw new HttpError(400, `Ugyldigt felt: ${key}.`);
  return value.trim();
}
function status(body: Body) {
  if (body.status !== 'active' && body.status !== 'inactive')
    throw new HttpError(400, 'Ugyldig status.');
  return body.status;
}
function domain(body: Body) {
  const value = text(body, 'domain', 253).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value))
    throw new HttpError(400, 'Angiv et domæne uden https eller sti.');
  return value;
}
function customerShopManager(actor: Actor) {
  if(actor.platformAdmin || actor.support) throw new HttpError(403,'Webshops oprettes og opsættes af virksomhedens administrator i Tier 1. Tier 0 har kun visningsadgang.');
}
function admin(actor: Actor) {
  if (!actor.platformAdmin)
    throw new HttpError(403, 'Kræver platformadministrator.');
}
async function body(request: Request): Promise<Body> {
  if (
    request.headers.get('origin') !== new URL(request.url).origin ||
    !request.headers.get('content-type')?.startsWith('application/json')
  )
    throw new HttpError(403, 'Start handlingen fra administrationen.');
  const raw = await request.text();
  if (raw.length > 8192) throw new HttpError(413, 'Forespørgslen er for stor.');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw Error();
    return parsed;
  } catch {
    throw new HttpError(400, 'Ugyldig JSON.');
  }
}
function audit(
  db: D1Database,
  actor: Actor,
  company: string | null,
  action: string,
  resource: string,
  details: Body,
) {
  return db
    .prepare(
      'INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      company,
      actor.support?.adminId || actor.id,
      action,
      resource,
      JSON.stringify({...details,...(actor.support?{supportSession:actor.support.sessionId,impersonatedUser:actor.id}:{})}),
    );
}

export async function handleAdmin(
  request: Request,
  db: D1Database,
  actor: Actor,
  env: PlatformEnv,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if(path==='/api/platform/settings/welcome')return signupSettings(request,env,actor);
  if(path==='/api/platform/settings/signups')return signupOverview(request,env,actor);
  const insights=path.match(/^\/api\/platform\/companies\/([\w-]+)\/webshops\/([\w-]+)\/insights$/);
  if(insights){admin(actor);await requireWebshop(db,actor,insights[1],insights[2]);if(method!=='GET')throw new HttpError(405,'Brug Hent.');return (await handleTier1Data(request,env,actor,insights[1],insights[2],'/admin/insights'))!;}
  const finance=path.match(/^\/api\/platform\/companies\/([\w-]+)\/finance$/);
  if(finance){await requireCompany(db,actor,finance[1],true);const service=financeService(env,finance[1]);if(method==='GET')return reply(await service.dashboardFinance());if(method==='POST'&&!actor.support){await jsonBody(request);try{return reply(await service.syncDashboardFinance());}catch{throw new HttpError(409,'Regnskabstal kunne ikke hentes komplet. Se status på dashboardet.');}}throw new HttpError(403,'Regnskabstal kan kun opdateres af virksomhedsadministratoren.');}
  const stocktake=path.match(/^\/api\/platform\/companies\/([\w-]+)\/webshops\/([\w-]+)\/stocktake$/);
  if(stocktake)return handleStocktake(request,env,actor,stocktake[1],stocktake[2]);
  const payment=path.match(/^\/api\/platform\/companies\/([\w-]+)\/webshops\/([\w-]+)\/payments\/(flatpay|viabill)\/(connection|records)$/);
  if(payment)return handlePayments(request,env,actor,payment[1],payment[2],payment[3],payment[4]);
  const dashboard=path.match(/^\/api\/platform\/companies\/([\w-]+)\/dashboard$/);
  if(dashboard&&method==='GET')return dashboardData(env,actor,dashboard[1]);
  const documents=path.match(/^\/api\/platform\/companies\/([\w-]+)\/webshops\/([\w-]+)\/documents$/);
  if(documents)return handleDocuments(request,env,actor,documents[1],documents[2]);
  const packaging=path.match(/^\/api\/platform\/companies\/([\w-]+)\/webshops\/([\w-]+)\/packaging$/);
  if(packaging)return handlePackaging(request,env,actor,packaging[1],packaging[2]);
  const accountingAction=path.match(/^\/api\/platform\/companies\/([\w-]+)\/accounting\/(connection|mapping)$/);
  if(accountingAction)return handleAccounting(request,env,actor,accountingAction[1],accountingAction[2]);
  const operation=path.match(/^\/api\/platform\/companies\/([\w-]+)\/webshops\/([\w-]+)\/data\/(orders|refunds|payouts|inventory|insights|sales-preview|connection-test)$/);
  if(operation)return handleOperations(request,env,actor,operation[1],operation[2],operation[3]);
  const tickets=path.match(/^\/api\/platform(?:\/companies\/([\w-]+))?\/tickets(?:\/([\w-]+))?$/);
  if(tickets)return handleTickets(request,env,actor,tickets[1],tickets[2]);
  const invoiceMatch=path.match(/^\/api\/platform\/companies\/([\w-]+)\/invoices(?:\/(settings|logo|sync|generate|check|pdf|test|test-latest))?$/);
  if(invoiceMatch)return handleInvoices(request,env,actor,invoiceMatch[1],invoiceMatch[2]);
  const mailMatch=path.match(/^\/api\/platform\/companies\/([\w-]+)\/mail(?:\/(test))?$/);
  if(mailMatch)return handleMail(request,env,actor,mailMatch[1],mailMatch[2]);
  if (path === '/api/platform/me' && method === 'GET')
    return reply({ user: actor });
  if (path === '/api/platform/catalog' && method === 'GET') {
    if(!actor.platformAdmin) {
      const own=await db.prepare('SELECT company_id FROM users WHERE id=?').bind(actor.id).first<{company_id:string}>();
      if(!own?.company_id) throw new HttpError(403,'Ingen virksomhed.');
      await requireCompany(db,actor,own.company_id);
    }
    return reply({integrations:catalog});
  }
  if(path==='/api/platform/catalog/status' && method==='GET') {
    admin(actor);
    return reply({integrations:await apiStatus()});
  }
  const selectionMatch=path.match(/^\/api\/platform\/companies\/([\w-]+)\/integrations$/);
  if(selectionMatch) {
    const company=selectionMatch[1];
    await requireCompany(db,actor,company,method!=='GET');
    if(method==='GET') return reply({selected:(await db.prepare('SELECT integration_id FROM company_integrations WHERE company_id=? ORDER BY integration_id').bind(company).all()).results});
    if(method==='POST' || method==='DELETE') {
      const input=await body(request),id=text(input,'integrationId');
      if(!['flatpay','viabill','emballage'].includes(id)) throw new HttpError(400,'Regnskab og webshops administreres særskilt.');
      await db.batch([
        db.prepare(method==='POST'?'INSERT OR IGNORE INTO company_integrations(company_id,integration_id) VALUES(?,?)':'DELETE FROM company_integrations WHERE company_id=? AND integration_id=?').bind(company,id),
        audit(db,actor,company,method==='POST'?'integration.selected':'integration.removed',company,{integrationId:id}),
      ]);
      return reply({ok:true});
    }
  }
  if (path === '/api/platform/workspace' && method === 'GET') {
    const company = await db.prepare(`SELECT c.*,m.role FROM users u
      JOIN companies c ON c.id=u.company_id
      JOIN company_memberships m ON m.company_id=c.id AND m.user_id=u.id
      WHERE u.id=? AND c.status='active'`).bind(actor.id).first();
    if (!company) throw new HttpError(403, 'Din bruger har ikke adgang til en aktiv virksomhed.');
    return reply({company});
  }
  const connectionMatch=path.match(/^\/api\/platform\/companies\/([\w-]+)\/webshops\/([\w-]+)\/connection$/);
  if(connectionMatch && method==='PUT') {
    customerShopManager(actor);
    const [,company,shop]=connectionMatch;
    await requireCompany(db,actor,company,true);
    await requireWebshop(db,actor,company,shop);
    if(actor.support) throw new HttpError(403,'Afslut supportadgang før ændring af adgangsoplysninger.');
    const input=await body(request);
    const statement=await connectionStatement(env,company,shop,input);
    await db.batch([statement,audit(db,actor,company,'webshop.connection.saved',shop,{provider:'shopify'})]);
    return reply({ok:true});
  }
  const accountingMatch = path.match(/^\/api\/platform\/companies\/([\w-]+)\/accounting$/);
  if (accountingMatch) {
    const company = accountingMatch[1];
    await requireCompany(db, actor, company, method !== 'GET');
    if (method === 'GET') return reply({accounting: await db.prepare(
      'SELECT provider,account_name,status FROM company_accounting WHERE company_id=?'
    ).bind(company).first()});
    if (method === 'PUT') {
      const input = await body(request);
      const provider = text(input, 'provider'), name = text(input, 'accountName');
      if (!['dinero','e-conomic'].includes(provider)) throw new HttpError(400, 'Vælg et understøttet regnskabsprogram.');
      await db.batch([
        db.prepare(`INSERT INTO company_accounting(company_id,provider,account_name) VALUES(?,?,?)
          ON CONFLICT(company_id) DO UPDATE SET provider=excluded.provider,account_name=excluded.account_name,updated_at=CURRENT_TIMESTAMP`).bind(company,provider,name),
        audit(db,actor,company,'accounting.configured',company,{provider,accountName:name}),
      ]);
      return reply({ok:true});
    }
  }
  if (path === '/api/platform/companies') {
    if (method === 'GET') {
      const rows = actor.platformAdmin
        ? await db.prepare('SELECT * FROM companies ORDER BY name,id').all()
        : await db
            .prepare(
              `SELECT c.*,m.role FROM companies c JOIN company_memberships m ON c.id=m.company_id WHERE m.user_id=? AND c.status='active' ORDER BY c.name,c.id`,
            )
            .bind(actor.id)
            .all();
      return reply({ companies: rows.results });
    }
    if (method === 'POST') {
      admin(actor);
      const input = await body(request),
        id = crypto.randomUUID(),
        name = text(input, 'name');
      await db.batch([
        db.prepare('INSERT INTO companies(id,name) VALUES(?,?)').bind(id, name),
        audit(db, actor, id, 'company.created', id, { name }),
      ]);
      return reply({ id }, 201);
    }
  }
  if (path === '/api/platform/settings/admins') {
    admin(actor);
    if (method === 'GET')
      return reply({
        users: (
          await db
            .prepare(
              'SELECT u.id,u.email,u.status,u.full_name,i.state invitation_state,i.delivery,i.expires_at FROM users u JOIN platform_admins a ON a.user_id=u.id LEFT JOIN invitations i ON i.user_id=u.id ORDER BY u.email,u.id',
            )
            .all()
        ).results,
      });
    if(method==='POST') return invite(request,env,actor,null);
  }

  const userMatch = path.match(/^\/api\/platform\/settings\/admins\/([\w-]+)$/);
  if (userMatch && method === 'PATCH') {
    admin(actor);
    const input = await body(request),
      next = status(input),
      target = userMatch[1];
    if (target === actor.id)
      throw new HttpError(409, 'Du kan ikke deaktivere din egen bruger.');
    if (!(await db.prepare('SELECT user_id FROM platform_admins WHERE user_id=?').bind(target).first()))
      throw new HttpError(404, 'Portaladministratoren findes ikke.');
    if(await db.prepare("SELECT id FROM invitations WHERE user_id=? AND state<>'accepted'").bind(target).first()) throw new HttpError(409,'Brug invitationshandlingerne for denne bruger.');
    await db.batch([
      db.prepare('UPDATE users SET status=? WHERE id=?').bind(next, target),
      audit(db, actor, null, 'user.status', target, { status: next }),
    ]);
    return reply({ ok: true });
  }
  const invitationMatch=path.match(/^\/api\/platform\/(?:companies\/([\w-]+)\/users|settings\/admins)\/([\w-]+)\/invitation$/);
  if(invitationMatch && ['POST','DELETE'].includes(method)) return renewInvitation(request,env,actor,invitationMatch[1]||null,invitationMatch[2]);
  const companyUser = path.match(/^\/api\/platform\/companies\/([\w-]+)\/users(?:\/([\w-]+))?$/);
  if (companyUser) {
    const company = companyUser[1], target = companyUser[2];
    await requireCompany(db, actor, company, true);
    if (!target && method==='POST') return invite(request,env,actor,company);
    if (target && method === 'PATCH') {
      const input = await body(request), next = status(input);
      if (!(await db.prepare('SELECT id FROM users WHERE id=? AND company_id=?').bind(target,company).first()))
        throw new HttpError(404, 'Brugeren findes ikke i virksomheden.');
      if (target === actor.id) throw new HttpError(409, 'Du kan ikke deaktivere din egen bruger.');
      if(await db.prepare("SELECT id FROM invitations WHERE user_id=? AND state<>'accepted'").bind(target).first()) throw new HttpError(409,'Brug invitationshandlingerne for denne bruger.');
      await db.batch([
        db.prepare('UPDATE users SET status=? WHERE id=? AND company_id=?').bind(next,target,company),
        audit(db,actor,company,'user.status',target,{status:next}),
      ]);
      return reply({ok:true});
    }
  }
  const companyMatch = path.match(
    /^\/api\/platform\/companies\/([\w-]+)(?:\/(webshops|members|audit))?$/,
  );
  if (companyMatch) {
    const company = companyMatch[1],
      section = companyMatch[2];
    if (!section && method === 'PATCH') {
      admin(actor);
      await requireCompany(db, actor, company);
      const input = await body(request),
        name = text(input, 'name'),
        next = status(input);
      await db.batch([
        db
          .prepare('UPDATE companies SET name=?,status=? WHERE id=?')
          .bind(name, next, company),
        audit(db, actor, company, 'company.updated', company, {
          name,
          status: next,
        }),
      ]);
      return reply({ ok: true });
    }
    if (section === 'webshops') {
      await requireCompany(db, actor, company, method !== 'GET');
      if (method === 'GET') {
        const rows = await db
          .prepare(`SELECT w.*,k.provider,k.shop_domain,k.verified_at,CASE WHEN k.webshop_id IS NULL THEN 0 ELSE 1 END AS credentials_saved FROM webshops w LEFT JOIN webshop_connections k ON k.company_id=w.company_id AND k.webshop_id=w.id WHERE w.company_id=? AND (?=1 OR
          EXISTS(SELECT 1 FROM company_memberships c WHERE c.company_id=w.company_id AND c.user_id=? AND c.role='admin') OR
          (w.status='active' AND EXISTS(SELECT 1 FROM webshop_memberships m WHERE m.company_id=w.company_id AND m.webshop_id=w.id AND m.user_id=?))) ORDER BY w.name,w.id`)
          .bind(company, actor.platformAdmin ? 1 : 0, actor.id, actor.id)
          .all();
        return reply({ webshops: rows.results });
      }
      if (method === 'POST') {
        customerShopManager(actor);
        const input = await body(request),
          id = crypto.randomUUID(),
          name = text(input, 'name'),
          host = website(input.domain);
        if(actor.support && input.provider) throw new HttpError(403,'Afslut supportadgang før ændring af adgangsoplysninger.');
        const connection=input.provider ? await connectionStatement(env,company,id,input) : null;
        if(!input.provider && ('clientSecret' in input || 'clientId' in input || 'shopDomain' in input)) throw new HttpError(400,'Vælg webshopplatform.');
        await db.batch([
          db
            .prepare(
              'INSERT INTO webshops(id,company_id,name,domain) VALUES(?,?,?,?)',
            )
            .bind(id, company, name, host),
          ...(connection ? [connection] : []),
          audit(db, actor, company, 'webshop.created', id, {
            name,
            domain: host,
          }),
        ]);
        return reply({ id }, 201);
      }
    }
    if (section === 'members') {
      await requireCompany(db, actor, company, true);
      if (method === 'GET') {
        const members = await db
          .prepare(
            'SELECT u.id,u.email,u.status,u.full_name,m.role,i.state invitation_state,i.delivery,i.expires_at FROM company_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN invitations i ON i.user_id=u.id WHERE m.company_id=? ORDER BY u.email',
          )
          .bind(company)
          .all();
        const grants = await db
          .prepare(
            'SELECT webshop_id,user_id,role FROM webshop_memberships WHERE company_id=?',
          )
          .bind(company)
          .all();
        return reply({ members: members.results, grants: grants.results });
      }
      if (method === 'POST' || method === 'DELETE') {
        // Company administrators manage roles only inside their own company.
        const input = await body(request),
          user = text(input, 'userId');
        if (
          !(await db
            .prepare("SELECT id FROM users WHERE id=? AND company_id=? AND status='active'")
            .bind(user, company)
            .first())
        )
          throw new HttpError(400, 'Vælg en aktiv bruger.');
        if (user === actor.id) throw new HttpError(409, 'Du kan ikke fjerne eller ændre din egen administratorrolle.');
        if (method === 'DELETE') {
          await db.batch([
            db
              .prepare(
                'DELETE FROM webshop_memberships WHERE company_id=? AND user_id=?',
              )
              .bind(company, user),
            db
              .prepare(
                'DELETE FROM company_memberships WHERE company_id=? AND user_id=?',
              )
              .bind(company, user),
            audit(db, actor, company, 'membership.removed', user, {}),
          ]);
        } else {
          if (!['admin', 'member'].includes(String(input.role)))
            throw new HttpError(400, 'Ugyldig virksomhedsrolle.');
          await db.batch([
            db
              .prepare(
                'INSERT INTO company_memberships(company_id,user_id,role) VALUES(?,?,?) ON CONFLICT(company_id,user_id) DO UPDATE SET role=excluded.role',
              )
              .bind(company, user, input.role),
            audit(db, actor, company, 'membership.saved', user, {
              role: input.role,
            }),
          ]);
        }
        return reply({ ok: true });
      }
    }
    if (section === 'audit' && method === 'GET') {
      await requireCompany(db, actor, company, true);
      return reply({
        events: (
          await db
            .prepare(
              'SELECT e.*,u.email AS actor_email FROM audit_events e JOIN users u ON u.id=e.actor_id WHERE e.company_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 100',
            )
            .bind(company)
            .all()
        ).results,
      });
    }
  }
  const shopMatch = path.match(
    /^\/api\/platform\/companies\/([\w-]+)\/webshops\/([\w-]+)(?:\/(grants|records))?$/,
  );
  if (shopMatch) {
    const company = shopMatch[1],
      shop = shopMatch[2],
      section = shopMatch[3];
    if (!section && method === 'PATCH') {
      customerShopManager(actor);
      await requireCompany(db, actor, company, true);
      if (
        !(await db
          .prepare('SELECT id FROM webshops WHERE company_id=? AND id=?')
          .bind(company, shop)
          .first())
      )
        throw new HttpError(404, 'Webshoppen findes ikke.');
      const input = await body(request),
        name = text(input, 'name'),
        host = domain(input),
        next = status(input);
      await db.batch([
        db
          .prepare(
            'UPDATE webshops SET name=?,domain=?,status=? WHERE company_id=? AND id=?',
          )
          .bind(name, host, next, company, shop),
        audit(db, actor, company, 'webshop.updated', shop, {
          name,
          domain: host,
          status: next,
        }),
      ]);
      return reply({ ok: true });
    }
    if (section === 'grants' && (method === 'POST' || method === 'DELETE')) {
      await requireCompany(db, actor, company, true);
      if (
        !(await db
          .prepare('SELECT id FROM webshops WHERE company_id=? AND id=?')
          .bind(company, shop)
          .first())
      )
        throw new HttpError(404, 'Webshoppen findes ikke.');
      const input = await body(request),
        user = text(input, 'userId');
      if (
        !(await db
          .prepare(
            `SELECT m.user_id FROM company_memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=? AND m.user_id=? AND u.status='active'`,
          )
          .bind(company, user)
          .first())
      )
        throw new HttpError(
          400,
          'Brugeren skal være aktivt medlem af virksomheden.',
        );
      if (
        method === 'POST' &&
        !['operator', 'reader'].includes(String(input.role))
      )
        throw new HttpError(400, 'Ugyldig webshoprolle.');
      const statement =
        method === 'DELETE'
          ? db
              .prepare(
                'DELETE FROM webshop_memberships WHERE company_id=? AND webshop_id=? AND user_id=?',
              )
              .bind(company, shop, user)
          : db
              .prepare(
                'INSERT INTO webshop_memberships(company_id,webshop_id,user_id,role) VALUES(?,?,?,?) ON CONFLICT(company_id,webshop_id,user_id) DO UPDATE SET role=excluded.role',
              )
              .bind(company, shop, user, input.role);
      await db.batch([
        statement,
        audit(
          db,
          actor,
          company,
          method === 'DELETE' ? 'grant.removed' : 'grant.saved',
          shop,
          { userId: user, ...(method === 'POST' ? { role: input.role } : {}) },
        ),
      ]);
      return reply({ ok: true });
    }
    if (section === 'records' && method === 'GET') {
      await requireWebshop(db, actor, company, shop);
      return reply({
        records: (
          await db
            .prepare(
              'SELECT id,provider,external_id,record_type FROM source_records WHERE company_id=? AND webshop_id=? ORDER BY id',
            )
            .bind(company, shop)
            .all()
        ).results,
      });
    }
  }
  throw new HttpError(404, 'Ruten findes ikke i administrationen.');
}
