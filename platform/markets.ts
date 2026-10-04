// Indstillinger → Markeder: which Shopify markets besides the home market are invoiced and booked, and how.
// The market itself (countries, currency, storefront) is always read live from Shopify Markets; only the shop's
// choices are stored: enabled, invoice language, store name on the invoice and the invoice mail.
import { requireCompany, requireWebshop } from './auth';
import { jsonBody } from './invitations';
import { shopMarkets, type FeedMarket } from './feed-source';
import { demoMarkets, isDemoCompany } from './demo';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

export type MarketLocale = 'da' | 'sv' | 'en';
/** Default invoice mail per language; {{butik}} is the store name shown on the invoice (e.g. Sabeln.se). */
export const invoiceMailTemplates: Record<MarketLocale, { subject: string; body: string }> = {
  da: { subject: 'Faktura {{fakturanummer}} fra {{butik}}', body: 'Hej {{kundenavn}}\n\nTak for din ordre hos {{butik}}.\n\nVedhæftet finder du faktura {{fakturanummer}} for ordre {{ordrenummer}}.\n\nVenlig hilsen\n{{virksomhedsnavn}}' },
  sv: { subject: 'Faktura {{fakturanummer}} från {{butik}}', body: 'Hej {{kundenavn}}\n\nTack för din beställning hos {{butik}}.\n\nBifogat finner du faktura {{fakturanummer}} för order {{ordrenummer}}.\n\nVänliga hälsningar\n{{virksomhedsnavn}}' },
  en: { subject: 'Invoice {{fakturanummer}} from {{butik}}', body: 'Hi {{kundenavn}}\n\nThank you for your order at {{butik}}.\n\nPlease find attached invoice {{fakturanummer}} for order {{ordrenummer}}.\n\nKind regards\n{{virksomhedsnavn}}' },
};
const locales: MarketLocale[] = ['da', 'sv', 'en'];
const localeOf = (value: string | null | undefined): MarketLocale => { const l = String(value || '').split('-')[0].toLowerCase(); return (locales as string[]).includes(l) ? l as MarketLocale : 'en'; };
const hostOf = (url: string) => { try { const h = new URL(url).hostname.replace(/^www\./, ''); return h.charAt(0).toUpperCase() + h.slice(1); } catch { return ''; } };
function text(value: unknown, max: number, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b-\x1f]/.test(value)) throw new HttpError(400, `Udfyld ${label} (højst ${max} tegn).`);
  return value.trim();
}
type Saved = { market_id: string; name: string; countries_json: string; currency: string; locale: MarketLocale; store_name: string; invoice_subject: string; invoice_body: string; vat_mode: string; enabled: number; revision: number; updated_at: string };
const view = (r: Saved) => ({ enabled: !!r.enabled, locale: r.locale, storeName: r.store_name, invoiceSubject: r.invoice_subject, invoiceBody: r.invoice_body, vatMode: r.vat_mode, revision: r.revision, updatedAt: r.updated_at, countries: JSON.parse(r.countries_json) as string[], currency: r.currency, name: r.name });

async function liveMarkets(env: PlatformEnv, company: string, shop: string): Promise<FeedMarket[]> {
  return await isDemoCompany(env, company) ? demoMarkets() : shopMarkets(env, company, shop);
}

export async function handleMarkets(request: Request, env: PlatformEnv, actor: Actor, company: string, shop: string) {
  if (shop === 'none') throw new HttpError(409, 'Forbind en webshop under Integrationer først.');
  const db = env.PLATFORM_DB, write = request.method !== 'GET';
  await requireCompany(db, actor, company, write); await requireWebshop(db, actor, company, shop);
  const saved = (await db.prepare('SELECT * FROM webshop_markets WHERE company_id=? AND webshop_id=? ORDER BY name').bind(company, shop).all<Saved>()).results;
  if (request.method === 'GET') {
    let markets: FeedMarket[] = [], error: string | null = null;
    try { markets = await liveMarkets(env, company, shop); } catch (e) { error = e instanceof HttpError ? e.message : 'Shopify-markederne kunne ikke hentes.'; }
    const home = markets.find(m => m.primary) || null;
    // Every other active market, with what is saved for it; saved markets no longer active in Shopify are listed too.
    const list = markets.filter(m => !m.primary).map(m => {
      const s = saved.find(x => x.market_id === m.id), locale = s?.locale ?? localeOf(m.locale), template = invoiceMailTemplates[locale];
      return { id: m.id, name: m.name, countries: m.countries, currency: m.currency, url: m.url, active: true,
        settings: s ? view(s) : { enabled: false, locale, storeName: hostOf(m.url) || m.name, invoiceSubject: template.subject, invoiceBody: template.body, vatMode: 'domestic', revision: 0, updatedAt: null } };
    });
    for (const s of saved) if (!list.some(m => m.id === s.market_id)) list.push({ id: s.market_id, name: s.name, countries: JSON.parse(s.countries_json), currency: s.currency, url: '', active: false, settings: view(s) });
    return reply({ home: home ? { name: home.name, countries: home.countries, currency: home.currency } : null, markets: list, templates: invoiceMailTemplates, error });
  }
  if (request.method !== 'PUT') throw new HttpError(405, 'Brug Gem.');
  if (actor.support) throw new HttpError(403, 'Afslut supportadgang før markedsopsætning.');
  const b = await jsonBody(request, 12000);
  const id = String(b.marketId || ''), current = saved.find(s => s.market_id === id);
  if (!/^gid:\/\/shopify\/Market\/\d{1,30}$/.test(id)) throw new HttpError(400, 'Vælg et marked.');
  if (typeof b.enabled !== 'boolean' || !(locales as unknown[]).includes(b.locale) || b.vatMode !== 'domestic') throw new HttpError(400, 'Vælg sprog og momsbehandling for markedet.');
  if (!Number.isInteger(b.revision) || b.revision !== (current?.revision ?? 0)) throw new HttpError(409, 'Markedet er ændret i en anden fane. Hent siden igen.');
  const input = { storeName: text(b.storeName, 80, 'butiksnavn på fakturaen'), subject: text(b.invoiceSubject, 200, 'mailens emne'), body: text(b.invoiceBody, 4000, 'mailens tekst') };
  if (/[\r\n]/.test(input.storeName + input.subject)) throw new HttpError(400, 'Butiksnavn og emne skal stå på én linje.');
  // Countries and currency always come from Shopify; a market can only be turned on while it is active there.
  const market = (await liveMarkets(env, company, shop)).find(m => m.id === id);
  if (!market && (b.enabled || !current)) throw new HttpError(409, 'Markedet er ikke aktivt i Shopify.');
  if (market?.primary) throw new HttpError(409, 'Det primære marked faktureres og bogføres altid.');
  const name = market?.name ?? current!.name, countries = JSON.stringify(market?.countries ?? JSON.parse(current!.countries_json)), currency = market?.currency ?? current!.currency;
  const result = await db.batch([
    db.prepare(`INSERT INTO webshop_markets(company_id,webshop_id,market_id,name,countries_json,currency,locale,store_name,invoice_subject,invoice_body,vat_mode,enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(company_id,webshop_id,market_id) DO UPDATE SET name=excluded.name,countries_json=excluded.countries_json,currency=excluded.currency,locale=excluded.locale,store_name=excluded.store_name,invoice_subject=excluded.invoice_subject,invoice_body=excluded.invoice_body,vat_mode=excluded.vat_mode,enabled=excluded.enabled,revision=webshop_markets.revision+1,updated_at=CURRENT_TIMESTAMP WHERE webshop_markets.revision=?`)
      .bind(company, shop, id, name, countries, currency, b.locale, input.storeName, input.subject, input.body, b.vatMode, b.enabled ? 1 : 0, current?.revision ?? 0),
    db.prepare('INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), company, actor.id, b.enabled ? 'market.enabled' : 'market.saved', id, JSON.stringify({ webshopId: shop, countries: JSON.parse(countries), currency })),
  ]);
  if (!result[0].meta.changes) throw new HttpError(409, 'Markedet er ændret i en anden fane. Hent siden igen.');
  return reply({ saved: true });
}
