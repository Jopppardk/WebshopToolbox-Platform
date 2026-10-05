// Indstillinger → Faktura-afsendelse, the tab of a market other than Danmark: whether its orders are invoiced and
// booked, the store shown on its invoices, and its invoice and credit-note mail texts. Its company details, design,
// logo and sender are the same settings as Danmark's, per market (invoices.ts, mail.ts). The market itself
// (countries, currency, language, storefront) is always read live from Shopify Markets.
import { requireCompany, requireWebshop } from './auth';
import { jsonBody } from './invitations';
import { shopMarkets, type FeedMarket } from './feed-source';
import { demoMarkets, isDemoCompany } from './demo';
import { creditMailTemplates, danishSettings, ensureMarketRow, invoiceMailTemplates, localeOf, profileOf, type MarketRow } from './invoice-profiles';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

export { invoiceMailTemplates };
function text(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b-\x1f]/.test(value)) throw new HttpError(400, `Udfyld ${label} (højst ${max} tegn).`);
  return value.trim();
}
const hostOf = (url: string) => { try { const h = new URL(url).hostname.replace(/^www\./, ''); return h.charAt(0).toUpperCase() + h.slice(1); } catch { return ''; } };
async function liveMarkets(env: PlatformEnv, company: string, shop: string): Promise<FeedMarket[]> {
  return await isDemoCompany(env, company) ? demoMarkets() : shopMarkets(env, company, shop);
}

export async function handleMarkets(request: Request, env: PlatformEnv, actor: Actor, company: string, shop: string) {
  if (shop === 'none') throw new HttpError(409, 'Forbind en webshop under Integrationer først.');
  const db = env.PLATFORM_DB, write = request.method !== 'GET';
  await requireCompany(db, actor, company, write); await requireWebshop(db, actor, company, shop);
  const saved = (await db.prepare('SELECT * FROM webshop_markets WHERE company_id=? AND webshop_id=? ORDER BY name').bind(company, shop).all<MarketRow>()).results;
  if (request.method === 'GET') {
    let markets: FeedMarket[] = [], error: string | null = null;
    try { markets = await liveMarkets(env, company, shop); } catch (e) { error = e instanceof HttpError ? e.message : 'Shopify-markederne kunne ikke hentes.'; }
    const home = markets.find(m => m.primary) || null, dk = await danishSettings(env, company);
    const view = (s: MarketRow | undefined, m: { locale: string | null; url: string; name: string }) => {
      const locale = s?.locale ?? localeOf(m.locale), profile = s ? profileOf(dk, s) : null;
      return { enabled: !!s?.enabled, locale, storeName: s?.store_name ?? (hostOf(m.url) || m.name),
        invoiceSubject: s?.invoice_subject ?? invoiceMailTemplates[locale].subject, invoiceBody: s?.invoice_body ?? invoiceMailTemplates[locale].body,
        creditSubject: profile?.creditSubject ?? creditMailTemplates[locale].subject, creditBody: profile?.creditBody ?? creditMailTemplates[locale].body,
        vatMode: 'domestic', revision: s?.revision ?? 0, updatedAt: s?.updated_at ?? null };
    };
    // Every other active market, with what is saved for it; saved markets no longer active in Shopify are listed too.
    const list = markets.filter(m => !m.primary).map(m => ({ id: m.id, name: m.name, countries: m.countries, currency: m.currency, url: m.url, active: true, settings: view(saved.find(x => x.market_id === m.id), m) }));
    for (const s of saved) if (!list.some(m => m.id === s.market_id)) list.push({ id: s.market_id, name: s.name, countries: JSON.parse(s.countries_json), currency: s.currency, url: '', active: false, settings: view(s, { locale: s.locale, url: '', name: s.name }) });
    return reply({ home: home ? { name: home.name, countries: home.countries, currency: home.currency } : null, markets: list, templates: invoiceMailTemplates, creditTemplates: creditMailTemplates, error });
  }
  if (request.method !== 'PUT') throw new HttpError(405, 'Brug Gem.');
  if (actor.support) throw new HttpError(403, 'Afslut supportadgang før markedsopsætning.');
  const b = await jsonBody(request, 16000);
  const id = String(b.marketId || '');
  if (!/^gid:\/\/shopify\/Market\/\d{1,30}$/.test(id)) throw new HttpError(400, 'Vælg et marked.');
  if (typeof b.enabled !== 'boolean' || b.vatMode !== 'domestic') throw new HttpError(400, 'Vælg momsbehandling for markedet.');
  const input = { storeName: text(b.storeName, 80, 'webshopnavnet på fakturaen'), subject: text(b.invoiceSubject, 200, 'fakturamailens emne'), body: text(b.invoiceBody, 4000, 'fakturamailens tekst'),
    creditSubject: text(b.creditSubject, 200, 'kreditnotamailens emne'), creditBody: text(b.creditBody, 4000, 'kreditnotamailens tekst') };
  if (/[\r\n]/.test(input.storeName + input.subject + input.creditSubject)) throw new HttpError(400, 'Webshopnavn og emner skal stå på én linje.');
  // Countries, currency and language always come from Shopify; a market can only be turned on while it is active there.
  const market = (await liveMarkets(env, company, shop).catch(() => [] as FeedMarket[])).find(m => m.id === id);
  const known = saved.find(s => s.market_id === id), current = known ?? (market ? await ensureMarketRow(env, company, shop, id) : null);
  if (!current || (!market && b.enabled)) throw new HttpError(409, 'Markedet er ikke aktivt i Shopify.');
  if (market?.primary) throw new HttpError(409, 'Danmark indstilles på fanen Danmark.');
  // A market saved before is changed from the revision the page showed; a new one starts from 0.
  if (!Number.isInteger(b.revision) || b.revision !== (known ? known.revision : 0)) throw new HttpError(409, 'Markedet er ændret i en anden fane. Hent siden igen.');
  const name = market?.name ?? current.name, countries = JSON.stringify(market?.countries ?? JSON.parse(current.countries_json)), currency = market?.currency ?? current.currency, locale = market ? localeOf(market.locale) : current.locale;
  const result = await db.batch([
    db.prepare(`UPDATE webshop_markets SET name=?,countries_json=?,currency=?,locale=?,store_name=?,invoice_subject=?,invoice_body=?,credit_subject=?,credit_body=?,vat_mode=?,enabled=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND market_id=? AND revision=?`)
      .bind(name, countries, currency, locale, input.storeName, input.subject, input.body, input.creditSubject, input.creditBody, b.vatMode, b.enabled ? 1 : 0, company, shop, id, current.revision),
    db.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), company, actor.id, b.enabled ? 'market.enabled' : 'market.saved', id, JSON.stringify({ webshopId: shop, countries: JSON.parse(countries), currency })),
  ]);
  if (!result[0].meta.changes) throw new HttpError(409, 'Markedet er ændret i en anden fane. Hent siden igen.');
  return reply({ saved: true });
}
