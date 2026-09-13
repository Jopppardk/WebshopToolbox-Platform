import { requireCompany, requireWebshop } from './auth';
import { HttpError, reply, type Actor } from './types';

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
      actor.id,
      action,
      resource,
      JSON.stringify(details),
    );
}

export async function handleAdmin(
  request: Request,
  db: D1Database,
  actor: Actor,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (path === '/api/platform/me' && method === 'GET')
    return reply({ user: actor });
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
  if (path === '/api/platform/users') {
    admin(actor);
    if (method === 'GET')
      return reply({
        users: (
          await db
            .prepare(
              'SELECT id,email,status,identity_issuer,identity_subject FROM users ORDER BY email,id',
            )
            .all()
        ).results,
      });
    if (method === 'POST') {
      const input = await body(request),
        id = crypto.randomUUID(),
        email = text(input, 'email', 254),
        issuer = text(input, 'issuer', 250),
        subject = text(input, 'subject', 250);
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !/^(https:\/\/|urn:)/.test(issuer)
      )
        throw new HttpError(400, 'Ugyldig email eller identitetsudsteder.');
      await db.batch([
        db
          .prepare(
            'INSERT INTO users(id,email,identity_issuer,identity_subject) VALUES(?,?,?,?)',
          )
          .bind(id, email, issuer, subject),
        audit(db, actor, null, 'user.created', id, { email }),
      ]);
      return reply({ id }, 201);
    }
  }
  const userMatch = path.match(/^\/api\/platform\/users\/([\w-]+)$/);
  if (userMatch && method === 'PATCH') {
    admin(actor);
    const input = await body(request),
      next = status(input),
      target = userMatch[1];
    if (target === actor.id)
      throw new HttpError(409, 'Du kan ikke deaktivere din egen bruger.');
    // Platform administrator lifecycle is deliberately outside the first UI slice.
    if (
      await db
        .prepare('SELECT user_id FROM platform_admins WHERE user_id=?')
        .bind(target)
        .first()
    )
      throw new HttpError(
        409,
        'Platformadministratorer administreres særskilt.',
      );
    if (
      !(await db
        .prepare('SELECT id FROM users WHERE id=?')
        .bind(target)
        .first())
    )
      throw new HttpError(404, 'Brugeren findes ikke.');
    await db.batch([
      db.prepare('UPDATE users SET status=? WHERE id=?').bind(next, target),
      audit(db, actor, null, 'user.status', target, { status: next }),
    ]);
    return reply({ ok: true });
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
          .prepare(`SELECT w.* FROM webshops w WHERE w.company_id=? AND (?=1 OR
          EXISTS(SELECT 1 FROM company_memberships c WHERE c.company_id=w.company_id AND c.user_id=? AND c.role='admin') OR
          (w.status='active' AND EXISTS(SELECT 1 FROM webshop_memberships m WHERE m.company_id=w.company_id AND m.webshop_id=w.id AND m.user_id=?))) ORDER BY w.name,w.id`)
          .bind(company, actor.platformAdmin ? 1 : 0, actor.id, actor.id)
          .all();
        return reply({ webshops: rows.results });
      }
      if (method === 'POST') {
        const input = await body(request),
          id = crypto.randomUUID(),
          name = text(input, 'name'),
          host = domain(input);
        await db.batch([
          db
            .prepare(
              'INSERT INTO webshops(id,company_id,name,domain) VALUES(?,?,?,?)',
            )
            .bind(id, company, name, host),
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
            'SELECT u.id,u.email,u.status,m.role FROM company_memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=? ORDER BY u.email',
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
        // Only platform admins assign company-wide roles. Company admins may assign webshop grants below.
        admin(actor);
        const input = await body(request),
          user = text(input, 'userId');
        if (
          !(await db
            .prepare("SELECT id FROM users WHERE id=? AND status='active'")
            .bind(user)
            .first())
        )
          throw new HttpError(400, 'Vælg en aktiv bruger.');
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
              'SELECT * FROM audit_events WHERE company_id=? ORDER BY created_at DESC,id DESC LIMIT 100',
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
