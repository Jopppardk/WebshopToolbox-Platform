import { jsonBody } from './invitations';
import { requireCompany } from './auth';
import { handleShopSync, runDueShopSyncs, shopSyncAppId } from './shop-sync';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

// Custom apps: functions built for one customer. The code lives here in the repository; a platform administrator
// turns an app on for exactly one company in Tier 0 (table custom_apps, app_id is the primary key). The portal shows
// the menu "Custom apps" only to companies with an app turned on, and every call checks the company on the server.
//
// A new app: add it to `apps` below with a handler for its own calls (Tier 1 path /custom-apps/{id}/...), and its
// page to `customAppViews` in tier1/src/components/custom-apps.tsx. Use requireWebshop for each webshop it touches.
export type CustomAppContext = {
  request: Request;
  env: PlatformEnv;
  actor: Actor;
  company: string;
  shop: string;
  // The rest of the path after /custom-apps/{id}, e.g. '/status'.
  path: string;
};
export type CustomApp = {
  id: string;
  name: string;
  description: string;
  // false: only offered in dev and local test, never in production.
  production: boolean;
  handle?: (context: CustomAppContext) => Promise<Response>;
  // Automatic work, called from the scheduled run (worker.ts). It only acts for companies with the app on.
  scheduled?: (env: PlatformEnv) => Promise<unknown>;
};

const apps: CustomApp[] = [
  {
    id: shopSyncAppId,
    name: 'Webshop-synkronisering',
    description:
      'Opretter udvalgte kollektioner og produkter fra én webshop i en anden og holder tekster, billeder, priser og lager synkroniseret.',
    production: true,
    handle: handleShopSync,
    scheduled: runDueShopSyncs,
  },
  {
    // Shows that the frame works on dev before a real app exists. Reads nothing and changes nothing.
    id: 'eksempel',
    name: 'Eksempel',
    description:
      'Testapp, der viser at Custom apps virker. Findes ikke i produktion.',
    production: false,
    handle: async ({ request, path, company, shop }) => {
      if (path === '/status' && request.method === 'GET')
        return reply({ ok: true, company, webshop: shop });
      throw new HttpError(404, 'Funktionen findes ikke i appen.');
    },
  },
];

export function availableApps(env: PlatformEnv) {
  return apps.filter(
    (app) => app.production || env.PLATFORM_ENV !== 'production',
  );
}
export async function runCustomApps(env: PlatformEnv) {
  for (const app of availableApps(env))
    if (app.scheduled)
      await app
        .scheduled(env)
        .catch((error) => console.error('Custom app fejlede', app.id, error));
}
const describe = ({ id, name, description }: CustomApp) => ({
  id,
  name,
  description,
});

async function enabledApps(env: PlatformEnv, company: string) {
  const rows = await env.PLATFORM_DB.prepare(
    'SELECT app_id FROM custom_apps WHERE company_id=?',
  )
    .bind(company)
    .all<{ app_id: string }>();
  const on = new Set(rows.results.map((row) => row.app_id));
  return availableApps(env).filter((app) => on.has(app.id));
}

// Tier 1: /custom-apps lists the company's apps; /custom-apps/{id}/... reaches the app, only for its own company.
export async function handleTier1CustomApps(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  path: string,
) {
  const enabled = await enabledApps(env, company);
  if (path === '/custom-apps') {
    if (request.method !== 'GET') throw new HttpError(405, 'Brug Hent.');
    return reply({ apps: enabled.map(describe) });
  }
  const match = path.match(/^\/custom-apps\/([\w-]+)(\/.*)?$/);
  const app = match && enabled.find((item) => item.id === match[1]);
  // The same answer whether the app does not exist or belongs to another company.
  if (!match || !app)
    throw new HttpError(404, 'Appen findes ikke for din virksomhed.');
  if (!match[2]) {
    if (request.method !== 'GET') throw new HttpError(405, 'Brug Hent.');
    return reply({ app: describe(app) });
  }
  if (!app.handle) throw new HttpError(404, 'Funktionen findes ikke i appen.');
  return app.handle({ request, env, actor, company, shop, path: match[2] });
}

// Tier 0: GET /api/platform/companies/{company}/custom-apps, PUT/DELETE .../custom-apps/{app}. Platform administrators only.
export async function handleAdminCustomApps(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  appId: string | undefined,
) {
  if (!actor.platformAdmin)
    throw new HttpError(403, 'Kræver platformadministrator.');
  const db = env.PLATFORM_DB;
  await requireCompany(db, actor, company);
  const owners = async () =>
    (
      await db
        .prepare(
          'SELECT a.app_id,a.company_id,a.enabled_at,c.name company_name FROM custom_apps a JOIN companies c ON c.id=a.company_id',
        )
        .all<{
          app_id: string;
          company_id: string;
          enabled_at: string;
          company_name: string;
        }>()
    ).results;
  if (!appId) {
    if (request.method !== 'GET') throw new HttpError(405, 'Brug Hent.');
    const rows = await owners();
    return reply({
      apps: availableApps(env).map((app) => {
        const owner = rows.find((row) => row.app_id === app.id);
        return {
          ...describe(app),
          companyId: owner?.company_id ?? null,
          companyName: owner?.company_name ?? null,
          enabledAt: owner?.enabled_at ?? null,
        };
      }),
    });
  }
  const app = availableApps(env).find((item) => item.id === appId);
  if (!app) throw new HttpError(404, 'Appen findes ikke.');
  if (request.method !== 'PUT' && request.method !== 'DELETE')
    throw new HttpError(405, 'Brug Slå til eller Slå fra.');
  await jsonBody(request);
  // Logged only when the app is on for this company: after turning it on, and before turning it off.
  const auditEvent = (action: string) =>
    db
      .prepare(
        `INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) SELECT ?,?,?,?,?,?
        WHERE EXISTS(SELECT 1 FROM custom_apps WHERE app_id=? AND company_id=?)`,
      )
      .bind(
        crypto.randomUUID(),
        company,
        actor.id,
        action,
        app.id,
        JSON.stringify({ app: app.name }),
        app.id,
        company,
      );
  if (request.method === 'DELETE') {
    await db.batch([
      auditEvent('custom_app.disabled'),
      db
        .prepare('DELETE FROM custom_apps WHERE app_id=? AND company_id=?')
        .bind(app.id, company),
    ]);
    return reply({ ok: true });
  }
  const other = (await owners()).find(
    (row) => row.app_id === app.id && row.company_id !== company,
  );
  if (other)
    throw new HttpError(
      409,
      `${app.name} er slået til for ${other.company_name}. En app kan kun bruges af én virksomhed; slå den fra der først.`,
    );
  // The primary key stops a second company even if two administrators turn the app on at the same time.
  await db.batch([
    db
      .prepare(
        'INSERT INTO custom_apps(app_id,company_id,enabled_by) VALUES(?,?,?) ON CONFLICT(app_id) DO NOTHING',
      )
      .bind(app.id, company, actor.id),
    auditEvent('custom_app.enabled'),
  ]);
  const owner = (await owners()).find((row) => row.app_id === app.id);
  if (owner?.company_id !== company)
    throw new HttpError(
      409,
      `${app.name} er slået til for en anden virksomhed.`,
    );
  return reply({ ok: true });
}
