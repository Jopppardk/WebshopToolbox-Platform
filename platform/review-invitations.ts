// Tools → Anmeldelser: the webshop's own Trustpilot invitation mails, replacing Trustpilot's automatic invitations.
// One template per language (Danish for Danish customers, Swedish for Swedish ones), edited in the portal and
// rendered by tier1/src/lib/review-mail.ts. The scheduled run (production-jobs.ts) mails each order once, a set
// number of days after it was shipped, and only orders shipped after the invitations were switched on.
// Rules: an order is claimed before it is mailed and never mailed twice; an uncertain send stays uncertain and is
// not repeated; test mails use the saved template with sample data; images are served publicly by a random id.
import { requireCompany, requireWebshop } from './auth';
import { jsonBody } from './invitations';
import {
  currentSender,
  deliverMail,
  domainOf,
  mailAddress,
  type MailScope,
} from './mail';
import { orderMarketSettings, type WebshopMarket } from './order-markets';
import { orderQuery, shopAccess, type Access } from './invoice-source';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';
import {
  defaultSettings,
  localeNames,
  normalizeSettings,
  renderReviewMail,
  reviewLocales,
  ReviewTemplateError,
  sampleVars,
  type ReviewLocale,
  type ReviewSettings,
  type ReviewTemplate,
} from './tier1/src/lib/review-mail';

type SettingsRow = {
  enabled: number;
  start_at: string | null;
  templates_json: string;
  revision: number;
};
const day = 86400000,
  sendsPerRun = 10,
  queueLimit = 1000,
  maxImageBytes = 2_000_000,
  maxImages = 300;
const imageTypes: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) =>
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  'image/webp': (b) =>
    String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
};

async function webshop(env: PlatformEnv, company: string, shop: string) {
  const row = await env.PLATFORM_DB.prepare(
    'SELECT name,domain FROM webshops WHERE company_id=? AND id=?',
  )
    .bind(company, shop)
    .first<{ name: string; domain: string }>();
  if (!row) throw new HttpError(404, 'Webshoppen findes ikke.');
  return row;
}
async function savedRow(env: PlatformEnv, company: string, shop: string) {
  return env.PLATFORM_DB.prepare(
    'SELECT enabled,start_at,templates_json,revision FROM review_invitation_settings WHERE company_id=? AND webshop_id=?',
  )
    .bind(company, shop)
    .first<SettingsRow>();
}
function settingsOf(row: SettingsRow | null, domain: string): ReviewSettings {
  if (!row) return defaultSettings(domain);
  return {
    enabled: row.enabled === 1,
    templates: JSON.parse(row.templates_json),
  };
}
/** The enabled market whose invoices are in this language (e.g. Sverige on sabeln.se), if the webshop has one. */
async function localeMarket(
  env: PlatformEnv,
  company: string,
  shop: string,
  locale: ReviewLocale,
) {
  if (locale === 'da') return null;
  return env.PLATFORM_DB.prepare(
    'SELECT market_id,store_name FROM webshop_markets WHERE company_id=? AND webshop_id=? AND enabled=1 AND locale=? ORDER BY name LIMIT 1',
  )
    .bind(company, shop, locale)
    .first<{ market_id: string; store_name: string }>();
}
// A language's mails go out from the sender of its market (Indstillinger → Faktura-afsendelse), like its invoices.
const scopeOf = (
  shop: string,
  market: { market_id: string } | null,
): MailScope => (market ? { shop, market: market.market_id } : { shop });
function audit(
  env: PlatformEnv,
  actor: Actor,
  company: string,
  action: string,
  resource: string,
  details: Record<string, unknown> = {},
) {
  return env.PLATFORM_DB.prepare(
    'INSERT INTO audit_events(id,company_id,actor_id,action,resource_id,details_json) VALUES(?,?,?,?,?,?)',
  ).bind(
    crypto.randomUUID(),
    company,
    actor.id,
    action,
    resource,
    JSON.stringify(details),
  );
}
/** The language's own sender address and name, when chosen on the page. */
const overrideOf = (t: ReviewTemplate) => ({
  ...(t.fromAddress ? { from: t.fromAddress } : {}),
  ...(t.fromName ? { name: t.fromName } : {}),
});
/** Why a chosen sender address cannot be used: its domain must be approved for sending (see currentSender). */
function senderProblem(t: ReviewTemplate, domains: string[]) {
  if (!t.fromAddress || domains.includes(domainOf(t.fromAddress))) return null;
  return `Domænet ${domainOf(t.fromAddress)} er ikke godkendt til afsendelse. Forbind Cloudflare E-mail under Integrationer og godkend domænet først${domains.length ? ` (godkendte domæner: ${domains.join(', ')})` : ''}.`;
}
/** Whether real invitations are mailed from this deployment (production with customer mail switched on). */
const customerMail = (env: PlatformEnv) =>
  env.PLATFORM_ENV === 'production' &&
  String(env.PLATFORM_CUSTOMER_EMAIL) === 'enabled';

async function info(
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
) {
  const db = env.PLATFORM_DB,
    w = await webshop(env, company, shop),
    row = await savedRow(env, company, shop);
  const senders: Record<
    string,
    { from: string; name: string; domains: string[]; store: string }
  > = {};
  for (const locale of reviewLocales) {
    const market = await localeMarket(env, company, shop, locale);
    senders[locale] = {
      ...(await currentSender(env, company, scopeOf(shop, market))),
      store: market?.store_name || w.name,
    };
  }
  const log = (
    await db
      .prepare(
        'SELECT external_id,order_name,locale,recipient,sender,status,reason,created_at,sent_at FROM review_invitations WHERE company_id=? AND webshop_id=? ORDER BY created_at DESC,order_name DESC LIMIT 50',
      )
      .bind(company, shop)
      .all<Record<string, string | null>>()
  ).results.map((r) => ({
    orderId: r.external_id,
    orderName: r.order_name,
    locale: r.locale,
    recipient: r.recipient,
    sender: r.sender,
    status: r.status,
    reason: r.reason,
    createdAt: r.created_at,
    sentAt: r.sent_at,
  }));
  const counts = await db
    .prepare(
      "SELECT COALESCE(SUM(status='sent'),0) sent,COALESCE(SUM(status='sent' AND sent_at>=datetime('now','-30 days')),0) recent,COALESCE(SUM(status IN ('uncertain','sending')),0) uncertain FROM review_invitations WHERE company_id=? AND webshop_id=?",
    )
    .bind(company, shop)
    .first<{ sent: number; recent: number; uncertain: number }>();
  const settings = settingsOf(row, w.domain);
  return {
    settings,
    revision: row?.revision ?? 0,
    startAt: row?.enabled ? row.start_at : null,
    store: w.name,
    domain: w.domain,
    senders,
    counts: {
      ...(counts || { sent: 0, recent: 0, uncertain: 0 }),
      ...(await invitationQueue(env, company, shop, row, settings)),
    },
    log,
    testRecipient: actor.email,
    customerMail: customerMail(env),
    localPreview: env.PLATFORM_ENV === 'local-test',
  };
}

async function save(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
) {
  const db = env.PLATFORM_DB,
    body = await jsonBody(request, 200000);
  let settings: ReviewSettings;
  try {
    settings = normalizeSettings(body.settings);
  } catch (error) {
    if (error instanceof ReviewTemplateError)
      throw new HttpError(400, error.message);
    throw error;
  }
  // A chosen sender address must be on the verified domain of the language's own sender (checked again when sending).
  for (const locale of reviewLocales) {
    const market = await localeMarket(env, company, shop, locale),
      sender = await currentSender(env, company, scopeOf(shop, market)),
      problem = senderProblem(settings.templates[locale], sender.domains);
    if (problem) throw new HttpError(400, problem);
  }
  const revision = Number(body.revision),
    row = await savedRow(env, company, shop);
  if ((row?.revision ?? 0) !== revision)
    throw new HttpError(
      409,
      'Invitationerne er ændret i en anden fane. Genindlæs siden.',
    );
  // Switching on starts from now: orders shipped before (or while switched off) are never invited afterwards.
  const startAt = settings.enabled
    ? row?.enabled && row.start_at
      ? row.start_at
      : new Date().toISOString()
    : row?.start_at || null;
  const json = JSON.stringify(settings.templates);
  const write = row
    ? db
        .prepare(
          'UPDATE review_invitation_settings SET enabled=?,start_at=?,templates_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND revision=?',
        )
        .bind(settings.enabled ? 1 : 0, startAt, json, company, shop, revision)
    : db
        .prepare(
          'INSERT INTO review_invitation_settings(company_id,webshop_id,enabled,start_at,templates_json) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING',
        )
        .bind(company, shop, settings.enabled ? 1 : 0, startAt, json);
  const result = await db.batch([
    write,
    audit(env, actor, company, 'reviews.settings.saved', shop, {
      enabled: settings.enabled,
      languages: reviewLocales.filter((l) => settings.templates[l].enabled),
    }),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError(
      409,
      'Invitationerne er ændret i en anden fane. Genindlæs siden.',
    );
  return reply(await info(env, actor, company, shop));
}

async function testMail(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
) {
  const db = env.PLATFORM_DB,
    input = await jsonBody(request);
  const locale = input.locale as ReviewLocale;
  if (!reviewLocales.includes(locale))
    throw new HttpError(400, 'Vælg sproget til testmailen.');
  const id = typeof input.requestId === 'string' ? input.requestId : '';
  if (!/^[a-f0-9-]{36}$/.test(id))
    throw new HttpError(400, 'Testmail mangler et gyldigt forespørgsels-ID.');
  const recipient = mailAddress(input.recipient || actor.email),
    local = env.PLATFORM_ENV === 'local-test';
  const previous = await db
    .prepare(
      'SELECT actor_id,status,recipient,sender FROM mail_test_deliveries WHERE company_id=? AND request_id=?',
    )
    .bind(company, id)
    .first<{
      actor_id: string;
      status: string;
      recipient: string;
      sender: string;
    }>();
  if (previous) {
    if (previous.actor_id !== actor.id)
      throw new HttpError(409, 'Testmailen tilhører en anden session.');
    return reply(previous);
  }
  // The test shows the saved template with sample data; what is sent is never taken from the request.
  const w = await webshop(env, company, shop),
    settings = settingsOf(await savedRow(env, company, shop), w.domain),
    market = await localeMarket(env, company, shop, locale),
    scope = scopeOf(shop, market),
    mail = renderReviewMail(
      settings.templates[locale],
      sampleVars(market?.store_name || w.name),
      locale,
    ),
    template = settings.templates[locale],
    current = await currentSender(env, company, scope),
    problem = senderProblem(template, current.domains);
  if (problem) throw new HttpError(409, problem);
  const sender = { from: template.fromAddress || current.from };
  const message = {
    to: recipient,
    subject: '[TEST] ' + mail.subject,
    html: mail.html,
    text:
      mail.text +
      `\n\nTESTMAIL (${localeNames[locale].toLowerCase()}) med eksempeldata, sendt fra WebshopToolbox.`,
  };
  const now = Math.floor(Date.now() / 1000);
  // The same durable claim and company-wide one-minute cooldown as the other test mails (mail.ts).
  const claim = await db
    .prepare(
      `INSERT INTO mail_test_deliveries(company_id,request_id,actor_id,recipient,sender,mode,status,created_at)
  SELECT ?,?,?,?,?,?,'uncertain',? WHERE NOT EXISTS(SELECT 1 FROM mail_test_deliveries WHERE company_id=? AND created_at>?) ON CONFLICT DO NOTHING`,
    )
    .bind(
      company,
      id,
      actor.id,
      recipient,
      sender.from,
      sender.from === (env.PLATFORM_MAIL_FROM || 'faktura@webshoptoolbox.dk')
        ? 'standard'
        : 'custom',
      now,
      company,
      now - 60,
    )
    .run();
  if (claim.meta.changes !== 1)
    throw new HttpError(
      429,
      'Vent mindst ét minut mellem testmails. Et uafklaret forsøg genafsendes ikke automatisk.',
    );
  if (local) {
    await db
      .prepare(
        "UPDATE mail_test_deliveries SET status='preview' WHERE company_id=? AND request_id=?",
      )
      .bind(company, id)
      .run();
    return reply({
      status: 'preview',
      recipient,
      sender: sender.from,
      preview: {
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
    });
  }
  try {
    const sent = await deliverMail(
      env,
      company,
      scope,
      message,
      overrideOf(template),
    );
    await db.batch([
      db
        .prepare(
          "UPDATE mail_test_deliveries SET status='accepted',receipt=? WHERE company_id=? AND request_id=?",
        )
        .bind(sent.receipt, company, id),
      audit(env, actor, company, 'reviews.test.accepted', shop, {
        requestId: id,
        locale,
        recipient,
      }),
    ]);
    return reply({ status: 'accepted', recipient, sender: sent.from });
  } catch {
    return reply({ status: 'uncertain', recipient, sender: sender.from });
  }
}

async function uploadImage(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
) {
  const url = new URL(request.url),
    type = request.headers.get('content-type') || '';
  if (request.headers.get('origin') !== url.origin)
    throw new HttpError(403, 'Upload billedet fra portalen.');
  if (!imageTypes[type])
    throw new HttpError(415, 'Vælg et billede i PNG, JPG, GIF eller WebP.');
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxImageBytes)
    throw new HttpError(413, 'Billedet må højst fylde 2 MB.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > maxImageBytes)
    throw new HttpError(413, 'Billedet må højst fylde 2 MB.');
  if (!imageTypes[type](bytes))
    throw new HttpError(415, 'Filen er ikke et gyldigt billede.');
  const db = env.PLATFORM_DB;
  const count = await db
    .prepare(
      'SELECT COUNT(*) n FROM review_mail_images WHERE company_id=? AND webshop_id=?',
    )
    .bind(company, shop)
    .first<{ n: number }>();
  if ((count?.n || 0) >= maxImages)
    throw new HttpError(409, 'Webshoppen har nået grænsen for billeder.');
  const id = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    key = `companies/${company}/webshops/${shop}/mail-images/${id}`;
  await env.PLATFORM_DOCUMENTS.put(key, bytes, {
    httpMetadata: { contentType: type },
  });
  await db.batch([
    db
      .prepare(
        'INSERT INTO review_mail_images(id,company_id,webshop_id,r2_key,content_type,bytes) VALUES(?,?,?,?,?,?)',
      )
      .bind(id, company, shop, key, type, bytes.length),
    audit(env, actor, company, 'reviews.image.uploaded', shop, { id }),
  ]);
  return reply({ url: `${url.origin}/mail-images/${id}` }, 201);
}

export async function handleReviews(
  request: Request,
  env: PlatformEnv,
  actor: Actor,
  company: string,
  shop: string,
  path: string,
) {
  if (shop === 'none')
    throw new HttpError(409, 'Forbind en webshop under Integrationer først.');
  const db = env.PLATFORM_DB,
    write = request.method !== 'GET';
  await requireCompany(db, actor, company, write);
  await requireWebshop(db, actor, company, shop);
  if (write && actor.support)
    throw new HttpError(403, 'Afslut supportadgang før ændringer.');
  if (path === '/reviews' && request.method === 'GET')
    return reply(await info(env, actor, company, shop));
  if (path === '/reviews' && request.method === 'PUT')
    return save(request, env, actor, company, shop);
  if (path === '/reviews/test' && request.method === 'POST')
    return testMail(request, env, actor, company, shop);
  if (path === '/reviews/images' && request.method === 'POST')
    return uploadImage(request, env, actor, company, shop);
  throw new HttpError(404, 'Funktionen findes ikke.');
}

/** GET /mail-images/{id}: an image in an invitation mail, for any mail client, without login. */
export async function publicMailImage(request: Request, env: PlatformEnv) {
  const m = new URL(request.url).pathname.match(
    /^\/mail-images\/([a-f0-9]{32})(?:\.(?:png|jpe?g|gif|webp))?$/,
  );
  if (!m || !['GET', 'HEAD'].includes(request.method))
    throw new HttpError(404, 'Billedet findes ikke.');
  const row = await env.PLATFORM_DB.prepare(
    'SELECT r2_key,content_type FROM review_mail_images WHERE id=?',
  )
    .bind(m[1])
    .first<{ r2_key: string; content_type: string }>();
  const file = row && (await env.PLATFORM_DOCUMENTS.get(row.r2_key));
  if (!row || !file) throw new HttpError(404, 'Billedet findes ikke.');
  return new Response(request.method === 'HEAD' ? null : file.body, {
    headers: {
      'Content-Type': row.content_type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}

/** Whether the scheduled run has invitations to consider for the webshop (switched on, here customer mail is on). */
export async function reviewInvitationsDue(
  env: PlatformEnv,
  company: string,
  shop: string,
) {
  if (!customerMail(env)) return false;
  const row = await savedRow(env, company, shop);
  return !!row?.enabled && !!row.start_at;
}

type Candidate = {
  external_id: string;
  payload_json: string;
  country: string | null;
  has_market: number;
  shipped_at: string;
};
type LiveOrder = {
  id: string;
  name: string;
  email: string | null;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  customer: { firstName: string | null } | null;
  shippingAddress: { firstName: string | null } | null;
  billingAddress: { firstName: string | null } | null;
};
const reviewOrderQuery =
  'query ReviewOrder($id:ID!){order(id:$id){id name email cancelledAt displayFulfillmentStatus customer{firstName} shippingAddress{firstName} billingAddress{firstName}}}';
/** The language an order's invitation is written in: the market's invoice language, else Swedish for Sweden, Danish at home. */
function localeOf(market: WebshopMarket | null, country: string | null) {
  if (market) return market.locale === 'en' ? null : market.locale;
  if (country === 'SE') return 'sv';
  if (!country || country === 'DK') return 'da';
  return null;
}

/**
 * Orders waiting for an invitation: shipped (last fulfilment) after the start and no later than `until`, not
 * cancelled, not a test, and not invited or skipped before. Orders are looked up by creation time first (index),
 * at most 120 days back.
 */
function pendingOrders(
  db: D1Database,
  company: string,
  shop: string,
  startAt: string,
  until: string,
  limit: number,
) {
  return db
    .prepare(
      `SELECT * FROM (SELECT s.external_id,s.payload_json,m.country,m.external_id IS NOT NULL has_market,
 (SELECT max(json_extract(f.value,'$.createdAt')) FROM json_each(s.payload_json,'$.fulfillments') f) shipped_at
 FROM operation_snapshots s LEFT JOIN order_markets m ON m.company_id=s.company_id AND m.webshop_id=s.webshop_id AND m.external_id=s.external_id
 WHERE s.company_id=? AND s.webshop_id=? AND s.module='orders' AND s.occurred_at>=?
 AND json_extract(s.payload_json,'$.displayFulfillmentStatus')='FULFILLED' AND json_extract(s.payload_json,'$.cancelledAt') IS NULL
 AND COALESCE(json_extract(s.payload_json,'$.test'),0)=0
 AND NOT EXISTS(SELECT 1 FROM review_invitations r WHERE r.company_id=s.company_id AND r.webshop_id=s.webshop_id AND r.external_id=s.external_id))
 WHERE shipped_at>=? AND shipped_at<=? ORDER BY shipped_at LIMIT ?`,
    )
    .bind(
      company,
      shop,
      new Date(Date.parse(startAt) - 120 * day).toISOString(),
      startAt,
      until,
      limit,
    )
    .all<Candidate>()
    .then((r) => r.results);
}
const refunded = (order: {
  displayFinancialStatus?: string;
  currentTotalPriceSet?: { shopMoney?: { amount?: string } };
}) =>
  order.displayFinancialStatus === 'REFUNDED' ||
  Number(order.currentTotalPriceSet?.shopMoney?.amount) === 0;

/**
 * The queue shown on the page: shipped orders that will get an invitation, and how many of them have waited their
 * language's delay (sent by the next runs). Orders that will be skipped (no language, language switched off,
 * refunded) are left out; the live check in Shopify happens only when sending.
 */
export async function invitationQueue(
  env: PlatformEnv,
  company: string,
  shop: string,
  row: SettingsRow | null,
  settings: ReviewSettings,
) {
  if (!row?.enabled || !row.start_at)
    return { queued: 0, ready: 0, queueCapped: false };
  const db = env.PLATFORM_DB,
    now = Date.now();
  const orders = await pendingOrders(
    db,
    company,
    shop,
    row.start_at,
    new Date(now).toISOString(),
    queueLimit + 1,
  );
  // More than the limit waiting (a long delay on a busy shop): the counts cover the oldest and say so.
  const queueCapped = orders.length > queueLimit;
  if (queueCapped) orders.length = queueLimit;
  let queued = 0,
    ready = 0;
  for (const c of orders) {
    if (refunded(JSON.parse(c.payload_json))) continue;
    // The language as the run finds it; a Danish order has no market. Before the market is known, the country.
    const locale =
      c.has_market && c.country && c.country !== 'DK'
        ? localeOf(
            await orderMarketSettings(db, company, shop, c.external_id),
            c.country,
          )
        : localeOf(null, c.country);
    if (!locale || !settings.templates[locale].enabled) continue;
    queued++;
    // Without a known market the run waits for it, so such an order is not ready yet.
    if (
      c.has_market &&
      Date.parse(c.shipped_at) + settings.templates[locale].delayDays * day <=
        now
    )
      ready++;
  }
  return { queued, ready, queueCapped };
}

/**
 * The scheduled step: mails the invitations that are due for one webshop, a few per run. `owns` throws when the
 * run lost its lease, so nothing is mailed after another run took over.
 */
export async function sendReviewInvitations(
  env: PlatformEnv,
  company: string,
  shop: string,
  owns: () => Promise<void>,
) {
  if (!customerMail(env)) return { sent: 0 };
  const db = env.PLATFORM_DB,
    row = await savedRow(env, company, shop);
  if (!row?.enabled || !row.start_at) return { sent: 0 };
  const w = await webshop(env, company, shop),
    settings = settingsOf(row, w.domain),
    now = Date.now(),
    enabled = reviewLocales.filter((l) => settings.templates[l].enabled),
    minDelay = Math.min(
      ...reviewLocales.map((l) => settings.templates[l].delayDays),
    );
  const candidates = await pendingOrders(
    db,
    company,
    shop,
    row.start_at,
    new Date(now - minDelay * day).toISOString(),
    200,
  );
  if (!candidates.length || !enabled.length) return { sent: 0 };
  const skip = (
    c: Candidate,
    name: string,
    locale: string | null,
    reason: string,
  ) =>
    db
      .prepare(
        "INSERT INTO review_invitations(company_id,webshop_id,external_id,order_name,locale,status,reason) VALUES(?,?,?,?,?,'skipped',?) ON CONFLICT DO NOTHING",
      )
      .bind(company, shop, c.external_id, name, locale, reason)
      .run();
  let access: Access | null = null,
    sent = 0,
    uncertain = 0,
    lookupFailed = 0,
    senderBlocked = '';
  for (const c of candidates) {
    if (sent + uncertain >= sendsPerRun) break;
    const order = JSON.parse(c.payload_json),
      name = String(order.name || c.external_id.split('/').pop());
    // The market is filled shortly after the order is imported; wait for it rather than guess the language.
    if (!c.has_market) continue;
    const market = await orderMarketSettings(db, company, shop, c.external_id),
      locale = localeOf(market, c.country);
    if (!locale) {
      await skip(
        c,
        name,
        null,
        `Ingen invitation på sproget for ${c.country}.`,
      );
      continue;
    }
    const template = settings.templates[locale];
    if (!template.enabled) {
      await skip(
        c,
        name,
        locale,
        `${localeNames[locale]}e invitationer var slået fra.`,
      );
      continue;
    }
    if (Date.parse(c.shipped_at) + template.delayDays * day > now) continue;
    // Fully refunded (with or without a cancellation): Shopify's status says so; partly refunded orders are invited.
    if (refunded(order)) {
      await skip(c, name, locale, 'Ordren er refunderet.');
      continue;
    }
    let live: LiveOrder | null;
    try {
      access ??= await shopAccess(env, company, shop);
      live = (
        await orderQuery<{ order: LiveOrder | null }>(
          access,
          reviewOrderQuery,
          {
            id: c.external_id,
          },
        )
      ).order;
    } catch {
      // Read-only and nothing claimed: the order is tried again in the next run.
      lookupFailed++;
      continue;
    }
    if (!live || live.id !== c.external_id) {
      await skip(c, name, locale, 'Ordren findes ikke længere i Shopify.');
      continue;
    }
    if (live.cancelledAt) {
      await skip(c, name, locale, 'Ordren er annulleret.');
      continue;
    }
    let recipient: string;
    try {
      recipient = mailAddress(live.email);
    } catch {
      await skip(c, name, locale, 'Ordren har ingen gyldig mailadresse.');
      continue;
    }
    const firstName = (
      live.customer?.firstName ||
      live.shippingAddress?.firstName ||
      live.billingAddress?.firstName ||
      ''
    )
      .trim()
      .slice(0, 60);
    const mail = renderReviewMail(
      template,
      {
        firstName,
        orderName: live.name || name,
        store: market?.store_name || w.name,
      },
      locale,
    );
    const scope = scopeOf(shop, market),
      domains = (await currentSender(env, company, scope)).domains;
    if (senderProblem(template, domains)) {
      // The chosen address lost its domain: the order waits (unclaimed) until the sender is fixed.
      senderBlocked = template.fromAddress;
      continue;
    }
    await owns();
    // Claimed before it is sent: a second run, or a repeat of this one, never mails the order again.
    const claim = await db
      .prepare(
        "INSERT INTO review_invitations(company_id,webshop_id,external_id,order_name,locale,recipient,status) VALUES(?,?,?,?,?,?,'sending') ON CONFLICT DO NOTHING",
      )
      .bind(company, shop, c.external_id, live.name || name, locale, recipient)
      .run();
    if (claim.meta.changes !== 1) continue;
    try {
      const result = await deliverMail(
        env,
        company,
        scope,
        { to: recipient, ...mail },
        overrideOf(template),
      );
      await db
        .prepare(
          "UPDATE review_invitations SET status='sent',sender=?,receipt=?,sent_at=CURRENT_TIMESTAMP WHERE company_id=? AND webshop_id=? AND external_id=? AND status='sending'",
        )
        .bind(result.from, result.receipt, company, shop, c.external_id)
        .run();
      sent++;
    } catch {
      await db
        .prepare(
          "UPDATE review_invitations SET status='uncertain',reason=? WHERE company_id=? AND webshop_id=? AND external_id=? AND status='sending'",
        )
        .bind(
          'Afsendelsen blev ikke bekræftet. Den sendes ikke igen automatisk.',
          company,
          shop,
          c.external_id,
        )
        .run();
      uncertain++;
    }
  }
  if (uncertain || lookupFailed || senderBlocked)
    throw new HttpError(
      409,
      [
        uncertain
          ? `${uncertain} Trustpilot-invitation${uncertain === 1 ? '' : 'er'} blev ikke bekræftet af mailtjenesten og sendes ikke igen automatisk.`
          : '',
        lookupFailed
          ? `${lookupFailed} ordre${lookupFailed === 1 ? '' : 'r'} kunne ikke hentes fra Shopify og prøves igen ved næste kørsel.`
          : '',
        senderBlocked
          ? `Afsenderadressen ${senderBlocked} er ikke længere på et godkendt domæne. Invitationerne venter, til afsenderen er rettet under Anmeldelser eller Faktura-afsendelse.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  return { sent };
}
