import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError, type Actor, type PlatformEnv } from './types';

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function identity(request: Request, env: PlatformEnv) {
  try {
    if (
      env.PLATFORM_ENV === 'local-test' &&
      env.PLATFORM_AUTH === 'local-jwt'
    ) {
      const url = new URL(request.url);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !env.PLATFORM_LOCAL_SECRET ||
        env.PLATFORM_LOCAL_SECRET.length < 32
      ) {
        throw new Error('Local auth unavailable');
      }
      const cookie = request.headers
        .get('cookie')
        ?.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('platform_local='))
        ?.slice(15);
      const bearer = request.headers
        .get('authorization')
        ?.match(/^Bearer (.+)$/)?.[1];
      const { payload } = await jwtVerify(
        bearer || cookie || '',
        new TextEncoder().encode(env.PLATFORM_LOCAL_SECRET),
        {
          issuer: 'urn:webshop-toolbox:local-test',
          audience: 'platform-local',
          algorithms: ['HS256'],
          requiredClaims: ['sub', 'exp', 'iat'],
        },
      );
      return { issuer: payload.iss!, subject: payload.sub! };
    }
    if (
      env.PLATFORM_AUTH !== 'cloudflare-access' ||
      !env.PLATFORM_ACCESS_AUD ||
      !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(
        env.PLATFORM_ACCESS_ISSUER || '',
      )
    ) {
      throw new HttpError(
        503,
        'Login er endnu ikke konfigureret for testmiljøet.',
      );
    }
    const issuer = env.PLATFORM_ACCESS_ISSUER!;
    let keys = keySets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
        timeoutDuration: 5000,
      });
      keySets.set(issuer, keys);
    }
    const { payload } = await jwtVerify(
      request.headers.get('cf-access-jwt-assertion') || '',
      keys,
      {
        issuer,
        audience: env.PLATFORM_ACCESS_AUD,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat'],
      },
    );
    return { issuer, subject: payload.sub! };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'Log ind for at fortsætte.');
  }
}

export async function authenticate(
  request: Request,
  env: PlatformEnv,
): Promise<Actor> {
  const claim = await identity(request, env);
  const user = await env.PLATFORM_DB.prepare(`SELECT u.id,u.email,
    EXISTS(SELECT 1 FROM platform_admins a WHERE a.user_id=u.id) AS platform_admin
    FROM users u WHERE u.identity_issuer=? AND u.identity_subject=? AND u.status='active'`)
    .bind(claim.issuer, claim.subject)
    .first<{ id: string; email: string; platform_admin: number }>();
  if (!user)
    throw new HttpError(403, 'Brugeren er ikke oprettet eller er deaktiveret.');
  return {
    id: user.id,
    email: user.email,
    platformAdmin: !!user.platform_admin,
  };
}

export async function requireCompany(
  db: D1Database,
  actor: Actor,
  companyId: string,
  manage = false,
) {
  const company = await db
    .prepare('SELECT id,status FROM companies WHERE id=?')
    .bind(companyId)
    .first<{ id: string; status: string }>();
  if (!company) throw new HttpError(404, 'Virksomheden findes ikke.');
  if (actor.platformAdmin) return company;
  const membership = await db
    .prepare(
      'SELECT role FROM company_memberships WHERE company_id=? AND user_id=?',
    )
    .bind(companyId, actor.id)
    .first<{ role: string }>();
  if (
    company.status !== 'active' ||
    !membership ||
    (manage && membership.role !== 'admin')
  )
    throw new HttpError(403, 'Ingen adgang til virksomheden.');
  return company;
}

export async function requireWebshop(
  db: D1Database,
  actor: Actor,
  companyId: string,
  webshopId: string,
) {
  await requireCompany(db, actor, companyId);
  const shop = await db
    .prepare('SELECT id,status FROM webshops WHERE company_id=? AND id=?')
    .bind(companyId, webshopId)
    .first<{ id: string; status: string }>();
  if (!shop) throw new HttpError(404, 'Webshoppen findes ikke.');
  if (actor.platformAdmin) return shop;
  const role = await db
    .prepare(`SELECT c.role AS company_role,w.role AS webshop_role FROM company_memberships c
    LEFT JOIN webshop_memberships w ON w.company_id=c.company_id AND w.user_id=c.user_id AND w.webshop_id=?
    WHERE c.company_id=? AND c.user_id=?`)
    .bind(webshopId, companyId, actor.id)
    .first<{ company_role: string; webshop_role: string | null }>();
  if (
    shop.status !== 'active' ||
    (role?.company_role !== 'admin' && !role?.webshop_role)
  )
    throw new HttpError(403, 'Ingen adgang til webshoppen.');
  return shop;
}
