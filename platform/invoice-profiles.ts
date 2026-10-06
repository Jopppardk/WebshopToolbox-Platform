// Invoice settings per country. Danmark is the company's invoice_settings/company_mail; every other market has
// the same settings in webshop_markets/market_mail, where an empty value means "as Danmark".
import { HttpError, type PlatformEnv } from './types';
import { invoiceDesign, type InvoiceDesign } from './invoice-design';
import { shopMarkets } from './feed-source';
import { demoMarkets, isDemoCompany } from './demo';

export type Locale = 'da' | 'sv' | 'en';
export const localeOf = (value: string | null | undefined): Locale => {
  const l = String(value || '')
    .split('-')[0]
    .toLowerCase();
  return l === 'da' || l === 'sv' ? l : 'en';
};

/** Default invoice mail per language; {{butik}} is the store shown on the invoice (e.g. Sabeln.se). */
export const invoiceMailTemplates: Record<
  Locale,
  { subject: string; body: string }
> = {
  da: {
    subject: 'Faktura {{fakturanummer}} fra {{butik}}',
    body: 'Hej {{kundenavn}}\n\nTak for din ordre hos {{butik}}.\n\nVedhæftet finder du faktura {{fakturanummer}} for ordre {{ordrenummer}}.\n\nVenlig hilsen\n{{virksomhedsnavn}}',
  },
  sv: {
    subject: 'Faktura {{fakturanummer}} från {{butik}}',
    body: 'Hej {{kundenavn}}\n\nTack för din beställning hos {{butik}}.\n\nBifogat finner du faktura {{fakturanummer}} för order {{ordrenummer}}.\n\nVänliga hälsningar\n{{virksomhedsnavn}}',
  },
  en: {
    subject: 'Invoice {{fakturanummer}} from {{butik}}',
    body: 'Hi {{kundenavn}}\n\nThank you for your order at {{butik}}.\n\nPlease find attached invoice {{fakturanummer}} for order {{ordrenummer}}.\n\nKind regards\n{{virksomhedsnavn}}',
  },
};
/** Default credit-note mail per language. */
export const creditMailTemplates: Record<
  Locale,
  { subject: string; body: string }
> = {
  da: {
    subject: 'Kreditnota {{kreditnotanummer}} fra {{virksomhedsnavn}}',
    body: 'Hej {{kundenavn}}\n\nVi har tilbagebetalt {{beløb}} for ordre {{ordrenummer}}.\n\nVedhæftet finder du kreditnota {{kreditnotanummer}}.\n\nVenlig hilsen\n{{virksomhedsnavn}}',
  },
  sv: {
    subject: 'Kreditfaktura {{kreditnotanummer}} från {{butik}}',
    body: 'Hej {{kundenavn}}\n\nVi har återbetalat {{beløb}} för order {{ordrenummer}}.\n\nBifogat finner du kreditfaktura {{kreditnotanummer}}.\n\nVänliga hälsningar\n{{virksomhedsnavn}}',
  },
  en: {
    subject: 'Credit note {{kreditnotanummer}} from {{butik}}',
    body: 'Hi {{kundenavn}}\n\nWe have refunded {{beløb}} for order {{ordrenummer}}.\n\nPlease find attached credit note {{kreditnotanummer}}.\n\nKind regards\n{{virksomhedsnavn}}',
  },
};
/** Fills {{placeholders}}; unknown ones are left as written. */
export const fillTemplate = (text: string, values: Record<string, string>) =>
  text.replace(
    /{{\s*([a-zæøå]+)\s*}}/gi,
    (all, k: string) => values[k.toLowerCase()] ?? all,
  );

type DanishSettings = {
  name: string;
  address: string;
  cvr: string;
  contact: string;
  logo_key: string | null;
  design_json?: string | null;
  subject: string;
  body: string;
  credit_subject?: string | null;
  credit_body?: string | null;
};
export type MarketRow = {
  market_id: string;
  name: string;
  countries_json: string;
  currency: string;
  locale: Locale;
  store_name: string;
  contact: string | null;
  footer: string | null;
  invoice_subject: string;
  invoice_body: string;
  credit_subject: string | null;
  credit_body: string | null;
  issuer_json: string | null;
  design_json: string | null;
  logo_key: string | null;
  enabled: number;
  revision: number;
  updated_at: string;
};
export type InvoiceProfile = {
  issuer: { name: string; address: string; cvr: string; contact: string };
  design: InvoiceDesign;
  logoKey: string | null;
  ownLogo: boolean;
  locale: Locale;
  storeName: string | null;
  invoiceSubject: string;
  invoiceBody: string;
  creditSubject: string;
  creditBody: string;
};

export async function danishSettings(
  env: PlatformEnv,
  company: string,
): Promise<DanishSettings> {
  const saved = await env.PLATFORM_DB.prepare(
    'SELECT * FROM invoice_settings WHERE company_id=?',
  )
    .bind(company)
    .first<DanishSettings>();
  if (saved) return saved;
  const c = await env.PLATFORM_DB.prepare(
    'SELECT name FROM companies WHERE id=?',
  )
    .bind(company)
    .first<{ name: string }>();
  return {
    name: c!.name,
    address: '',
    cvr: '',
    contact: '',
    logo_key: null,
    design_json: null,
    subject: 'Faktura {{fakturanummer}} fra {{virksomhedsnavn}}',
    body: invoiceMailTemplates.da.body.replaceAll(
      '{{butik}}',
      '{{virksomhedsnavn}}',
    ),
    credit_subject: null,
    credit_body: null,
  };
}
export async function marketRow(
  env: PlatformEnv,
  company: string,
  shop: string,
  marketId: string,
) {
  return env.PLATFORM_DB.prepare(
    'SELECT * FROM webshop_markets WHERE company_id=? AND webshop_id=? AND market_id=?',
  )
    .bind(company, shop, marketId)
    .first<MarketRow>();
}
/** The invoice settings that apply: Danmark's, or a market's with Danmark's where the market has none. */
export function profileOf(
  dk: DanishSettings,
  market: MarketRow | null,
): InvoiceProfile {
  const dkDesign = invoiceDesign(JSON.parse(dk.design_json || '{}'));
  const dkCredit = {
    subject: dk.credit_subject || creditMailTemplates.da.subject,
    body: dk.credit_body || creditMailTemplates.da.body,
  };
  if (!market)
    return {
      issuer: {
        name: dk.name,
        address: dk.address,
        cvr: dk.cvr,
        contact: dk.contact,
      },
      design: dkDesign,
      logoKey: dk.logo_key,
      ownLogo: !!dk.logo_key,
      locale: 'da',
      storeName: null,
      invoiceSubject: dk.subject,
      invoiceBody: dk.body,
      creditSubject: dkCredit.subject,
      creditBody: dkCredit.body,
    };
  const issuer = market.issuer_json
    ? JSON.parse(market.issuer_json)
    : {
        name: dk.name,
        address: dk.address,
        cvr: dk.cvr,
        contact: market.contact || dk.contact,
      };
  const design = market.design_json
    ? invoiceDesign(JSON.parse(market.design_json))
    : market.footer
      ? { ...dkDesign, footer: market.footer }
      : dkDesign;
  const credit = creditMailTemplates[market.locale];
  return {
    issuer,
    design,
    logoKey: market.logo_key === null ? dk.logo_key : market.logo_key || null,
    ownLogo: market.logo_key !== null,
    locale: market.locale,
    storeName: market.store_name,
    invoiceSubject: market.invoice_subject,
    invoiceBody: market.invoice_body,
    creditSubject: market.credit_subject || credit.subject,
    creditBody: market.credit_body || credit.body,
  };
}
const hostOf = (url: string) => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return h.charAt(0).toUpperCase() + h.slice(1);
  } catch {
    return '';
  }
};
/** A market's row, created from Shopify (off, with its language's texts) the first time its settings are saved. */
export async function ensureMarketRow(
  env: PlatformEnv,
  company: string,
  shop: string,
  marketId: string,
): Promise<MarketRow> {
  const existing = await marketRow(env, company, shop, marketId);
  if (existing) return existing;
  const market = (
    (await isDemoCompany(env, company))
      ? demoMarkets()
      : await shopMarkets(env, company, shop)
  ).find((m) => m.id === marketId);
  if (!market || market.primary)
    throw new HttpError(409, 'Markedet er ikke aktivt i Shopify.');
  const locale = localeOf(market.locale),
    t = invoiceMailTemplates[locale];
  await env.PLATFORM_DB.prepare(
    "INSERT INTO webshop_markets(company_id,webshop_id,market_id,name,countries_json,currency,locale,store_name,invoice_subject,invoice_body,vat_mode,enabled) VALUES(?,?,?,?,?,?,?,?,?,?,'domestic',0) ON CONFLICT DO NOTHING",
  )
    .bind(
      company,
      shop,
      marketId,
      market.name,
      JSON.stringify(market.countries),
      market.currency,
      locale,
      hostOf(market.url) || market.name,
      t.subject,
      t.body,
    )
    .run();
  return (await marketRow(env, company, shop, marketId))!;
}
