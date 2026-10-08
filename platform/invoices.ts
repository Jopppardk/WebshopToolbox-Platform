import { withTranslatedLines } from './invoice-translations';
import { asText } from './tier1/src/lib/format';
import { recordFailure } from './record-history';
import { PDFDocument } from 'pdf-lib';
import { invoiceDesign, exampleInvoice } from './invoice-design';
import { historyPolicy } from './tier1-history';
import { requireCompany, requireWebshop } from './auth';
import {
  foreignHold,
  isForeignOrder,
  orderMarketSettings,
  type WebshopMarket,
} from './order-markets';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';
import { jsonBody } from './invitations';
import { handleMail, sendCustomerInvoice } from './mail';
import { buildInvoicePdf } from './invoice-pdf';
import {
  shopAccess,
  listInvoiceOrders,
  loadCompleteOrder,
} from './invoice-source';
import {
  danishSettings,
  ensureMarketRow,
  fillTemplate,
  marketRow,
  profileOf,
  type InvoiceProfile,
} from './invoice-profiles';
import {
  checkInvoice,
  inPresentment,
  invoiceFingerprint,
  originalOrder,
  type InvoiceSource,
} from './order-check';

type Settings = {
  name: string;
  address: string;
  cvr: string;
  contact: string;
  subject: string;
  body: string;
  months: number;
  logo_key: string | null;
  design_json?: string;
  revision?: number;
};
const template = {
  subject: 'Faktura {{fakturanummer}} fra {{virksomhedsnavn}}',
  body: 'Hej {{kundenavn}}\n\nTak for din ordre hos {{virksomhedsnavn}}.\n\nVedhæftet finder du faktura {{fakturanummer}} for ordre {{ordrenummer}}.\n\nVenlig hilsen\n{{virksomhedsnavn}}',
};
async function settings(env: PlatformEnv, company: string): Promise<Settings> {
  return (
    (await env.PLATFORM_DB.prepare(
      'SELECT * FROM invoice_settings WHERE company_id=?',
    )
      .bind(company)
      .first<Settings>()) || {
      name: (await env.PLATFORM_DB.prepare(
        'SELECT name FROM companies WHERE id=?',
      )
        .bind(company)
        .first<{ name: string }>())!.name,
      address: '',
      cvr: '',
      contact: '',
      ...template,
      months: 3,
      logo_key: null,
    }
  );
}
function text(value: unknown, max: number) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x08\x0b-\x1f]/.test(value)
  )
    throw new HttpError(400, 'Udfyld fakturaoplysningerne korrekt.');
  return value.trim();
}
function cutoff(s: Settings) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - s.months);
  return d.toISOString();
}
function ready(s: Settings) {
  if (!s.address || !s.cvr || !s.contact)
    throw new HttpError(
      409,
      'Udfyld virksomhedens fakturaoplysninger under Indstillinger → Fakturaer først.',
    );
}
// An order from another market is mailed with that market's text (e.g. Swedish); {{butik}} is its store name.
export function invoiceText(
  s: Settings,
  order: InvoiceSource,
  market?: WebshopMarket | null,
) {
  const i = checkInvoice(order),
    values: Record<string, string> = {
      kundenavn: i.customer.name,
      fakturanummer: i.number.replace(/^#/, ''),
      ordrenummer: i.number,
      virksomhedsnavn: s.name,
      butik: market?.store_name ?? s.name,
    };
  const apply = (v: string) =>
    v.replace(
      /{{\s*([a-zæøå]+)\s*}}/gi,
      (all, k) => values[k.toLowerCase()] ?? all,
    );
  return {
    subject: apply(market?.invoice_subject ?? s.subject),
    text: apply(market?.invoice_body ?? s.body),
  };
}
/** The invoice mail of a profile (Danmark's or a market's). */
export function profileText(
  profile: InvoiceProfile,
  company: string,
  order: InvoiceSource,
) {
  const i = checkInvoice(order),
    values = {
      kundenavn: i.customer.name,
      fakturanummer: i.number.replace(/^#/, ''),
      ordrenummer: i.number,
      virksomhedsnavn: profile.issuer.name || company,
      butik: profile.storeName ?? (profile.issuer.name || company),
    };
  return {
    subject: fillTemplate(profile.invoiceSubject, values),
    text: fillTemplate(profile.invoiceBody, values),
  };
}
/** Company details, design and logo of a market's invoices: the same fields as Danmark's (as Danmark until changed). */
async function marketInvoiceSettings(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  marketId: string,
  action: string,
): Promise<Response> {
  const db = env.PLATFORM_DB,
    url = new URL(request.url),
    dk = await danishSettings(env, company);
  const saved = await marketRow(env, company, shop, marketId),
    profile = profileOf(dk, saved);
  if (action === 'settings' && request.method === 'GET')
    return reply({
      ...profile.issuer,
      design: profile.design,
      hasLogo: !!profile.logoKey,
      ownLogo: profile.ownLogo,
      revision: saved?.revision || 0,
    });
  if (action === 'logo' && request.method === 'GET') {
    if (!profile.logoKey) throw new HttpError(404, 'Intet logo gemt.');
    const file = await env.PLATFORM_DOCUMENTS.get(profile.logoKey);
    if (!file) throw new HttpError(404, 'Logo mangler.');
    return new Response(file.body, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  }
  if (actor.support)
    throw new HttpError(403, 'Afslut supportadgang før fakturaopsætning.');
  const row = saved ?? (await ensureMarketRow(env, company, shop, marketId));
  const save = async (set: string, values: unknown[], event: string) => {
    const result = await db.batch([
      db
        .prepare(
          `UPDATE webshop_markets SET ${set},revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND market_id=? AND revision=?`,
        )
        .bind(...values, company, shop, marketId, row.revision),
      audit(env, actor, company, event, marketId),
    ]);
    if (result[0].meta.changes !== 1)
      throw new HttpError(409, 'Fakturaindstillingerne er ændret. Genindlæs.');
    return reply({ ok: true });
  };
  if (action === 'settings') {
    if (request.method !== 'PUT') throw new HttpError(405, 'Brug Gem.');
    const b = await jsonBody(request, 12000);
    // Only the design fields change here; the tab's mail text and switch have their own version check (markets.ts).
    const v = {
      name: text(b.name, 120),
      address: text(b.address, 180),
      cvr: text(b.cvr, 30),
      contact: text(b.contact, 100),
    };
    if (/[\r\n]/.test(v.name + v.address + v.cvr + v.contact))
      throw new HttpError(400, 'Kontrollér fakturaoplysningerne.');
    return save(
      'issuer_json=?,design_json=?',
      [
        JSON.stringify(v),
        JSON.stringify(invoiceDesign(b.design ?? profile.design)),
      ],
      'invoice.market.settings.saved',
    );
  }
  // '' is "no logo"; ?inherit=1 goes back to Danmark's logo.
  if (request.method === 'DELETE')
    return save(
      'logo_key=?',
      [url.searchParams.get('inherit') === '1' ? null : ''],
      'invoice.market.logo.removed',
    );
  if (
    request.method !== 'PUT' ||
    request.headers.get('origin') !== url.origin ||
    request.headers.get('content-type') !== 'image/png'
  )
    throw new HttpError(403, 'Upload et PNG-logo fra fakturaindstillingerne.');
  const key = await storeLogo(env, company, await request.arrayBuffer());
  return save('logo_key=?', [key], 'invoice.market.logo.saved');
}
async function storeLogo(
  env: PlatformEnv,
  company: string,
  bytes: ArrayBuffer,
) {
  if (
    bytes.byteLength > 300000 ||
    bytes.byteLength < 24 ||
    Array.from(new Uint8Array(bytes).slice(0, 8)).join(',') !==
      '137,80,78,71,13,10,26,10'
  )
    throw new HttpError(400, 'Logoet skal være en PNG-fil på højst 300 KB.');
  const view = new DataView(bytes);
  if (
    view.getUint32(16) < 1 ||
    view.getUint32(20) < 1 ||
    view.getUint32(16) > 2048 ||
    view.getUint32(20) > 2048
  )
    throw new HttpError(400, 'Logoet må højst være 2048 × 2048 pixels.');
  try {
    const document = await PDFDocument.create();
    await document.embedPng(bytes);
  } catch {
    throw new HttpError(400, 'Filen er ikke et gyldigt PNG-billede.');
  }
  const key = `companies/${company}/invoice-logos/${crypto.randomUUID()}.png`;
  await env.PLATFORM_DOCUMENTS.put(key, bytes, {
    httpMetadata: { contentType: 'image/png' },
  });
  return key;
}
/** The order as invoiced: the original order when it was refunded later, in the customer's currency for another market. */
export function invoicedOrder(
  order: InvoiceSource,
  market: WebshopMarket | null,
) {
  const base = originalOrder(order) ?? order;
  if (!market) return base;
  const local = inPresentment(base),
    paid = local.currentTotalPriceSet?.shopMoney?.currencyCode;
  if (paid === market.currency) return local;
  // Charged in the shop's own currency (e.g. a Swedish order paid in DKK): the market's texts, the amounts as paid.
  if (paid && paid === base.currentTotalPriceSet?.shopMoney?.currencyCode)
    return base;
  throw new HttpError(
    409,
    `Ordren er ikke betalt i markedets valuta (${market.currency}). Den faktureres ikke automatisk.`,
  );
}
function audit(
  env: PlatformEnv,
  actor: Actor,
  company: string,
  action: string,
  id: string,
) {
  return env.PLATFORM_DB.prepare(
    'INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)',
  ).bind(
    crypto.randomUUID(),
    company,
    actor.support?.adminId || actor.id,
    action,
    id,
    JSON.stringify(
      actor.support
        ? {
            impersonatedUser: actor.id,
            supportSession: actor.support.sessionId,
          }
        : {},
    ),
  );
}
async function invoices(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  action = '',
): Promise<Response> {
  const url = new URL(request.url),
    db = env.PLATFORM_DB;
  await requireCompany(db, actor, company, request.method !== 'GET');
  const s = await settings(env, company);
  s.months = (await historyPolicy(env, company)).months;
  if (action === 'test-latest' && request.method === 'POST') {
    if (actor.support)
      throw new HttpError(403, 'Afslut supportadgang før testmail.');
    const b = await jsonBody(request);
    const latest = await db
      .prepare(
        "SELECT i.webshop_id,i.external_id FROM platform_invoices i JOIN webshops w ON w.company_id=i.company_id AND w.id=i.webshop_id WHERE i.company_id=? AND i.status='generated' AND w.status='active' ORDER BY i.created_at DESC,i.id DESC LIMIT 1",
      )
      .bind(company)
      .first<{ webshop_id: string; external_id: string }>();
    if (!latest)
      throw new HttpError(409, 'Generér først en PDF under Fakturaer.');
    return handleInvoices(
      new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({
          requestId: b.requestId,
          mode: b.mode,
          webshopId: latest.webshop_id,
          externalId: latest.external_id,
        }),
      }),
      env,
      actor,
      company,
      'test',
    );
  }

  // Another market's tab: the same company details, design and logo settings, stored for that market.
  const marketId = url.searchParams.get('marketId');
  if (marketId && (action === 'settings' || action === 'logo')) {
    const shop = String(url.searchParams.get('webshopId') || '');
    await requireWebshop(db, actor, company, shop);
    if (!/^gid:\/\/shopify\/Market\/\d{1,30}$/.test(marketId))
      throw new HttpError(400, 'Vælg et marked.');
    return marketInvoiceSettings(
      request,
      env,
      actor,
      company,
      shop,
      marketId,
      action,
    );
  }
  if (
    (action === 'preview' && request.method === 'GET') ||
    (action === 'example-test' && request.method === 'POST')
  ) {
    const input = action === 'example-test' ? await jsonBody(request) : {};
    if (action === 'example-test' && actor.support)
      throw new HttpError(403, 'Afslut supportadgang før testmail.');
    const shop = asText(
      input.webshopId || url.searchParams.get('webshopId') || '',
    );
    await requireWebshop(db, actor, company, shop);
    const webshop = await db
      .prepare('SELECT name FROM webshops WHERE company_id=? AND id=?')
      .bind(company, shop)
      .first<{ name: string }>();
    // A market's example uses its own settings (as Danmark where it has none), with the amounts in its currency.
    const exampleMarket = asText(input.marketId || marketId || '') || null;
    const market = exampleMarket
      ? await marketRow(env, company, shop, exampleMarket)
      : null;
    const profile = profileOf(await danishSettings(env, company), market);
    let logo: ArrayBuffer | undefined;
    if (profile.logoKey) {
      const f = await env.PLATFORM_DOCUMENTS.get(profile.logoKey);
      if (!f) throw new HttpError(409, 'Logoet mangler. Upload det igen.');
      logo = await f.arrayBuffer();
    }
    const example = market
      ? JSON.parse(
          JSON.stringify(exampleInvoice()).replaceAll(
            '"currencyCode":"DKK"',
            '"currencyCode":"' + market.currency + '"',
          ),
        )
      : exampleInvoice();
    const bytes = await buildInvoicePdf(
      example,
      {
        ...profile.issuer,
        address: profile.issuer.address || 'Eksempelvej 1, 1000 København',
        cvr: profile.issuer.cvr || '00000000',
        contact: profile.issuer.contact || 'faktura@example.dk',
        webshopName: market?.store_name ?? webshop!.name,
        design: profile.design,
        example: true,
        ...(market
          ? { locale: market.locale, soldVia: market.store_name }
          : {}),
      },
      logo,
    );
    if (action === 'example-test') {
      const scope = market ? { shop, market: market.market_id } : undefined;
      const sender = scope
        ? await db
            .prepare(
              'SELECT custom_from FROM market_mail WHERE company_id=? AND webshop_id=? AND market_id=?',
            )
            .bind(company, shop, scope.market)
            .first<{ custom_from: string }>()
        : await db
            .prepare('SELECT custom_from FROM company_mail WHERE company_id=?')
            .bind(company)
            .first<{ custom_from: string }>();
      const rendered = profileText(profile, s.name, exampleInvoice());
      const mailRequest = new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({
          recipient: input.recipient,
          requestId: input.requestId,
          mode: sender?.custom_from ? 'custom' : 'standard',
        }),
      });
      return handleMail(
        mailRequest,
        env,
        actor,
        company,
        'test',
        {
          subject: '[TEST · DEMO] ' + rendered.subject,
          text:
            rendered.text +
            '\n\nDEMO – Eksempelfaktura med fiktive data. Ingen rigtig ordre, faktura eller bogføring er oprettet.',
          allowAnyRecipient: true,
          attachment: {
            content: bytes.slice().buffer as ArrayBuffer,
            filename: 'eksempelfaktura.pdf',
            type: 'application/pdf',
            disposition: 'attachment',
          },
        },
        scope,
      );
    }
    return new Response(bytes.slice().buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="eksempelfaktura.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  }
  if (action === 'settings') {
    if (request.method === 'GET')
      return reply({
        ...s,
        logo_key: undefined,
        design_json: undefined,
        design: invoiceDesign(JSON.parse(s.design_json || '{}')),
        revision: s.revision || 0,
        hasLogo: !!s.logo_key,
      });
    if (actor.support)
      throw new HttpError(403, 'Afslut supportadgang før fakturaopsætning.');
    const b = await jsonBody(request, 12000);
    if (request.method !== 'PUT') throw new HttpError(405, 'Brug Gem.');
    const v = {
      name: text(b.name, 120),
      address: text(b.address, 180),
      cvr: text(b.cvr, 30),
      contact: text(b.contact, 100),
      subject: text(b.subject, 200),
      body: text(b.body, 4000),
      months: Number(b.months),
    };
    if (
      /[\r\n]/.test(v.name + v.address + v.cvr + v.contact + v.subject) ||
      !Number.isInteger(v.months) ||
      v.months < 1 ||
      v.months > 120
    )
      throw new HttpError(400, 'Kontrollér fakturaoplysninger og historik.');
    const design = invoiceDesign(b.design ?? JSON.parse(s.design_json || '{}'));
    if (b.revision !== undefined && b.revision !== (s.revision || 0))
      throw new HttpError(409, 'Fakturaindstillingerne er ændret. Genindlæs.');
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO invoice_settings(company_id,name,address,cvr,contact,subject,body,months,design_json) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET name=excluded.name,address=excluded.address,cvr=excluded.cvr,contact=excluded.contact,subject=excluded.subject,body=excluded.body,months=excluded.months,design_json=excluded.design_json,revision=invoice_settings.revision+1 WHERE invoice_settings.revision=?`,
        )
        .bind(
          company,
          v.name,
          v.address,
          v.cvr,
          v.contact,
          v.subject,
          v.body,
          v.months,
          JSON.stringify(design),
          s.revision || 0,
        ),
      audit(env, actor, company, 'invoice.settings.saved', company),
    ]);
    if (result[0].meta.changes !== 1)
      throw new HttpError(409, 'Fakturaindstillingerne er ændret. Genindlæs.');
    return reply({ ok: true });
  }
  if (action === 'logo') {
    if (request.method === 'GET') {
      if (!s.logo_key) throw new HttpError(404, 'Intet logo gemt.');
      const file = await env.PLATFORM_DOCUMENTS.get(s.logo_key);
      if (!file) throw new HttpError(404, 'Logo mangler.');
      return new Response(file.body, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
      });
    }
    if (request.method === 'DELETE' && !actor.support) {
      await db.batch([
        db
          .prepare(
            'UPDATE invoice_settings SET logo_key=NULL,revision=revision+1 WHERE company_id=?',
          )
          .bind(company),
        audit(env, actor, company, 'invoice.logo.removed', company),
      ]);
      return reply({ ok: true });
    }
    if (
      request.method !== 'PUT' ||
      actor.support ||
      request.headers.get('origin') !== url.origin ||
      request.headers.get('content-type') !== 'image/png'
    )
      throw new HttpError(
        403,
        'Upload et PNG-logo fra fakturaindstillingerne.',
      );
    const bytes = await request.arrayBuffer();
    if (
      bytes.byteLength > 300000 ||
      bytes.byteLength < 24 ||
      Array.from(new Uint8Array(bytes).slice(0, 8)).join(',') !==
        '137,80,78,71,13,10,26,10'
    )
      throw new HttpError(400, 'Logoet skal være en PNG-fil på højst 300 KB.');
    const view = new DataView(bytes);
    if (
      view.getUint32(16) < 1 ||
      view.getUint32(20) < 1 ||
      view.getUint32(16) > 2048 ||
      view.getUint32(20) > 2048
    )
      throw new HttpError(400, 'Logoet må højst være 2048 × 2048 pixels.');
    try {
      const document = await PDFDocument.create();
      await document.embedPng(bytes);
    } catch {
      throw new HttpError(400, 'Filen er ikke et gyldigt PNG-billede.');
    }
    const key = `companies/${company}/invoice-logos/${crypto.randomUUID()}.png`;
    await env.PLATFORM_DOCUMENTS.put(key, bytes, {
      httpMetadata: { contentType: 'image/png' },
    });
    await db.batch([
      db
        .prepare(
          'INSERT INTO invoice_settings(company_id,name,address,cvr,contact,subject,body,months,logo_key) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET logo_key=excluded.logo_key,revision=invoice_settings.revision+1',
        )
        .bind(
          company,
          s.name,
          s.address,
          s.cvr,
          s.contact,
          s.subject,
          s.body,
          s.months,
          key,
        ),
      audit(env, actor, company, 'invoice.logo.saved', company),
    ]);
    return reply({ ok: true });
  }
  if (request.method === 'GET' && !action) {
    const offset = Number(url.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new HttpError(400, 'Ugyldigt sidetal.');
    const rows = await db
      .prepare(
        `SELECT o.webshop_id,o.external_id,o.name,o.created_at,w.name webshop_name,i.id invoice_id,i.status FROM invoice_orders o JOIN webshops w ON w.company_id=o.company_id AND w.id=o.webshop_id LEFT JOIN platform_invoices i ON i.company_id=o.company_id AND i.webshop_id=o.webshop_id AND i.external_id=o.external_id WHERE o.company_id=? AND o.created_at>=? AND (?=1 OR (w.status='active' AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=o.company_id AND m.user_id=? AND (m.role='admin' OR EXISTS(SELECT 1 FROM webshop_memberships wm WHERE wm.company_id=o.company_id AND wm.webshop_id=o.webshop_id AND wm.user_id=m.user_id))))) ORDER BY o.created_at DESC,o.webshop_id,o.external_id LIMIT 101 OFFSET ?`,
      )
      .bind(company, cutoff(s), actor.platformAdmin ? 1 : 0, actor.id, offset)
      .all();
    return reply({
      orders: rows.results.slice(0, 100),
      hasMore: rows.results.length > 100,
      offset,
      ready: !!(s.address && s.cvr && s.contact),
      months: s.months,
    });
  }
  const input =
    request.method === 'GET'
      ? Object.fromEntries(url.searchParams)
      : await jsonBody(request);
  const shop = typeof input.webshopId === 'string' ? input.webshopId : '';
  await requireWebshop(db, actor, company, shop);
  if (actor.support && ['sync', 'generate', 'test', 'send'].includes(action))
    throw new HttpError(
      403,
      'Afslut supportadgang før import, generering eller testmail.',
    );
  if (action === 'sync' && request.method === 'POST') {
    const after = typeof input.after === 'string' ? input.after : null;
    if (after && after.length > 2048)
      throw new HttpError(400, 'Ugyldig fortsættelse.');
    const access = await shopAccess(env, company, shop),
      data = await listInvoiceOrders(access, after, cutoff(s));
    const statements = data.nodes.map((o) => {
      if (
        !/^gid:\/\/shopify\/Order\/\d+$/.test(o.id) ||
        !o.name ||
        !Number.isFinite(Date.parse(o.createdAt))
      )
        throw new HttpError(503, 'Shopify returnerede en ugyldig ordre.');
      return db
        .prepare(
          `INSERT INTO invoice_orders(company_id,webshop_id,external_id,name,created_at,payload_json) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,webshop_id,external_id) DO UPDATE SET name=excluded.name,created_at=excluded.created_at,payload_json=excluded.payload_json`,
        )
        .bind(company, shop, o.id, o.name, o.createdAt, JSON.stringify(o));
    });
    if (statements.length)
      await db.batch([
        ...statements,
        audit(env, actor, company, 'invoice.orders.imported', shop),
      ]);
    return reply({ count: data.nodes.length, ...data.pageInfo });
  }
  const id = typeof input.externalId === 'string' ? input.externalId : '';
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(id))
    throw new HttpError(400, 'Vælg en gyldig ordre.');
  const saved = await db
    .prepare(
      'SELECT * FROM platform_invoices WHERE company_id=? AND webshop_id=? AND external_id=?',
    )
    .bind(company, shop, id)
    .first<{
      id: string;
      status: string;
      fingerprint: string;
      r2_key: string;
      source_json: string;
      issuer_json: string;
    }>();
  if (action === 'pdf' && request.method === 'GET') {
    if (saved?.status !== 'generated')
      throw new HttpError(404, 'PDF findes ikke.');
    const object = await env.PLATFORM_DOCUMENTS.get(saved.r2_key);
    if (!object)
      throw new HttpError(
        404,
        'Den gemte PDF mangler. Den genoprettes ikke automatisk.',
      );
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          'attachment; filename="faktura-' + id.split('/').pop() + '.pdf"',
      },
    });
  }
  if (
    !['generate', 'check', 'test', 'send'].includes(action) ||
    request.method !== 'POST'
  )
    throw new HttpError(404, 'Fakturafunktionen findes ikke.');
  const source = await db
    .prepare(
      'SELECT external_id FROM invoice_orders WHERE company_id=? AND webshop_id=? AND external_id=? AND created_at>=?',
    )
    .bind(company, shop, id, cutoff(s))
    .first();
  if (!source)
    throw new HttpError(
      404,
      'Hent ordren fra Shopify først; den skal ligge inden for din historik.',
    );
  if (await isForeignOrder(db, company, shop, id))
    throw new HttpError(409, foreignHold);
  const order = await loadCompleteOrder(
    id,
    await shopAccess(env, company, shop),
    checkInvoice,
  );
  if (order.createdAt < cutoff(s))
    throw new HttpError(409, 'Ordren ligger uden for historikken.');
  const checked = checkInvoice(order),
    fingerprint = await invoiceFingerprint(checked);
  if (action === 'check') return reply({ invoice: checked });
  if (saved && saved.fingerprint !== fingerprint)
    throw new HttpError(
      409,
      'Ordren er ændret siden faktureringen. Den eksisterende PDF bevares; afklar en rettelse eller kreditnota.',
    );
  if (action === 'generate') {
    if (saved) {
      if (saved.status !== 'generated')
        throw new HttpError(
          409,
          'Genereringen er i gang eller kræver kontrol. Den genstartes ikke automatisk.',
        );
      return reply({ id: saved.id, existing: true });
    }
    ready(s);
    let logo: ArrayBuffer | undefined;
    // Orders from another market: invoice with the market's settings (company details, design, logo), in its
    // language and currency, from its store (e.g. Sabeln.se). Danish orders use the company's settings as before.
    const market = await orderMarketSettings(db, company, shop, id);
    // In the market's language, product names too where the shop has translations (Shopify keeps Danish ones).
    const source =
      market && market.locale !== 'da'
        ? await withTranslatedLines(
            await shopAccess(env, company, shop),
            invoicedOrder(order, market),
            market.locale,
          )
        : invoicedOrder(order, market);
    const profile = market
      ? profileOf(
          await danishSettings(env, company),
          await marketRow(env, company, shop, market.market_id),
        )
      : null;
    const logoKey = profile ? profile.logoKey : s.logo_key;
    if (logoKey) {
      const file = await env.PLATFORM_DOCUMENTS.get(logoKey);
      if (!file) throw new HttpError(409, 'Virksomhedens logo mangler.');
      logo = await file.arrayBuffer();
    }
    const webshop = await db
      .prepare('SELECT name FROM webshops WHERE company_id=? AND id=?')
      .bind(company, shop)
      .first<{ name: string }>();
    const issuer =
      profile && market
        ? {
            ...s,
            ...profile.issuer,
            logo_key: profile.logoKey,
            webshopName: market.store_name,
            design: profile.design,
            locale: market.locale,
            soldVia: market.store_name,
          }
        : {
            ...s,
            webshopName: webshop!.name,
            design: invoiceDesign(JSON.parse(s.design_json || '{}')),
          };
    const bytes = await buildInvoicePdf(source, issuer, logo),
      doc = crypto.randomUUID(),
      key = `companies/${company}/webshops/${shop}/invoices/${doc}.pdf`;
    const claim = await db
      .prepare(
        `INSERT INTO platform_invoices(company_id,webshop_id,external_id,id,fingerprint,status,r2_key,issuer_json,source_json) VALUES(?,?,?,?,?,'generating',?,?,?) ON CONFLICT DO NOTHING`,
      )
      .bind(
        company,
        shop,
        id,
        doc,
        fingerprint,
        key,
        JSON.stringify(issuer),
        JSON.stringify(source),
      )
      .run();
    if (!claim.meta.changes)
      throw new HttpError(
        409,
        'Fakturaen er allerede genereret eller under generering.',
      );
    await env.PLATFORM_DOCUMENTS.put(key, bytes, {
      httpMetadata: { contentType: 'application/pdf' },
    });
    await db.batch([
      db
        .prepare(
          "UPDATE platform_invoices SET status='generated' WHERE id=? AND status='generating'",
        )
        .bind(doc),
      audit(env, actor, company, 'invoice.generated', doc),
    ]);
    return reply({ id: doc });
  }
  if (saved?.status !== 'generated')
    throw new HttpError(409, 'Generér PDF-fakturaen først.');
  const file = await env.PLATFORM_DOCUMENTS.get(saved.r2_key);
  if (!file) throw new HttpError(409, 'PDF-fakturaen mangler.');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 3500000)
    throw new HttpError(413, 'PDF er for stor til testmail.');
  const market = await orderMarketSettings(db, company, shop, id);
  const rendered = market
    ? profileText(
        profileOf(
          await danishSettings(env, company),
          await marketRow(env, company, shop, market.market_id),
        ),
        s.name,
        order,
      )
    : invoiceText(s, order);
  if (action === 'send')
    return sendCustomerInvoice(
      env,
      actor,
      company,
      shop,
      saved.id,
      order.email || '',
      rendered.subject,
      rendered.text,
      {
        content: bytes,
        filename: 'faktura-' + id.split('/').pop() + '.pdf',
        type: 'application/pdf',
        disposition: 'attachment',
      },
      'invoice',
      market ? { shop, market: market.market_id } : undefined,
    );
  const mailRequest = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ requestId: input.requestId, mode: input.mode }),
  });
  return handleMail(mailRequest, env, actor, company, 'test', {
    subject: '[TEST] ' + rendered.subject,
    text:
      rendered.text +
      '\n\nTESTMAIL – sendt til din loginadresse, ikke til kunden.',
    attachment: {
      content: bytes,
      filename: 'faktura-' + id.split('/').pop() + '.pdf',
      type: 'application/pdf',
      disposition: 'attachment',
    },
  });
}

export async function handleInvoices(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  action = '',
): Promise<Response> {
  const copy = request.clone();
  try {
    return await invoices(request, env, actor, company, action);
  } catch (error) {
    if (
      request.method === 'POST' &&
      ['check', 'generate', 'send'].includes(action)
    )
      try {
        const body = (await copy.json()) as any;
        await requireWebshop(env.PLATFORM_DB, actor, company, body.webshopId);
        await recordFailure(
          env,
          company,
          body.webshopId,
          'shopify',
          'orders',
          body.externalId,
          'Faktura: ' + action,
          error,
        );
      } catch {
        /* Preserve the original failure and any durable write claim. */
      }
    throw error;
  }
}
