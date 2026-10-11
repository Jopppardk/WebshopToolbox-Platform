import { handleShipmondo } from './shipmondo';
import { paymentProviderPattern } from './catalog';
import { handlePerformance } from './performance-source';
import { handleShipments } from './shipments-source';
import { handleShopFinance } from './dashboard-shop';
import { demoTier1, isDemoCompany } from './demo';
import { handleReconciliation } from './booking-onboarding';
import { handleTier1Emballage } from './tier1-emballage';
import { handleShopifyFields } from './shopify-metafields';
import { handlePackagingProducts } from './packaging-products';
import { handleFeeds } from './feeds';
import { handleTier1Data } from './tier1-data';
import { handleAttention } from './attention';
import { handleHistory } from './tier1-history';
import { handleTier1Connections } from './tier1-connections';
import { requireCompany, requireWebshop } from './auth';
import { financeService } from './finance-source';
import { handleTier1Settings } from './tier1-settings';
import { handleMarkets } from './markets';
import { handleLabel, handleLabelPrinter } from './shipmondo-labels';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

// The customer portal is shared by local, dev and production deployments.
// Incomplete contracts fail explicitly, never masquerading as empty live data.
export async function handleTier1(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
) {
  if (actor.platformAdmin)
    throw new HttpError(403, 'Åbn Tier 1 med en virksomhedsbruger.');
  // Support sees the customer's portal as the customer does, but never changes data or books on their behalf.
  if (actor.support && !['GET', 'HEAD'].includes(request.method))
    throw new HttpError(
      403,
      'Supportadgang kan kun se kundeportalen. Ændringer foretages af kunden selv.',
    );
  const db = env.PLATFORM_DB,
    url = new URL(request.url);
  const match = url.pathname.match(
    /^\/api\/platform\/tier1\/shops\/([\w-]+)(\/.*)$/,
  );
  if (!match) throw new HttpError(404, 'Funktionen findes ikke.');
  const company = await db
    .prepare('SELECT company_id FROM users WHERE id=?')
    .bind(actor.id)
    .first<{ company_id: string }>();
  if (!company?.company_id) throw new HttpError(403, 'Ingen virksomhed.');
  await requireCompany(db, actor, company.company_id);
  const [, shop, path] = match;
  if (shop !== 'none')
    await requireWebshop(db, actor, company.company_id, shop);
  // Demokonto: only its own database rows are read or written; provider calls are simulated or refused.
  if (await isDemoCompany(env, company.company_id)) {
    const demo = await demoTier1(request, path);
    if (demo) return demo;
  }
  if (path === '/markets/settings')
    return handleMarkets(request, env, actor, company.company_id, shop);
  if (path === '/shipmondo/printer')
    return handleLabelPrinter(request, env, actor, company.company_id, shop);
  if (path === '/shipmondo/label')
    return handleLabel(request, env, actor, company.company_id, shop);
  if (path === '/shipmondo/connection')
    return handleShipmondo(request, env, actor, company.company_id, shop);
  if (path.startsWith('/performance/'))
    return handlePerformance(
      request,
      env,
      actor,
      company.company_id,
      shop,
      path,
    );
  if (path === '/dashboard/shop')
    return handleShopFinance(request, env, actor, company.company_id, shop);
  if (path === '/shipments' || path === '/shipments/refresh')
    return handleShipments(request, env, actor, company.company_id, shop, path);
  if (path === '/feeds' || path.startsWith('/feeds/'))
    return handleFeeds(request, env, actor, company.company_id, shop, path);
  if (path === '/emballage/shopify-fields')
    return handleShopifyFields(request, env, actor, company.company_id, shop);
  if (path === '/emballage/products')
    return handlePackagingProducts(
      request,
      env,
      actor,
      company.company_id,
      shop,
    );
  if (path === '/emballage/connection' || path === '/emballage/reporting')
    return handleTier1Emballage(
      request,
      env,
      actor,
      company.company_id,
      shop,
      path,
    );
  if (path === '/admin/history' || path === '/integrations/start-date')
    return handleHistory(request, env, actor, company.company_id, shop, path);
  if (path === '/attention')
    return handleAttention(request, env, actor, company.company_id, shop);
  if (path === '/integrations/reconciliation')
    return handleReconciliation(request, env, actor, company.company_id, shop);
  const data = await handleTier1Data(
    request,
    env,
    actor,
    company.company_id,
    shop,
    path,
  );
  if (data) return data;
  if (
    path === '/integrations' ||
    path === '/integrations/selection' ||
    new RegExp(`^/(${paymentProviderPattern})/connection$`).test(path)
  )
    return handleTier1Connections(
      request,
      env,
      actor,
      company.company_id,
      shop,
      path,
    );
  if (path === '/admin/settings') {
    if (shop === 'none')
      throw new HttpError(409, 'Opret din webshop under Integrationer først.');
    return handleTier1Settings(request, env, actor, company.company_id, shop);
  }
  if (request.method !== 'GET')
    throw new HttpError(
      501,
      'Denne handling er endnu ikke tilsluttet i den nye Tier 1.',
    );
  if (path === '/dashboard/finance') {
    await requireCompany(db, actor, company.company_id, true);
    return reply(
      await financeService(env, company.company_id).dashboardFinance(),
    );
  }
  if (path === '/dinero/accounts') {
    await requireCompany(db, actor, company.company_id, true);
    const row = await db
      .prepare(
        'SELECT chart_json,verified_at FROM accounting_connections WHERE company_id=?',
      )
      .bind(company.company_id)
      .first<{ chart_json: string; verified_at: string }>();
    return reply({
      accounts: row ? JSON.parse(row.chart_json) : [],
      fetchedAt: row?.verified_at || null,
    });
  }
  throw new HttpError(
    501,
    'Denne funktion er endnu ikke tilsluttet i den nye Tier 1.',
  );
}
