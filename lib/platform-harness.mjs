// Shared helpers for the platform test files (lib/platform-*.test.mjs): an in-memory platform with fixture
// companies, request helpers and fixtures. Tests live in the area files, not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as jose from 'jose';
import * as pdfLib from 'pdf-lib';
import { fixture } from './invoice-fixture.mjs';
import { loader } from './automation-test-fixture.mjs';
import { validateConfig } from '../scripts/platform-config.mjs';

// The platform's "today" is the Danish calendar day; between midnight and 01-02 Danish time it differs from the UTC day.
export const danishToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const root = new URL('../', import.meta.url),
  secret = 'synthetic-platform-secret-with-at-least-32-characters';
export const read = (file) => readFileSync(new URL(file, root), 'utf8');
export const walk = (dir) =>
  readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir + e.name + '/') : [dir + e.name],
  );
export async function token(subject = 'local-admin', options = {}) {
  return new jose.SignJWT(options.email ? { email: options.email } : {})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setIssuer(options.issuer || 'urn:webshop-toolbox:local-test')
    .setAudience(options.audience || 'platform-local')
    .setIssuedAt()
    .setExpirationTime(options.exp || '1h')
    .sign(new TextEncoder().encode(options.secret || secret));
}
export function harness(joseOverride = jose, network) {
  const sql = new DatabaseSync(':memory:');
  for (const migration of readdirSync(
    new URL('platform/migrations/', root),
  ).sort())
    sql.exec(read('platform/migrations/' + migration));
  sql.exec(read('platform/fixtures/seed.sql'));
  const db = {
    prepare(query) {
      const wrap = (args) => ({
        bind: (...values) => wrap(values),
        first: async () => sql.prepare(query).get(...args) || null,
        all: async () => ({ results: sql.prepare(query).all(...args) }),
        // Cloudflare D1 counts rows written by triggers in meta.changes; mirror that here.
        run: async () => {
          const total = () =>
              sql.prepare('SELECT total_changes() AS n').get().n,
            before = total();
          sql.prepare(query).run(...args);
          return { meta: { changes: total() - before } };
        },
      });
      return wrap([]);
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sql.exec('COMMIT');
        return out;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const worker = loader({
    jose: joseOverride,
    'pdf-lib': pdfLib,
    fetch: network,
  })('platform/worker.ts').default;
  const env = {
    PLATFORM_DB: db,
    PLATFORM_DOCUMENTS: {},
    ASSETS: { fetch: async () => new Response('ADMIN ASSET') },
    PLATFORM_ENV: 'local-test',
    PLATFORM_INVITATION_MODE: 'preview',
    PLATFORM_AUTH: 'local-jwt',
    PLATFORM_EXTERNAL_WRITES: 'blocked',
    PLATFORM_CUSTOMER_EMAIL: 'blocked',
    PLATFORM_LOCAL_SECRET: secret,
  };
  async function request(path, options = {}) {
    const origin = options.origin || 'http://127.0.0.1:8790';
    const headers = {
      ...(options.auth === false
        ? {}
        : {
            authorization:
              'Bearer ' + (options.token || (await token(options.user))),
          }),
      ...options.headers,
    };
    if (options.body) {
      headers['content-type'] = 'application/json';
      headers.origin = options.csrfOrigin || origin;
    }
    return worker.fetch(
      new Request(origin + path, {
        method: options.method || 'GET',
        headers,
        body:
          options.rawBody ??
          (options.body ? JSON.stringify(options.body) : undefined),
      }),
      { ...env, ...options.env },
    );
  }
  async function provision(path, options) {
    const response = await request(path, options);
    if (response.status !== 201) return response;
    const data = await response.clone().json();
    const accepted = await request('/api/platform/onboarding', {
      token: await token(options.body.subject, { email: options.body.email }),
      method: 'POST',
      body: {
        token: data.previewLink.split('invitation=')[1],
        name: 'Test User',
      },
    });
    assert.equal(accepted.status, 200, await accepted.text());
    return response;
  }
  return { sql, db, worker, env, request, provision, close: () => sql.close() };
}

export async function startSupport(
  h,
  userId = 'local-reader',
  companyId = 'company-a',
) {
  const response = await h.request('/api/platform/support', {
    method: 'POST',
    body: { userId, companyId, reason: 'Undersøg adgang' },
  });
  assert.equal(response.status, 201, await response.clone().text());
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const me = await (
    await h.request('/api/platform/me', { headers: { cookie } })
  ).json();
  return {
    cookie,
    'x-platform-actor': me.user.id + ':' + me.user.support.sessionId,
  };
}

export function mailFixture(network) {
  const h = harness(),
    handle = loader({ jose, fetch: network })('platform/mail.ts').handleMail;
  const actor = {
    id: 'local-a',
    email: 'a@example.test',
    platformAdmin: false,
    fullName: 'Test A',
  };
  const env = {
    ...h.env,
    PLATFORM_ENV: 'remote-test',
    PLATFORM_MAIL_FROM: 'faktura@webshoptoolbox.dk',
    PLATFORM_MAIL_TEST_RECIPIENTS: 'a@example.test,b@example.test',
    PLATFORM_CREDENTIALS_KEY: 'cd'.repeat(32),
  };
  const call = (
    input,
    who = actor,
    company = 'company-a',
    action = 'test',
    method = 'POST',
  ) =>
    handle(
      new Request(
        'https://platform.example.test/api/platform/companies/' +
          company +
          '/mail' +
          (action ? '/' + action : ''),
        {
          method,
          headers: {
            origin: 'https://platform.example.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      ),
      env,
      who,
      company,
      action,
    );
  return { ...h, actor, env, call };
}
export async function invoiceHarness() {
  let order = fixture(),
    networkCalls = 0,
    failStore = false;
  const network = async (url, options) => {
    networkCalls++;
    assert.match(url, /^https:\/\/a[12]\.myshopify\.com\/admin\//);
    assert.equal(options.redirect, 'manual');
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'synthetic-shopify-token' });
    const body = JSON.parse(options.body);
    assert.doesNotMatch(body.query, /mutation/);
    if (body.query.includes('InvoiceOrders'))
      return Response.json({
        data: {
          orders: {
            nodes: [
              { id: order.id, name: order.name, createdAt: order.createdAt },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    return Response.json({ data: { order: structuredClone(order) } });
  };
  const h = harness(jose, network),
    env = { ...h.env, PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    objects = new Map();
  env.PLATFORM_DOCUMENTS = {
    put: async (key, bytes) => {
      if (failStore) throw Error('storage failure');
      objects.set(key, new Uint8Array(bytes).slice());
    },
    get: async (key) => {
      const b = objects.get(key);
      return b ? { body: b, arrayBuffer: async () => b.slice().buffer } : null;
    },
  };
  const { seal } = loader()('platform/connections.ts');
  for (const [shop, domain] of [
    ['shop-a1', 'a1.myshopify.com'],
    ['shop-a2', 'a2.myshopify.com'],
  ]) {
    h.sql
      .prepare(
        'INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)',
      )
      .run(
        'company-a',
        shop,
        'shopify',
        domain,
        await seal(env, ['company-a', shop, 'shopify', domain], {
          clientId: 'fixture-client',
          clientSecret: 'fixture-secret',
        }),
      );
  }
  const base = '/api/platform/companies/company-a/invoices';
  const call = (action = '', body, options = {}) =>
    h.request(base + (action ? '/' + action : ''), {
      user: 'local-a',
      env,
      method: body ? 'POST' : 'GET',
      body,
      ...options,
    });
  const settings = {
    name: 'Eksempelhandel ApS',
    address: 'Testvej 12, 8000 Aarhus C',
    cvr: '12345678',
    contact: 'faktura@example.test',
    subject: 'Faktura {{fakturanummer}} fra {{virksomhedsnavn}}',
    body: 'Hej {{kundenavn}}\nDin ordre {{ordrenummer}} er vedhæftet.',
    months: 120,
  };
  assert.equal(
    (await call('settings', settings, { method: 'PUT' })).status,
    200,
  );
  const input = (shop) => ({ webshopId: shop, externalId: order.id });
  return {
    ...h,
    env,
    objects,
    call,
    input,
    settings,
    network,
    get order() {
      return order;
    },
    set order(v) {
      order = v;
    },
    get calls() {
      return networkCalls;
    },
    failStore: () => {
      failStore = true;
    },
  };
}
export const customerEnv = {
  PLATFORM_CUSTOMER_LOGIN: 'enabled',
  PLATFORM_LOGIN_SECRET: 'ab'.repeat(32),
};
export const feedSettings = {
  name: 'PartnerAds test',
  fileName: 'partnerads',
  service: 'partnerads',
  enabled: false,
  allProducts: false,
  collections: [{ id: 'gid://shopify/Collection/42', title: 'Kollektion' }],
  products: [{ id: 'gid://shopify/Product/1', title: 'Produkt' }],
  shippingCost: '39.00',
  freeShippingFrom: '100.00',
  deliveryTime: '1-3 hverdage',
  category: '',
};
export function feedFixture() {
  const state = { fail: false, repeat: false, calls: 0, paginate: false };
  const variant = (id, price = '99.00', sale = true) => ({
    id: 'gid://shopify/ProductVariant/' + id,
    barcode: '123',
    title: 'Default Title',
    price,
    compareAtPrice: '89.00',
    availableForSale: sale,
    inventoryQuantity: 3,
    selectedOptions: [{ name: 'Farve', value: 'Rød' }],
    image: null,
  });
  const p = {
    id: 'gid://shopify/Product/1',
    status: 'ACTIVE',
    title: 'Sabel & glas',
    handle: 'sabel',
    descriptionHtml: '<p>Flot &amp; fin</p><script>bad()</script>',
    vendor: 'Firma',
    featuredImage: { url: 'https://example.test/image.png' },
    gender: null,
    productType: 'Gaver',
    variants: {
      nodes: [
        variant('1'),
        variant('2', '150.00'),
        variant('3', '80.00', false),
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
  const h = harness(jose, async (url, opt) => {
    state.calls++;
    assert.equal(opt.redirect, 'manual');
    assert.match(url, /^https:\/\/shop-[ab][12]\.myshopify\.com\//);
    if (state.fail) throw Error('Synthetic provider failure');
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'synthetic' });
    const { query, variables } = JSON.parse(opt.body);
    assert.match(query, /^query /);
    assert.doesNotMatch(query, /mutation/);
    if (query.includes('FeedShop'))
      return Response.json({
        data: {
          shop: {
            currencyCode: 'DKK',
            primaryDomain: { url: 'https://' + new URL(url).hostname },
          },
        },
      });
    if (query.includes('FeedCatalog'))
      return Response.json({
        data: {
          collections: {
            nodes: [{ id: 'gid://shopify/Collection/42', title: 'Kollektion' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    if (query.includes('FeedVariants'))
      return Response.json({
        data: {
          product: {
            variants: {
              nodes: [variant('4', '179.00')],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    // Shopify Markets: Denmark (primary), Sweden on its own domain in Swedish, and a draft Norway.
    if (query.includes('FeedMarkets'))
      return Response.json({
        data: {
          shop: {
            currencyCode: 'DKK',
            primaryDomain: { url: 'https://shop.test' },
            billingAddress: { countryCodeV2: 'DK' },
          },
          markets: {
            nodes: [
              // As Shopify returns a home market: no currency settings (the shop's currency) and no own domain.
              {
                id: 'gid://shopify/Market/1',
                name: 'Danmark',
                status: 'ACTIVE',
                currencySettings: null,
                conditions: {
                  regionsCondition: { regions: { nodes: [{ code: 'DK' }] } },
                },
                webPresences: { nodes: [] },
              },
              {
                id: 'gid://shopify/Market/2',
                name: 'Sverige',
                status: 'ACTIVE',
                currencySettings: { baseCurrency: { currencyCode: 'SEK' } },
                conditions: {
                  regionsCondition: { regions: { nodes: [{ code: 'SE' }] } },
                },
                webPresences: {
                  nodes: [
                    {
                      defaultLocale: { locale: 'sv' },
                      rootUrls: [{ locale: 'sv', url: 'https://shop.se' }],
                    },
                  ],
                },
              },
              {
                id: 'gid://shopify/Market/3',
                name: 'Norge',
                status: 'DRAFT',
                currencySettings: { baseCurrency: { currencyCode: 'NOK' } },
                conditions: {
                  regionsCondition: { regions: { nodes: [{ code: 'NO' }] } },
                },
                webPresences: { nodes: [] },
              },
            ],
          },
        },
      });
    if (query.includes('FeedMarketProducts')) {
      assert.equal(variables.country, 'SE');
      assert.equal(variables.locale, 'sv');
      const sek = (amount) => ({ amount, currencyCode: 'SEK' });
      return Response.json({
        data: {
          nodes: variables.ids.map((id) => ({
            id,
            publishedInContext: id.endsWith('/1'),
            translations: [{ key: 'title', value: 'Sabel & glas på svenska' }],
            variants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/1',
                  contextualPricing: {
                    price: sek('129.00'),
                    compareAtPrice: sek('149.00'),
                  },
                },
                {
                  id: 'gid://shopify/ProductVariant/2',
                  contextualPricing: {
                    price: sek('199.00'),
                    compareAtPrice: null,
                  },
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          })),
        },
      });
    }
    if (state.paginate)
      p.variants.pageInfo = { hasNextPage: true, endCursor: 'variant-next' };
    if (query.includes('FeedSelected'))
      return Response.json({ data: { nodes: variables.ids.map(() => p) } });
    if (query.includes('FeedCollection'))
      return Response.json({
        data: {
          collection: {
            title: 'Kollektion',
            products: {
              nodes: [
                p,
                { ...p, id: 'gid://shopify/Product/2', status: 'DRAFT' },
              ],
              pageInfo: {
                hasNextPage: state.repeat,
                endCursor: state.repeat ? 'same' : null,
              },
            },
          },
        },
      });
    throw Error('Unexpected feed query');
  });
  const objects = new Map(),
    env = {
      ...h.env,
      PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32),
      PLATFORM_DOCUMENTS: {
        put: async (k, v) => objects.set(k, v),
        get: async (k) => (objects.has(k) ? { body: objects.get(k) } : null),
      },
    };
  const call = (
    path = '',
    method = 'GET',
    body,
    shop = 'shop-a1',
    user = 'local-a',
  ) =>
    h.request('/api/platform/tier1/shops/' + shop + '/feeds' + path, {
      method,
      body,
      user,
      env,
    });
  return { ...h, state, objects, env, call, p };
}
export function customerRequest(h, path, options = {}) {
  return h.request(path, {
    auth: false,
    ...options,
    env: { ...customerEnv, ...options.env },
  });
}
export async function customerStart(h, email = 'a@example.test', extra = {}) {
  const response = await customerRequest(h, '/auth/start', {
    method: 'POST',
    body: { email, ...extra },
  });
  assert.equal(response.status, 200, await response.clone().text());
  return {
    ...(await response.json()),
    cookie: response.headers.get('set-cookie').split(';')[0],
  };
}
export async function customerVerify(h, start, extra = {}) {
  return customerRequest(h, '/auth/verify', {
    method: 'POST',
    headers: { cookie: start.cookie },
    body: { challenge: start.challenge, code: start.previewCode, ...extra },
  });
}

export async function testShopConnections(h, env) {
  const { seal } = loader()('platform/connections.ts');
  for (const shop of ['shop-a1', 'shop-a2'])
    h.sql
      .prepare(
        'INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)',
      )
      .run(
        'company-a',
        shop,
        'shopify',
        shop + '.myshopify.com',
        await seal(
          { ...h.env, ...env },
          ['company-a', shop, 'shopify', shop + '.myshopify.com'],
          { clientId: 'test', clientSecret: 'secret' },
        ),
      );
}

export async function productionSaleHarness() {
  const h = await invoiceHarness(),
    shop = 'shop-a1',
    orderId = h.order.id;
  await h.call('sync', { webshopId: shop });
  await h.call('generate', h.input(shop));
  const mapping = {
    clearing: '55000',
    goodsVat: '1000',
    shippingVat: '1100',
    goodsNoVat: '1200',
    shippingNoVat: '1300',
    vatCode: 'U25',
    noVatCode: 'NONE',
  };
  const chart = [
    ['55000', ''],
    ['1000', 'U25'],
    ['1100', 'U25'],
    ['1200', ''],
    ['1300', ''],
  ].map(([number, vatCode]) => ({
    number,
    name: number,
    vatCode,
    kind: 'entry',
    hidden: false,
  }));
  h.sql
    .prepare(
      'INSERT INTO accounting_mapping(company_id,accounts_json) VALUES(?,?)',
    )
    .run('company-a', JSON.stringify(mapping));
  h.sql
    .prepare(
      'INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)',
    )
    .run('company-a', '123', 'synthetic', 'revision1', JSON.stringify(chart));
  h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run(
    'company-a',
    shop,
    JSON.stringify({
      automation: {
        salesBookDinero: true,
        inventory: false,
        attachments: true,
      },
    }),
    'revision1',
  );
  for (const provider of ['shopify', 'dinero'])
    h.sql
      .prepare(
        'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
      )
      .run('company-a', shop, provider, '2026-09-01');
  h.sql
    .prepare(
      'INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)',
    )
    .run(
      'company-a',
      shop,
      'orders',
      orderId,
      h.order.createdAt,
      JSON.stringify(h.order),
    );
  let posts = 0,
    books = 0,
    uploads = 0,
    failCreate = false,
    failBook = false,
    remote,
    sourceReads = 0;
  const guid = '12345678-1234-1234-1234-123456789abc',
    fileGuid = 'abcdefab-1234-1234-1234-123456789abc';
  const client = async (path, method, body) => {
    if (method === 'GET') return structuredClone(remote);
    if (path === 'files') {
      uploads++;
      return { FileGuid: fileGuid };
    }
    if (path === 'vouchers/manuel') {
      posts++;
      const receipt = JSON.parse(
        h.sql
          .prepare(
            "SELECT payload_json FROM production_receipts WHERE module='orders'",
          )
          .get().payload_json,
      );
      remote = {
        ...body,
        Guid: guid,
        Status: 'Draft',
        Timestamp: 't1',
        Lines: body.Lines.map((line, i) => ({
          ...line,
          AmountExclVatValue: receipt.expected[i].net / 100,
          VatAmountValue: receipt.expected[i].tax / 100,
          AmountInclVatValue: receipt.expected[i].gross / 100,
        })),
      };
      if (failCreate) throw Error('create response lost');
      return { Guid: guid };
    }
    if (path.endsWith('/book')) {
      books++;
      remote.Status = 'Booked';
      remote.VoucherNumber = 42;
      remote.Timestamp = 't2';
      if (failBook) throw Error('book response lost');
      return remote;
    }
    throw Error('Unexpected request');
  };
  const load = loader({
    jose,
    'pdf-lib': pdfLib,
    './connections': { unseal: async () => ({ organizationId: '123' }) },
    './invoice-source': {
      shopAccess: async () => ({}),
      loadCompleteOrder: async () => {
        sourceReads++;
        return structuredClone(h.order);
      },
    },
    './dinero-read': { readDineroAccounts: async () => chart },
    './dinero-write': { dineroClient: async () => client },
  });
  const handle = load('platform/production-sales.ts').handleProductionSale;
  const env = {
      ...h.env,
      PLATFORM_ENV: 'production',
      PLATFORM_EXTERNAL_WRITES: 'enabled',
    },
    actor = { id: 'local-a', email: 'a@example.test', platformAdmin: false };
  const call = (action, version, overrides = {}) =>
    handle(
      new Request('https://portal.example.test/sales', {
        method: 'POST',
        headers: {
          origin: 'https://portal.example.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'sale',
          externalId: orderId,
          action,
          version,
          confirmed: true,
        }),
      }),
      { ...env, ...overrides },
      actor,
      'company-a',
      shop,
    );
  return {
    ...h,
    call,
    orderId,
    shop,
    env,
    get posts() {
      return posts;
    },
    get uploads() {
      return uploads;
    },
    get books() {
      return books;
    },
    get sourceReads() {
      return sourceReads;
    },
    failCreate: () => {
      failCreate = true;
    },
    failBook: () => {
      failBook = true;
    },
    changeOrder: () => {
      h.order.billingAddress.name = 'Changed';
    },
    receipt: () =>
      h.sql
        .prepare("SELECT * FROM production_receipts WHERE module='orders'")
        .get(),
  };
}

// Orders in these tests are domestic: the market step marks every order without a market as DK/DKK.
export function domesticMarkets(h) {
  return {
    ...loader()('platform/order-markets.ts'),
    fillOrderMarkets: async (env, company, shop) => {
      h.sql
        .prepare(
          "INSERT OR IGNORE INTO order_markets(company_id,webshop_id,external_id,country,currency) SELECT company_id,webshop_id,external_id,'DK','DKK' FROM operation_snapshots WHERE company_id=? AND webshop_id=? AND module='orders'",
        )
        .run(company, shop);
      return 0;
    },
  };
}

export const refundMoney = (amount) => ({
  shopMoney: { amount, currencyCode: 'DKK' },
});
export const shopifyRefund = ({
  id = 1,
  lines = [['Ring', '400.00', '80.00']],
  shipping = [],
  adjustments = [],
  transactions = [['400.00', 'mobilepay', 'MobilePay', 'SUCCESS']],
  processedAt = '2026-09-20T10:00:00Z',
} = {}) => ({
  id: 'gid://shopify/Refund/' + id,
  createdAt: processedAt,
  processedAt,
  note: null,
  refundLineItems: {
    nodes: lines.map(([name, subtotal, tax]) => ({
      quantity: 1,
      lineItem: { name },
      subtotalSet: refundMoney(subtotal),
      totalTaxSet: refundMoney(tax),
    })),
    pageInfo: { hasNextPage: false },
  },
  refundShippingLines: {
    nodes: shipping.map(([subtotal, tax]) => ({
      shippingLine: { title: 'PostNord' },
      subtotalAmountSet: refundMoney(subtotal),
      taxAmountSet: refundMoney(tax),
    })),
    pageInfo: { hasNextPage: false },
  },
  orderAdjustments: {
    nodes: adjustments.map(([reason, amount, tax]) => ({
      reason,
      amountSet: refundMoney(amount),
      taxAmountSet: refundMoney(tax),
    })),
    pageInfo: { hasNextPage: false },
  },
  transactions: {
    nodes: transactions.map(
      ([amount, gateway, formattedGateway, status], i) => ({
        id: 'gid://shopify/OrderTransaction/' + (id * 10 + i),
        kind: 'REFUND',
        status,
        test: false,
        gateway,
        formattedGateway,
        amountSet: refundMoney(amount),
      }),
    ),
    pageInfo: { hasNextPage: false },
  },
});
export {
  test,
  assert,
  readFileSync,
  readdirSync,
  DatabaseSync,
  jose,
  pdfLib,
  fixture,
  loader,
  validateConfig,
};
