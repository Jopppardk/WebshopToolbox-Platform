// Integration catalog, connections (Shopify, Dinero, payment providers, Emballage) and onboarding.
import {
  test,
  assert,
  jose,
  loader,
  harness,
  testShopConnections,
} from './platform-harness.mjs';

test('customer workspace is server-selected and accounting is one configuration per company', async () => {
  const h = harness();
  try {
    const workspace = await h.request(
      '/api/platform/workspace?companyId=company-b',
      { user: 'local-a' },
    );
    assert.equal(workspace.status, 200);
    assert.equal((await workspace.json()).company.id, 'company-a');
    assert.equal(
      (await h.request('/api/platform/workspace', { user: 'local-admin' }))
        .status,
      403,
    );
    const save = (company, provider, user = 'local-a') =>
      h.request(`/api/platform/companies/${company}/accounting`, {
        user,
        method: 'PUT',
        body: { provider, accountName: 'Testregnskab' },
      });
    assert.equal((await save('company-a', 'dinero')).status, 200);
    assert.equal((await save('company-a', 'e-conomic')).status, 200);
    assert.equal(
      h.sql
        .prepare('SELECT count(*) n FROM company_accounting WHERE company_id=?')
        .get('company-a').n,
      1,
    );
    assert.equal((await save('company-b', 'dinero')).status, 403);
    assert.equal(
      (await save('company-a', 'dinero', 'local-reader')).status,
      403,
    );
    assert.equal((await save('company-a', 'unknown')).status, 400);
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/accounting', {
          user: 'local-b',
        })
      ).status,
      403,
    );
    const config = await (
      await h.request('/api/platform/companies/company-a/accounting', {
        user: 'local-reader',
      })
    ).json();
    assert.deepEqual(config.accounting, {
      provider: 'e-conomic',
      account_name: 'Testregnskab',
      status: 'pending',
    });
    assert.equal(
      h.sql
        .prepare(
          "SELECT count(*) n FROM audit_events WHERE action='accounting.configured'",
        )
        .get().n,
      2,
    );
    assert.throws(() =>
      h.sql.exec(
        "INSERT INTO company_accounting VALUES('company-a','dinero','Duplicate','pending',CURRENT_TIMESTAMP)",
      ),
    );
    assert.throws(() =>
      h.sql.exec("UPDATE company_accounting SET status='connected'"),
    );
    h.sql.exec("UPDATE companies SET status='inactive' WHERE id='company-a'");
    assert.equal(
      (await h.request('/api/platform/workspace', { user: 'local-a' })).status,
      403,
    );
    assert.equal((await save('company-a', 'dinero')).status, 403);
  } finally {
    h.close();
  }
});

test('catalog selections are company-scoped and cannot create extra accounting connections', async () => {
  const h = harness();
  try {
    assert.equal(
      (await h.request('/api/platform/catalog', { user: 'local-a' })).status,
      200,
    );
    assert.equal(
      (await h.request('/api/platform/catalog/status', { user: 'local-a' }))
        .status,
      403,
    );
    const choose = (company, id, user = 'local-a', method = 'POST') =>
      h.request(`/api/platform/companies/${company}/integrations`, {
        user,
        method,
        body: { integrationId: id },
      });
    assert.equal((await choose('company-a', 'flatpay')).status, 200);
    assert.equal((await choose('company-a', 'flatpay')).status, 200);
    assert.equal((await choose('company-b', 'viabill')).status, 403);
    assert.equal(
      (await choose('company-a', 'viabill', 'local-reader')).status,
      403,
    );
    assert.equal((await choose('company-a', 'dinero')).status, 400);
    assert.equal((await choose('company-a', 'unknown')).status, 400);
    const selection = await (
      await h.request('/api/platform/companies/company-a/integrations', {
        user: 'local-a',
      })
    ).json();
    assert.deepEqual(selection.selected, [{ integration_id: 'flatpay' }]);
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/integrations', {
          user: 'local-b',
        })
      ).status,
      403,
    );
    assert.equal(
      (await choose('company-a', 'flatpay', 'local-a', 'DELETE')).status,
      200,
    );
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM company_integrations').get().n,
      0,
    );
  } finally {
    h.close();
  }
});
test('integration registry drives provider validation and the database accepts new registered providers', async () => {
  const {
    catalog,
    optionalIntegrations,
    paymentProviders,
    historyProviders,
    bookingSources,
    paymentProviderPattern,
  } = loader({})('platform/catalog.ts');
  assert.deepEqual(optionalIntegrations, [
    'shipmondo',
    'bring',
    'flatpay',
    'viabill',
    'pensopay',
    'emballage',
  ]);
  assert.deepEqual(paymentProviders, ['flatpay', 'viabill', 'pensopay']);
  assert.deepEqual(historyProviders, [
    'shopify',
    'dinero',
    'flatpay',
    'viabill',
    'pensopay',
  ]);
  assert.deepEqual(bookingSources, ['shopify', 'flatpay', 'viabill']);
  for (const item of catalog) assert.match(item.id, /^[a-z]+$/);
  assert.equal(paymentProviderPattern, 'flatpay|viabill|pensopay');
  const { orderPaymentIntegration } = loader({})('platform/catalog.ts');
  for (const [gateways, label] of [
    [['shopify_payments'], 'Shopify Payments'],
    [['Flatpay'], 'Flatpay'],
    [['ViaBill - betal senere'], 'ViaBill'],
    [['pensopay'], 'Pensopay'],
    [['manual'], 'Manuel betaling'],
    [
      ['gift_card', 'shopify_payments', 'Shopify Payments'],
      'Gavekort, Shopify Payments',
    ],
    [['MobilePay'], 'MobilePay'],
    [['Vipps MobilePay'], 'MobilePay'],
    [['MobilePay via Flatpay'], 'Flatpay'],
    [['bank_deposit'], 'Uden integration'],
    [[], 'Uden integration'],
    [null, 'Uden integration'],
  ])
    assert.equal(orderPaymentIntegration(gateways), label);
  assert.equal(
    orderPaymentIntegration(['Frisbii Payments'], new Set(['flatpay'])),
    'Flatpay',
  );
  assert.equal(orderPaymentIntegration(['Frisbii Payments']), 'Frisbii');
  assert.equal(
    orderPaymentIntegration(['Reepay'], new Set(['viabill'])),
    'Frisbii',
  );
  const h = harness();
  try {
    const q = (sql, ...a) => h.sql.prepare(sql).run(...a);
    // Migration 0030: no fixed provider lists, but names stay lowercase and linked records keep their FK.
    q(
      "INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES('company-a','shop-a1','newpay','n1','{}','x','2026-01-01')",
    );
    q(
      "INSERT INTO payment_records(company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','newpay','payments','r1','2026-09-01','{}')",
    );
    for (const [table, cols, vals] of [
      [
        'company_integrations',
        'company_id,integration_id',
        "'company-a','newpay'",
      ],
      [
        'integration_history',
        'company_id,scope,provider',
        "'company-a','shop-a1','newpay'",
      ],
      [
        'booking_start_dates',
        'company_id,webshop_id,provider',
        "'company-a','shop-a1','newpay'",
      ],
    ])
      q(`INSERT INTO ${table}(${cols}) VALUES(${vals})`);
    assert.throws(
      () =>
        q(
          "INSERT INTO company_integrations(company_id,integration_id) VALUES('company-a','New Pay')",
        ),
      /CHECK/,
    );
    assert.throws(
      () =>
        q(
          "INSERT INTO payment_records(company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','nopay','payments','r2','2026-09-01','{}')",
        ),
      /FOREIGN KEY/,
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT count(*) n FROM record_events WHERE provider='newpay' AND event='imported'",
        )
        .get().n,
      1,
    );
    // Unregistered providers are still refused by the API.
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/integrations', {
          user: 'local-a',
          method: 'POST',
          body: { integrationId: 'newpay' },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.request(
          '/api/platform/tier1/shops/shop-a1/integrations/selection',
          {
            user: 'local-a',
            method: 'POST',
            body: { provider: 'newpay', action: 'add' },
          },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-a/webshops/shop-a1/payments/newpay/connection',
          { user: 'local-a' },
        )
      ).status,
      404,
    );
  } finally {
    h.close();
  }
});

test('Pensopay connects read-only, imports paged payments and settlements, and never stores the private key', async () => {
  const calls = [];
  let key = 'pp-test-key',
    redirect = false;
  const future = new Date(Date.now() + 10 * 86400000)
    .toISOString()
    .slice(0, 10);
  const pay = (id, captured) => ({
    id,
    order_id: '#10' + id,
    amount: 10000,
    currency: 'DKK',
    state: 'captured',
    captured,
    refunded: 0,
    card_fee: 125,
    created_at: '2026-09-10T10:00:00Z',
    facilitator: 'creditcard',
    acquirer: 'clearhaus',
    testmode: false,
  });
  const network = async (url, opt) => {
    const u = new URL(url);
    if (u.hostname !== 'api.pensopay.com')
      throw Error('unexpected host ' + u.hostname);
    assert.equal(opt.method, 'GET');
    assert.equal(opt.redirect, 'manual');
    assert.equal(opt.body, undefined);
    calls.push(u.pathname + u.search);
    if (redirect)
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.test/' },
      });
    if (opt.headers.Authorization !== 'Bearer ' + key)
      return new Response('{}', { status: 401 });
    if (u.pathname === '/v2/account')
      return Response.json({
        id: 42,
        name: 'butik',
        display_name: 'Butik ApS',
        private_key: 'PRIVATE-SECRET',
      });
    if (u.pathname === '/v2/payments') {
      const p = Number(u.searchParams.get('page'));
      return Response.json({
        data: p === 1 ? [pay(1, 10000), pay(2, 0)] : [pay(3, 5000)],
        meta: { current_page: p, last_page: 2, per_page: 100, total: 3 },
      });
    }
    if (u.pathname === '/v2/settlements')
      return Response.json({
        data: [
          {
            id: 'aaaaaaaa-0000-4000-8000-000000000001',
            currency: 'DKK',
            settled: true,
            period: { start_date: '2026-09-01', end_date: '2026-09-07' },
            summary: {
              sales: 20000,
              credits: 0,
              refunds: -1000,
              chargebacks: 0,
              fees: -250,
              other_postings: 0,
              net: 18750,
            },
            payout: {
              amount: 18750,
              date: '2026-09-09',
              cancelled_date: null,
              reference_number: 'R1',
            },
          },
          {
            id: 'aaaaaaaa-0000-4000-8000-000000000002',
            currency: 'DKK',
            settled: false,
            period: { start_date: '2026-09-08', end_date: '2026-09-14' },
            summary: { sales: 5000, net: 4900, fees: -100 },
            payout: {
              amount: 4900,
              date: future,
              cancelled_date: null,
              reference_number: 'R2',
            },
          },
        ],
        meta: { current_page: 1, last_page: 1, per_page: 50, total: 2 },
      });
    return new Response('{}', { status: 404 });
  };
  const h = harness(jose, network),
    env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    base = '/api/platform/tier1/shops/shop-a1';
  try {
    const post = (path, body, user = 'local-a') =>
      h.request(base + path, { user, env, method: 'POST', body });
    assert.equal(
      (
        await post('/integrations/selection', {
          provider: 'pensopay',
          action: 'add',
        })
      ).status,
      200,
    );
    let r = await post('/pensopay/connection', {
      action: 'discover',
      apiKey: key,
    });
    assert.equal(r.status, 200, await r.clone().text());
    const text = await r.text();
    assert.doesNotMatch(text, /PRIVATE-SECRET/);
    assert.deepEqual(JSON.parse(text).accounts, [
      { id: '42', name: 'Butik ApS' },
    ]);
    r = await post('/pensopay/connection', {
      action: 'connect',
      apiKey: 'wrong',
      startDate: '2026-09-01',
      accountName: 'Butik ApS',
    });
    assert.equal(r.status, 422);
    assert.match((await r.json()).error, /HTTP 401/);
    r = await post('/pensopay/connection', {
      action: 'connect',
      apiKey: key,
      startDate: '2026-09-01',
      accountName: 'Butik ApS',
    });
    assert.equal(r.status, 200, await r.clone().text());
    const saved = h.sql
      .prepare(
        "SELECT identity,metadata_json,credentials_encrypted FROM payment_connections WHERE provider='pensopay'",
      )
      .get();
    assert.equal(saved.identity, '42');
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE-SECRET|pp-test-key/);
    assert.equal(
      (await h.request(base + '/pensopay/connection', { user: 'local-a' }))
        .status,
      200,
    );
    r = await post('/pensopay/records', {
      kind: 'payments',
      from: '2026-09-01',
      to: '2026-09-20',
    });
    let d = await r.json();
    assert.equal(r.status, 200, JSON.stringify(d));
    assert.equal(d.synced, 2);
    assert.equal(d.next.page, 2);
    r = await post('/pensopay/records', {
      kind: 'payments',
      from: '2026-09-01',
      to: '2026-09-20',
      next: d.next,
    });
    d = await r.json();
    assert.equal(d.synced, 1);
    assert.equal(d.next, null);
    assert.equal(
      (
        await post('/pensopay/records', {
          kind: 'payments',
          from: '2026-09-01',
          to: '2026-09-19',
          next: { scope: 'x', page: 2 },
        })
      ).status,
      400,
    );
    r = await post('/pensopay/records', {
      kind: 'settlements',
      from: '2026-09-01',
      to: '2026-09-20',
    });
    d = await r.json();
    assert.equal(d.synced, 2, JSON.stringify(d));
    const payments = (
      await (
        await h.request(
          base +
            '/pensopay/records?kind=payments&from=2026-09-01&to=2026-09-30',
          { user: 'local-a' },
        )
      ).json()
    ).records;
    assert.deepEqual(
      payments.map((p) => [p.paymentId, p.amountMinor, p.feeMinor]).sort(),
      [
        ['1', 10000, 125],
        ['2', 10000, 125],
        ['3', 5000, 125],
      ],
    );
    const payouts = (
      await (
        await h.request(base + '/payouts/overview', { user: 'local-a' })
      ).json()
    ).payouts.filter((p) => p.provider === 'pensopay');
    assert.deepEqual(
      payouts.map((p) => [p.amount, p.status, p.booking]).sort(),
      [
        [187.5, 'Udbetalt', 'not_enabled'],
        [49, 'Kommende', 'not_enabled'],
      ],
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT count(*) n FROM payment_records WHERE provider='pensopay' AND kind='settlements' AND paid=1",
        )
        .get().n,
      1,
    );
    redirect = true;
    r = await post('/pensopay/records', {
      kind: 'payments',
      from: '2026-09-01',
      to: '2026-09-20',
    });
    assert.equal(r.status, 422);
    assert.match((await r.json()).error, /omdirigerede/);
    assert.equal(
      (
        await post(
          '/pensopay/records',
          { kind: 'settlements', from: '2026-09-01', to: '2026-09-20' },
          'local-reader',
        )
      ).status,
      403,
    );
    assert.ok(
      calls.every((c) => /^\/v2\/(account|payments|settlements)(\?|$)/.test(c)),
    );
  } finally {
    h.close();
  }
});

test('packaging fields in Shopify: status everywhere, creation only in production with write_products, never touching existing fields', async () => {
  let existing = [
      { key: 'emballage_leverandor', type: { name: 'single_line_text_field' } },
      { key: 'emballage_vaegt_gram', type: { name: 'single_line_text_field' } },
      { key: 'other', type: { name: 'json' } },
    ],
    scopes = ['read_products'];
  const mutations = [];
  const network = async (url, opt) => {
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'fixture' });
    const { query, variables } = JSON.parse(opt.body);
    if (query.startsWith('mutation')) {
      assert.match(query, /^mutation CreatePackagingField\(/);
      assert.doesNotMatch(query, /productUpdate|metafieldsSet|Delete/);
      assert.equal(variables.definition.namespace, 'custom');
      assert.equal(variables.definition.ownerType, 'PRODUCT');
      mutations.push(variables.definition.key);
      existing.push({
        key: variables.definition.key,
        type: { name: variables.definition.type },
      });
      return Response.json({
        data: {
          metafieldDefinitionCreate: {
            createdDefinition: { key: variables.definition.key },
            userErrors: [],
          },
        },
      });
    }
    return Response.json({
      data: {
        metafieldDefinitions: { nodes: existing },
        currentAppInstallation: {
          accessScopes: scopes.map((handle) => ({ handle })),
        },
      },
    });
  };
  const h = harness(jose, network),
    env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    path = '/api/platform/tier1/shops/shop-a1/emballage/shopify-fields';
  try {
    await testShopConnections(h, env);
    let r = await h.request(path, { user: 'local-a', env });
    let d = await r.json();
    assert.equal(r.status, 200, JSON.stringify(d));
    assert.deepEqual(
      Object.fromEntries(d.fields.map((f) => [f.key, f.status])),
      {
        emballage_indberetning: 'missing',
        emballage_vaegt_gram: 'conflict',
        emballage_leverandor: 'present',
        emballage_leverandorland: 'missing',
        emballage_leverandor_cvr: 'missing',
      },
    );
    assert.equal(d.writes, false);
    assert.equal(d.canWrite, false);
    r = await h.request(path, {
      user: 'local-a',
      env,
      method: 'POST',
      body: {},
    });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /testmiljøet/);
    assert.equal(mutations.length, 0);
    assert.equal(
      (
        await h.request(path, {
          user: 'local-reader',
          env,
          method: 'POST',
          body: {},
        })
      ).status,
      403,
    );
    // Production path, called directly because the local harness cannot run with production auth.
    const { handleShopifyFields } = loader({ jose, fetch: network })(
        'platform/shopify-metafields.ts',
      ),
      prod = {
        ...h.env,
        ...env,
        PLATFORM_ENV: 'production',
        PLATFORM_EXTERNAL_WRITES: 'enabled',
      };
    // Credentials are sealed per environment, so reseal the fixture connection for production.
    const { seal } = loader()('platform/connections.ts');
    h.sql
      .prepare(
        "UPDATE webshop_connections SET credentials_encrypted=? WHERE company_id='company-a' AND webshop_id='shop-a1'",
      )
      .run(
        await seal(
          prod,
          ['company-a', 'shop-a1', 'shopify', 'shop-a1.myshopify.com'],
          { clientId: 'test', clientSecret: 'secret' },
        ),
      );
    const post = () =>
      handleShopifyFields(
        new Request('https://portal.test/x', {
          method: 'POST',
          headers: {
            origin: 'https://portal.test',
            'content-type': 'application/json',
          },
          body: '{}',
        }),
        prod,
        {
          id: 'local-a',
          email: 'a@example.test',
          platformAdmin: false,
          fullName: 'A',
        },
        'company-a',
        'shop-a1',
      );
    await assert.rejects(post, /write_products/);
    assert.equal(mutations.length, 0);
    scopes = ['read_products', 'write_products'];
    r = await post();
    d = await r.json();
    assert.deepEqual(mutations, [
      'emballage_indberetning',
      'emballage_leverandorland',
      'emballage_leverandor_cvr',
    ]);
    assert.deepEqual(d.created, mutations);
    assert.equal(
      d.fields.find((f) => f.key === 'emballage_vaegt_gram').status,
      'conflict',
    );
    r = await post();
    assert.deepEqual((await r.json()).created, []);
    assert.equal(mutations.length, 3);
    assert.equal(
      h.sql
        .prepare(
          "SELECT count(*) n FROM audit_events WHERE action='shopify.packaging_fields'",
        )
        .get().n,
      2,
    );
  } finally {
    h.close();
  }
});

test('integration catalog counts active companies per connected integration for Tier 0 only', async () => {
  const h = harness(jose, async () => new Response('', { status: 401 }));
  try {
    const q = (sql, ...a) => h.sql.prepare(sql).run(...a);
    for (const [c, w, d] of [
      ['company-a', 'shop-a1', 'a1.myshopify.com'],
      ['company-a', 'shop-a2', 'a2.myshopify.com'],
      ['company-b', 'shop-b1', 'b1.myshopify.com'],
    ])
      q(
        "INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,'shopify',?,'x')",
        c,
        w,
        d,
      );
    q(
      "INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES('company-a','1','x','r','[]')",
    );
    q(
      "INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES('company-a','shop-a1','flatpay','f1','{}','x','2026-01-01')",
    );
    for (const c of ['company-a', 'company-b'])
      q(
        "INSERT INTO company_integrations(company_id,integration_id) VALUES(?,'viabill')",
        c,
      );
    const r = await h.request('/api/platform/catalog/status', {
      user: 'local-admin',
    });
    assert.equal(r.status, 200, await r.clone().text());
    let usage = Object.fromEntries(
      (await r.json()).integrations.map((i) => [i.id, i.usage]),
    );
    assert.deepEqual(usage, {
      shipmondo: { connected: 0, selected: 0 },
      bring: { connected: 0, selected: 0 },
      shopify: { connected: 2, selected: 0 },
      dinero: { connected: 1, selected: 0 },
      flatpay: { connected: 1, selected: 0 },
      viabill: { connected: 0, selected: 2 },
      pensopay: { connected: 0, selected: 0 },
      emballage: { connected: 0, selected: 0 },
    });
    q("UPDATE companies SET status='inactive' WHERE id='company-b'");
    usage = Object.fromEntries(
      (
        await (
          await h.request('/api/platform/catalog/status', {
            user: 'local-admin',
          })
        ).json()
      ).integrations.map((i) => [i.id, i.usage]),
    );
    assert.deepEqual([usage.shopify.connected, usage.viabill.selected], [1, 1]);
    assert.ok(
      (
        await (
          await h.request('/api/platform/catalog/status', {
            user: 'local-admin',
          })
        ).json()
      ).integrations.every((i) => !('api' in i)),
    );
  } finally {
    h.close();
  }
});
test('integration probes report reachability per provider without credentials or following redirects', async () => {
  const { apiStatus } = loader({})('platform/catalog.ts'),
    seen = [];
  const answers = {
    'https://api.dinero.dk/v1': 401,
    'https://api.saga.valitor.com/panthro': 503,
    'https://secure.viabill.com/api': 404,
    'https://admin.shopify.com/': 302,
  };
  const result = await apiStatus(async (url, options) => {
    if (url.includes('shopifystatus')) return Response.json({ components: [] });
    seen.push(url);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers, undefined);
    assert.equal(options.body, undefined);
    if (!(url in answers)) throw Error('network');
    return new Response('secret body', { status: answers[url] });
  });
  assert.equal(seen.length, 8);
  const by = Object.fromEntries(result.map((r) => [r.id, r.connectivity]));
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(by).map(([id, c]) => [id, [c.state, c.httpStatus]]),
    ),
    {
      shipmondo: ['unreachable', null],
      bring: ['unreachable', null],
      shopify: ['reachable', 302],
      dinero: ['reachable', 401],
      flatpay: ['provider_error', 503],
      viabill: ['reachable', 404],
      pensopay: ['unreachable', null],
      emballage: ['unreachable', null],
    },
  );
  for (const c of Object.values(by)) {
    assert.ok(Number.isInteger(c.ms) && c.ms >= 0);
    assert.ok(c.checkedAt);
    assert.doesNotMatch(JSON.stringify(c), /secret/);
  }
});

test('Shopify setup is encrypted, scoped, atomic and never returned or logged', async () => {
  const h = harness();
  try {
    h.env.PLATFORM_CREDENTIALS_KEY = 'ab'.repeat(32);
    const body = {
      provider: 'shopify',
      name: 'New shop',
      domain: 'https://new.example.test/',
      shopDomain: 'https://new.myshopify.com',
      clientId: 'synthetic-client',
      clientSecret: 'synthetic-secret',
    };
    const response = await h.request(
      '/api/platform/companies/company-a/webshops',
      { user: 'local-a', method: 'POST', body },
    );
    assert.equal(response.status, 201, await response.clone().text());
    const { id } = await response.json();
    const row = h.sql
      .prepare('SELECT * FROM webshop_connections WHERE webshop_id=?')
      .get(id);
    assert.equal(row.shop_domain, 'new.myshopify.com');
    assert.ok(!row.credentials_encrypted.includes(body.clientSecret));
    const { unseal } = loader({})('platform/connections.ts');
    assert.equal(
      (
        await unseal(
          h.env,
          ['company-a', id, 'shopify', row.shop_domain],
          row.credentials_encrypted,
        )
      ).clientSecret,
      body.clientSecret,
    );
    for (const scope of [
      ['company-b', id, 'shopify', row.shop_domain],
      ['company-a', 'shop-a1', 'shopify', row.shop_domain],
      ['company-a', id, 'shopify', 'other.myshopify.com'],
    ])
      await assert.rejects(unseal(h.env, scope, row.credentials_encrypted));
    await assert.rejects(
      unseal(
        { ...h.env, PLATFORM_ENV: 'remote-test' },
        ['company-a', id, 'shopify', row.shop_domain],
        row.credentials_encrypted,
      ),
    );
    const list = await (
      await h.request('/api/platform/companies/company-a/webshops', {
        user: 'local-a',
      })
    ).text();
    assert.ok(list.includes('shopify'));
    assert.ok(!list.includes('credentials_encrypted'));
    assert.ok(!list.includes(body.clientSecret));
    assert.ok(!list.includes(body.clientId));
    const audit = JSON.stringify(
      h.sql.prepare('SELECT * FROM audit_events').all(),
    );
    assert.ok(!audit.includes(body.clientSecret));
    for (const user of ['local-b', 'local-reader'])
      assert.equal(
        (
          await h.request(
            `/api/platform/companies/company-a/webshops/${id}/connection`,
            { user, method: 'PUT', body },
          )
        ).status,
        403,
      );
    const update = { ...body, clientSecret: 'replacement-secret' };
    assert.equal(
      (
        await h.request(
          `/api/platform/companies/company-a/webshops/${id}/connection`,
          { user: 'local-a', method: 'PUT', body: update },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await unseal(
          h.env,
          ['company-a', id, 'shopify', row.shop_domain],
          h.sql
            .prepare(
              'SELECT credentials_encrypted FROM webshop_connections WHERE webshop_id=?',
            )
            .get(id).credentials_encrypted,
        )
      ).clientSecret,
      update.clientSecret,
    );
    const before = h.sql.prepare('SELECT count(*) n FROM webshops').get().n;
    for (const change of [
      { provider: 'unknown' },
      { shopDomain: 'https://new.myshopify.com.evil.test' },
      { domain: 'https://user:password@example.test' },
      { shopDomain: 'https://new.myshopify.com/admin' },
      { clientSecret: '' },
    ])
      assert.equal(
        (
          await h.request('/api/platform/companies/company-a/webshops', {
            user: 'local-a',
            method: 'POST',
            body: {
              ...body,
              ...change,
              domain: change.domain || 'bad.example.test',
            },
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/webshops', {
          user: 'local-a',
          method: 'POST',
          body: { ...body, domain: 'another.example.test' },
        })
      ).status,
      409,
    );
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM webshops').get().n,
      before,
    );
    delete h.env.PLATFORM_CREDENTIALS_KEY;
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/webshops', {
          user: 'local-a',
          method: 'POST',
          body: { ...body, domain: 'missing.example.test' },
        })
      ).status,
      503,
    );
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM webshops').get().n,
      before,
    );
  } finally {
    h.close();
  }
});
test('Dinero connection only reads, encrypts credentials and scopes chart and mappings', async () => {
  const calls = [];
  const h = harness(jose, async (url, opt) => {
    calls.push({ url, method: opt.method || 'GET' });
    assert.equal(opt.redirect, 'manual');
    if (url.includes('/oauth/token'))
      return Response.json({ access_token: 'fixture-token' });
    return Response.json([
      { AccountNumber: 1000, Name: 'Salg', VatCode: 'U25' },
    ]);
  });
  const env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) };
  try {
    const base = '/api/platform/companies/company-a/accounting',
      credentials = {
        organizationId: '123',
        clientId: 'test',
        clientSecret: 'secret',
        apiKey: 'test-key',
      };
    assert.equal(
      (
        await h.request(base + '/connection', {
          user: 'local-reader',
          env,
          method: 'PUT',
          body: credentials,
        })
      ).status,
      403,
    );
    assert.equal(calls.length, 0);
    const saved = await h.request(base + '/connection', {
      user: 'local-a',
      env,
      method: 'PUT',
      body: credentials,
    });
    assert.equal(saved.status, 200, await saved.text());
    assert.ok(
      calls.every(
        (c) =>
          c.method === 'GET' ||
          c.url === 'https://authz.dinero.dk/dineroapi/oauth/token',
      ),
    );
    const info = await (
      await h.request(base + '/connection', { user: 'local-a' })
    ).json();
    assert.equal(info.accounts.length, 1);
    assert.ok(!JSON.stringify(info).includes('test-key'));
    assert.ok(
      !h.sql
        .prepare('SELECT credentials_encrypted FROM accounting_connections')
        .get()
        .credentials_encrypted.includes('test-key'),
    );
    assert.equal(
      (await h.request(base + '/connection', { user: 'local-b' })).status,
      403,
    );
    assert.equal(
      (
        await h.request(base + '/mapping', {
          user: 'local-a',
          method: 'PUT',
          body: {
            revision: info.revision,
            mapping: { goodsVat: '1000 - Salg', vatCode: 'U25' },
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request(base + '/mapping', {
          user: 'local-a',
          method: 'PUT',
          body: {
            revision: info.revision,
            mapping: { goodsVat: '9999 - Forged' },
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.request(base + '/connection', {
          user: 'local-a',
          env,
          method: 'PUT',
          body: { ...credentials, organizationId: '456' },
        })
      ).status,
      409,
    );
  } finally {
    h.close();
  }
});

test('payment connections bind verified accounts to one shop, encrypt credentials and preserve paid records', async () => {
  let upcoming = false,
    settled = false;
  const calls = [];
  const h = harness(jose, async (input, init) => {
    const url = new URL(input);
    calls.push([url.pathname, init.method]);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    if (url.pathname.endsWith('/agreements'))
      return Response.json({
        agreements: [
          {
            id: 'agreement',
            merchantID: 'merchant',
            agreementNumber: '123',
            currency: 'DKK',
          },
        ],
      });
    if (
      url.pathname.endsWith('/settlements') &&
      url.searchParams.has('ScheduledDateFrom')
    )
      return Response.json({
        settlements: upcoming
          ? [
              {
                settlementNumber: '900',
                merchantID: 'merchant',
                agreementNumber: '123',
                scheduledDate: new Date().toISOString().slice(0, 10),
                paidDate: null,
                netSettlement: 55.5,
                currency: 'DKK',
              },
              {
                settlementNumber: '901',
                merchantID: 'foreign',
                agreementNumber: '123',
                scheduledDate: new Date().toISOString().slice(0, 10),
                netSettlement: 9,
                currency: 'DKK',
              },
            ]
          : [],
      });
    if (url.pathname.endsWith('/payments'))
      return Response.json({
        payments: url.searchParams.has('ScheduledDateFrom')
          ? upcoming
            ? [
                {
                  paymentID: '42',
                  merchantID: 'merchant',
                  agreementNumber: '123',
                  scheduledDate: new Date().toISOString().slice(0, 10),
                  paidDate: null,
                  payoutAmount: 1,
                  currency: 'DKK',
                },
              ]
            : []
          : [
              {
                paymentID: '42',
                merchantID: 'merchant',
                agreementNumber: '123',
                paidDate: '2026-09-01',
                payoutAmount: 100,
                currency: 'DKK',
              },
              {
                paymentID: '43',
                merchantID: 'foreign',
                agreementNumber: '123',
                paidDate: '2026-09-01',
                payoutAmount: 500,
                currency: 'DKK',
              },
              ...(settled
                ? [
                    {
                      paymentID: '44',
                      merchantID: 'merchant',
                      agreementNumber: '123',
                      paidDate: '2026-09-01',
                      payoutAmount: 55.5,
                      currency: 'DKK',
                      settlements: '900',
                    },
                  ]
                : []),
            ],
      });
    throw Error('unexpected provider call');
  });
  const env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    base =
      '/api/platform/companies/company-a/webshops/shop-a1/payments/flatpay';
  const connection = {
    username: 'test',
    password: 'synthetic-secret',
    agreementNumber: '123',
    startDate: '2026-01-01',
  };
  try {
    let response = await h.request(base + '/connection', {
      user: 'local-a',
      env,
      method: 'PUT',
      body: connection,
    });
    assert.equal(response.status, 200, await response.text());
    assert.doesNotMatch(
      h.sql
        .prepare('SELECT credentials_encrypted FROM payment_connections')
        .get().credentials_encrypted,
      /synthetic-secret/,
    );
    response = await h.request(base + '/connection', { user: 'local-reader' });
    assert.equal(response.status, 200);
    assert.doesNotMatch(
      await response.text(),
      /credentials|password|synthetic-secret/,
    );
    response = await h.request(
      base.replace('shop-a1', 'shop-a2') + '/connection',
      { user: 'local-a', env, method: 'PUT', body: connection },
    );
    assert.equal(response.status, 409);
    assert.equal(
      (await h.request(base + '/connection', { user: 'local-b' })).status,
      403,
    );
    assert.equal(
      (
        await h.request(base + '/records', {
          user: 'local-reader',
          env,
          method: 'POST',
          body: { start: '2026-09-01', end: '2026-09-01', kind: 'payments' },
        })
      ).status,
      403,
    );
    for (const state of [false, true]) {
      upcoming = state;
      response = await h.request(base + '/records', {
        user: 'local-a',
        env,
        method: 'POST',
        body: { start: '2026-09-01', end: '2026-09-01', kind: 'payments' },
      });
      assert.equal(response.status, 200, await response.text());
    }
    const all = (
        await (await h.request(base + '/records', { user: 'local-a' })).json()
      ).rows,
      rows = all.filter((r) => r.paidDate);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payoutAmount, 100);
    assert.equal(rows[0].paidDate, '2026-09-01');
    // An upcoming payout exists only as a scheduled settlement: stored as an unpaid estimate, never as the foreign agreement's.
    const estimates = all.filter((r) => r.estimate);
    assert.deepEqual(
      estimates.map((r) => [r.settlementNumber, r.payoutAmount, r.paidDate]),
      [['900', 55.5, null]],
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT paid FROM payment_records WHERE external_id='upcoming:900'",
        )
        .get().paid,
      0,
    );
    const overview = async () =>
      (
        await (
          await h.request(
            '/api/platform/tier1/shops/shop-a1/payouts/overview',
            { user: 'local-a' },
          )
        ).json()
      ).payouts.filter((p) => p.provider === 'flatpay');
    assert.deepEqual(
      (await overview()).find((p) => p.id === 'upcoming:900')?.status,
      'Kommende',
    );
    // Once Flatpay pays it, the estimate is replaced by the actual payout.
    settled = true;
    upcoming = false;
    assert.equal(
      (
        await h.request(base + '/records', {
          user: 'local-a',
          env,
          method: 'POST',
          body: { start: '2026-09-01', end: '2026-09-01', kind: 'payments' },
        })
      ).status,
      200,
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT count(*) n FROM payment_records WHERE external_id='upcoming:900'",
        )
        .get().n,
      0,
    );
    assert.ok(
      (await overview()).some((p) => p.id === '44' && p.status === 'Udbetalt'),
    );
    assert.equal(
      (
        await h.request(base + '/connection', {
          user: 'local-a',
          env,
          method: 'PUT',
          body: { ...connection, revision: 0 },
        })
      ).status,
      409,
    );
    const tier1 = '/api/platform/tier1/shops/shop-a1';
    response = await h.request(tier1 + '/integrations/start-date', {
      user: 'local-a',
      method: 'POST',
      body: {
        provider: 'flatpay',
        startDate: '2026-02-01',
        bookingStartDate: '2026-09-01',
      },
    });
    assert.equal(response.status, 200);
    const savedRevision = h.sql
      .prepare(
        "SELECT revision FROM payment_connections WHERE webshop_id='shop-a1'",
      )
      .get().revision;
    response = await h.request(tier1 + '/flatpay/connection', {
      user: 'local-a',
      env,
      method: 'POST',
      body: {
        action: 'save',
        username: connection.username,
        password: connection.password,
        agreementNumber: connection.agreementNumber,
        revision: savedRevision,
      },
    });
    assert.equal(response.status, 200, await response.text());
    assert.equal(
      h.sql
        .prepare(
          "SELECT start_date FROM payment_connections WHERE webshop_id='shop-a1'",
        )
        .get().start_date,
      '2026-02-01',
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT start_date FROM booking_start_dates WHERE webshop_id='shop-a1' AND provider='flatpay'",
        )
        .get().start_date,
      '2026-09-01',
    );

    assert.ok(calls.length > 0);
  } finally {
    h.close();
  }
});

test('ViaBill exports isolate identical external IDs and reject foreign continuation cursors', async () => {
  let exports = 0;
  const h = harness(jose, async (input, init) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'secure.viabill.com');
    assert.equal(init.redirect, 'manual');
    assert.match(url.pathname, /entries\/download\/JSON$/);
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    if (body.entryPage.pageLength === 1) return Response.json({ entries: [] });
    exports++;
    return Response.json({
      entries: Array.from({ length: 50 }, (_, n) => ({
        entryUUID: 'same-' + n,
        type: 'capture',
        date: '2026-09-01',
        amount: { amount: 100, currency: 'DKK' },
      })),
    });
  });
  const env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    a = '/api/platform/companies/company-a/webshops/shop-a1/payments/viabill',
    b = '/api/platform/companies/company-b/webshops/shop-b1/payments/viabill';
  try {
    for (const [base, user, account] of [
      [a, 'local-a', 'account-a'],
      [b, 'local-b', 'account-b'],
    ]) {
      let r = await h.request(base + '/connection', {
        user,
        env,
        method: 'PUT',
        body: {
          apiKey: 'key',
          secret: 'secret',
          accountId: account,
          startDate: '2026-01-01',
        },
      });
      assert.equal(r.status, 200, await r.text());
      r = await h.request(base + '/records', {
        user,
        env,
        method: 'POST',
        body: { kind: 'payment', start: '2026-09-01', end: '2026-09-01' },
      });
      assert.equal(r.status, 200, await r.clone().text());
      const { next } = await r.json();
      assert.ok(next);
      r = await h.request(base + '/records', {
        user,
        env,
        method: 'POST',
        body: {
          kind: 'payment',
          start: '2026-09-01',
          end: '2026-09-01',
          cursor: next,
        },
      });
      assert.equal(r.status, 409, 'provider repeated page');
      r = await h.request((base === a ? b : a) + '/records', {
        user: base === a ? 'local-b' : 'local-a',
        env,
        method: 'POST',
        body: {
          kind: 'payment',
          start: '2026-09-01',
          end: '2026-09-01',
          cursor: next,
        },
      });
      assert.ok([400, 409].includes(r.status));
    }
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM payment_records').get().n,
      100,
    );
    assert.ok(exports >= 4);
    const rows = (
      await (
        await h.request(a + '/records?kind=payment', { user: 'local-a' })
      ).json()
    ).rows;
    assert.equal(rows.length, 50);
    assert.ok(rows.every((r) => r.accountId === 'account-a'));
  } finally {
    h.close();
  }
});

test('Tier 1 onboarding only reports verified connections in the current company and shop', async () => {
  const h = harness();
  try {
    const status = async (shop = 'shop-a1', user = 'local-a') =>
      (
        await (
          await h.request(
            '/api/platform/tier1/shops/' + shop + '/integrations',
            { user },
          )
        ).json()
      ).integrations;
    assert.deepEqual(await status('none'), []);
    h.sql
      .prepare(
        'INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)',
      )
      .run('company-a', '123', 'encrypted', 'r', '[]');
    h.sql
      .prepare(
        'INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)',
      )
      .run(
        'company-a',
        'shop-a1',
        'shopify',
        'test.myshopify.com',
        'encrypted',
      );
    assert.deepEqual(
      (await status()).map((x) => x.provider),
      ['dinero'],
    );
    h.sql
      .prepare(
        "UPDATE webshop_connections SET verified_at=CURRENT_TIMESTAMP WHERE webshop_id='shop-a1'",
      )
      .run();
    assert.deepEqual(
      (await status()).map((x) => x.provider),
      ['dinero', 'shopify'],
    );
    assert.deepEqual(
      (await status('shop-a2')).map((x) => x.provider),
      ['dinero'],
    );
    assert.deepEqual(await status('shop-b1', 'local-b'), []);
    assert.equal(
      (
        await h.request('/api/platform/tier1/shops/shop-a1/integrations', {
          user: 'local-b',
        })
      ).status,
      404,
    );
    h.sql
      .prepare(
        "UPDATE webshop_connections SET verified_at=NULL WHERE webshop_id='shop-a1'",
      )
      .run();
    assert.deepEqual(
      (await status()).map((x) => x.provider),
      ['dinero'],
    );
  } finally {
    h.close();
  }
});

test('Tier 1 Shopify connection verifies before saving, creates first shop and preserves prior credentials on failure', async () => {
  let fail = false,
    calls = 0;
  const h = harness(jose, async (url, opt) => {
    calls++;
    assert.equal(opt.redirect, 'manual');
    assert.ok(url.startsWith('https://new-shop.myshopify.com/'));
    if (fail) return Response.json({}, { status: 401 });
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'test' });
    assert.match(JSON.parse(opt.body).query, /^query /);
    return Response.json({ data: { shop: { name: 'Test shop' } } });
  });
  const env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    body = {
      provider: 'shopify',
      shop: 'new-shop.myshopify.com',
      clientId: 'test',
      clientSecret: 'synthetic-secret',
    };
  const route = (shop) => '/api/platform/tier1/shops/' + shop + '/integrations';
  const post = (shop, user = 'local-a', input = body) =>
    h.request(route(shop), { user, env, method: 'POST', body: input });
  try {
    assert.equal((await post('none', 'local-reader')).status, 403);
    assert.equal((await post('shop-b1')).status, 404);
    assert.equal(calls, 0);
    assert.equal(
      (await post('none', 'local-a', { ...body, shop: 'localhost' })).status,
      400,
    );
    assert.equal(calls, 0);
    const before = h.sql.prepare('SELECT count(*) n FROM webshops').get().n;
    fail = true;
    assert.equal((await post('none')).status, 409);
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM webshops').get().n,
      before,
    );
    fail = false;
    const response = await post('none');
    assert.equal(response.status, 200, await response.clone().text());
    const created = await response.json();
    assert.equal(created.created, true);
    assert.equal(created.name, 'Test shop');
    const saved = h.sql
      .prepare('SELECT * FROM webshop_connections WHERE webshop_id=?')
      .get(created.webshopId);
    assert.ok(saved.verified_at);
    assert.doesNotMatch(saved.credentials_encrypted, /synthetic-secret/);
    const { unseal } = loader()('platform/connections.ts');
    assert.equal(
      (
        await unseal(
          { ...h.env, ...env },
          ['company-a', created.webshopId, 'shopify', body.shop],
          saved.credentials_encrypted,
        )
      ).clientSecret,
      body.clientSecret,
    );
    await assert.rejects(() =>
      unseal(
        { ...h.env, ...env },
        ['company-b', created.webshopId, 'shopify', body.shop],
        saved.credentials_encrypted,
      ),
    );
    assert.equal((await post('none')).status, 409);
    fail = true;
    assert.equal((await post(created.webshopId)).status, 409);
    assert.deepEqual(
      h.sql
        .prepare('SELECT * FROM webshop_connections WHERE webshop_id=?')
        .get(created.webshopId),
      saved,
    );
    fail = false;
    assert.equal(
      (
        await post(created.webshopId, 'local-a', {
          ...body,
          shop: 'other.myshopify.com',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post(created.webshopId, 'local-a', {
          ...body,
          clientSecret: 'updated',
        })
      ).status,
      200,
    );
    const status = await (
      await h.request(route(created.webshopId), { user: 'local-a' })
    ).json();
    assert.equal(status.integrations[0].provider, 'shopify');
    assert.doesNotMatch(JSON.stringify(status), /updated|synthetic-secret/);
  } finally {
    h.close();
  }
});

test('Tier 1 Dinero connects without a webshop and preserves the single company accounting identity', async () => {
  let fail = false;
  const h = harness(jose, async (url, opt) => {
    assert.equal(opt.redirect, 'manual');
    if (fail) return Response.json({}, { status: 401 });
    if (url.includes('/oauth/token'))
      return Response.json({ access_token: 'test' });
    assert.equal(opt.method || 'GET', 'GET');
    return Response.json([
      { AccountNumber: 1000, Name: 'Salg', VatCode: 'U25' },
    ]);
  });
  const env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    route = '/api/platform/tier1/shops/none/integrations',
    body = {
      provider: 'dinero',
      organizationId: '123',
      clientId: 'test',
      clientSecret: 'secret',
      apiKey: 'key',
    };
  const post = (user = 'local-a', data = body) =>
    h.request(route, { user, env, method: 'POST', body: data });
  try {
    assert.equal((await post('local-reader')).status, 403);
    const response = await post();
    assert.equal(response.status, 200, await response.clone().text());
    const saved = h.sql.prepare('SELECT * FROM accounting_connections').get();
    fail = true;
    assert.equal((await post()).status, 409);
    assert.deepEqual(
      h.sql.prepare('SELECT * FROM accounting_connections').get(),
      saved,
    );
    fail = false;
    assert.equal(
      (await post('local-a', { ...body, organizationId: '456' })).status,
      409,
    );
    assert.deepEqual(
      (await (await h.request(route, { user: 'local-b' })).json()).integrations,
      [],
    );
  } finally {
    h.close();
  }
});

test('Tier 1 selection and payment connections adapt account discovery, enforce roles and reject stale updates', async () => {
  const h = harness(jose, async (input, opt) => {
    const url = new URL(input);
    assert.equal(opt.redirect, 'manual');
    if (url.pathname.endsWith('/agreements'))
      return Response.json({
        agreements: [
          {
            id: 'agreement',
            merchantID: 'merchant',
            agreementNumber: '123',
            currency: 'DKK',
          },
        ],
      });
    if (url.pathname.endsWith('/accounts'))
      return Response.json({ accounts: [{ id: 'account-a', name: 'Test' }] });
    if (url.pathname.endsWith('/entries/download/JSON'))
      return Response.json({ entries: [] });
    throw Error('unexpected call');
  });
  const env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    base = '/api/platform/tier1/shops/shop-a1';
  const post = (path, body, user = 'local-a') =>
    h.request(base + path, { user, env, method: 'POST', body });
  try {
    const initial = await (
      await h.request(base + '/integrations/selection', { user: 'local-a' })
    ).json();
    assert.deepEqual(initial.selected, ['shopify', 'dinero']);
    assert.equal(
      (
        await post(
          '/integrations/selection',
          { provider: 'flatpay', action: 'add' },
          'local-reader',
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await post('/integrations/selection', {
          provider: 'flatpay',
          action: 'add',
        })
      ).status,
      200,
    );
    const body = {
      username: 'test',
      password: 'secret',
      agreementNumber: '123',
      startDate: '2026-01-01',
    };
    const discovery = await post('/flatpay/connection', {
      ...body,
      action: 'validate',
    });
    assert.equal(discovery.status, 200);
    assert.equal((await discovery.json()).agreements.length, 1);
    const saved = await post('/flatpay/connection', {
      ...body,
      action: 'save',
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    const status = await (
      await h.request(base + '/flatpay/connection', { user: 'local-a' })
    ).json();
    assert.equal(status.connected, true);
    assert.ok(status.revision);
    assert.doesNotMatch(JSON.stringify(status), /password|secret/);
    assert.equal(
      (
        await post('/flatpay/connection', {
          ...body,
          action: 'save',
          revision: 0,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post('/flatpay/connection', {
          ...body,
          action: 'save',
          revision: status.revision,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post('/integrations/selection', {
          provider: 'flatpay',
          action: 'remove',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post('/viabill/connection', {
          action: 'connect',
          apiKey: 'test',
          secret: 'secret',
          accountId: 'account-a',
          startDate: '2026-01-01',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request('/api/platform/tier1/shops/none/flatpay/connection', {
          user: 'local-a',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post('/integrations/selection', {
          provider: 'emballage',
          action: 'add',
        })
      ).status,
      200,
    );
  } finally {
    h.close();
  }
});

test('Emballage dev connection encrypts keys, explains upstream errors, limits report reads to own account and blocks submission', async () => {
  const calls = [];
  let failure = '';
  const h = harness(jose, async (url, opt) => {
    calls.push(url);
    assert.equal(opt.method, 'GET');
    assert.equal(opt.redirect, 'manual');
    if (url.endsWith('/me')) {
      if (failure === 'network') throw Error('offline');
      if (failure === 'auth')
        return Response.json(
          { code: 'authentication_failed' },
          { status: 401, headers: { 'X-Request-Id': 'safe-reference' } },
        );
      return Response.json({
        data: {
          organisation: {
            id: failure === 'wrong-account' ? 2 : 1,
            name: 'Test',
          },
          api_key: { is_test: true },
          responsibilities: [
            {
              code: 'packaging',
              status: 'active',
              product_area: { slug: 'packaging', name: 'Emballage' },
            },
          ],
        },
      });
    }
    if (url.includes('/reports?')) return Response.json({ data: [], meta: {} });
    throw Error('Unexpected report request');
  });
  const env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    base = '/api/platform/tier1/shops/shop-a1/emballage';
  try {
    const body = { action: 'connect', apiKey: 'synthetic-ei-key' };
    assert.equal(
      (
        await h.request(base + '/connection', {
          user: 'local-reader',
          env,
          method: 'POST',
          body,
        })
      ).status,
      403,
    );
    const response = await h.request(base + '/connection', {
      user: 'local-a',
      env,
      method: 'POST',
      body,
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).connected, true);
    assert.doesNotMatch(
      h.sql
        .prepare('SELECT credentials_encrypted FROM emballage_connections')
        .get().credentials_encrypted,
      /synthetic-ei-key/,
    );
    assert.equal(
      (
        await h.request(base + '/connection?reportId=77', {
          user: 'local-a',
          env,
        })
      ).status,
      404,
    );
    // Another webshop in the company can use the same organisation without the key passing through the browser.
    const other = '/api/platform/tier1/shops/shop-a2/emballage/connection';
    const before = await (
      await h.request(other, { user: 'local-a', env })
    ).json();
    assert.deepEqual(
      before.reusable.map((r) => r.id),
      ['shop-a1'],
    );
    assert.doesNotMatch(JSON.stringify(before), /synthetic-ei-key/);
    const reused = await h.request(other, {
      user: 'local-a',
      env,
      method: 'POST',
      body: { action: 'connect', copyFrom: 'shop-a1' },
    });
    assert.equal(reused.status, 200, await reused.clone().text());
    const after = await (
      await h.request(other, { user: 'local-a', env })
    ).json();
    assert.equal(after.connected, true);
    assert.deepEqual(after.reusable, []);
    assert.equal(after.sharedWith.length, 1);
    // Only company administrators see the company's other webshops.
    const admin = await (
      await h.request(base + '/connection', { user: 'local-a', env })
    ).json();
    assert.equal(admin.sharedWith.length, 1);
    const reader = await h.request(base + '/connection', {
      user: 'local-reader',
      env,
    });
    assert.equal(reader.status, 200, await reader.clone().text());
    assert.deepEqual((await reader.json()).sharedWith, []);
    assert.equal(
      h.sql
        .prepare(
          "SELECT identity FROM emballage_connections WHERE webshop_id='shop-a2'",
        )
        .get().identity,
      '1',
    );
    // A webshop in another company cannot borrow the connection.
    assert.equal(
      (
        await h.request(
          '/api/platform/tier1/shops/shop-b1/emballage/connection',
          {
            user: 'local-b',
            env,
            method: 'POST',
            body: { action: 'connect', copyFrom: 'shop-a1' },
          },
        )
      ).status,
      404,
    );
    h.sql
      .prepare("DELETE FROM emballage_connections WHERE webshop_id='shop-a2'")
      .run();
    assert.equal(
      (
        await h.request(base + '/reporting', {
          user: 'local-a',
          env,
          method: 'POST',
          body: { action: 'submit' },
        })
      ).status,
      403,
    );
    failure = 'auth';
    const auth = await h.request(base + '/connection', {
      user: 'local-a',
      env,
      method: 'POST',
      body,
    });
    assert.equal(auth.status, 409);
    assert.match(
      (await auth.json()).error,
      /API-nøglen blev afvist.*safe-reference.*bevaret/,
    );
    failure = 'network';
    const network = await h.request(base + '/connection', {
      user: 'local-a',
      env,
      method: 'POST',
      body,
    });
    assert.equal(network.status, 409);
    assert.match(
      (await network.json()).error,
      /kunne ikke kontrollere nøglen.*kunne ikke kontaktes.*bevaret/,
    );
    assert.equal(
      h.sql.prepare('SELECT identity FROM emballage_connections').get()
        .identity,
      '1',
    );
    failure = 'wrong-account';
    assert.equal(
      (
        await h.request(base + '/connection', {
          user: 'local-a',
          env,
          method: 'POST',
          body,
        })
      ).status,
      409,
    );
    assert.equal(
      (await h.request(base + '/connection', { user: 'local-b', env })).status,
      404,
    );
  } finally {
    h.close();
  }
});

test('first Emballage configuration automatically imports scoped Shopify history exactly once', async () => {
  const shopifyQueries = [];
  const h = harness(jose, async (url, opt) => {
    if (url.endsWith('/me'))
      return Response.json({
        data: {
          organisation: { id: 1, name: 'Test' },
          api_key: { is_test: true },
          responsibilities: [
            {
              code: 'packaging',
              status: 'active',
              product_area: { slug: 'packaging', name: 'Emballage' },
            },
          ],
        },
      });
    if (url.includes('emballageindberetning.dk/api/public/v1/reports?'))
      return Response.json({ data: [], meta: {} });
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'shopify-token' });
    const body = JSON.parse(opt.body);
    shopifyQueries.push(body);
    if (body.query.includes('PackagingHistoryAccess'))
      return Response.json({
        data: {
          currentAppInstallation: {
            accessScopes: [{ handle: 'read_all_orders' }],
          },
        },
      });
    if (body.query.includes('PackagingOrders'))
      return Response.json({
        data: {
          orders: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    throw Error('Unexpected request: ' + url);
  });
  const env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    base = '/api/platform/tier1/shops/shop-a1/emballage/connection';
  try {
    await testShopConnections(h, env);
    assert.equal(
      (
        await h.request(base, {
          user: 'local-a',
          env,
          method: 'POST',
          body: { action: 'connect', apiKey: 'synthetic-ei-key' },
        })
      ).status,
      200,
    );
    const start = new Date();
    start.setUTCMonth(start.getUTCMonth() - 3);
    start.setUTCDate(1);
    start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3);
    const startDate = start.toISOString().slice(0, 10);
    const body = {
      action: 'settings',
      config: { startDate, responsibility: 'packaging', mappings: {} },
    };
    const first = await h.request(base, {
      user: 'local-a',
      env,
      method: 'POST',
      body,
    });
    assert.equal(first.status, 200, await first.clone().text());
    assert.equal((await first.json()).initialHistory.count, 0);
    assert.equal(
      h.sql
        .prepare(
          'SELECT coverage_start FROM packaging_sync WHERE company_id=? AND webshop_id=?',
        )
        .get('company-a', 'shop-a1').coverage_start,
      startDate,
    );
    const imports = shopifyQueries.filter((x) =>
      x.query.includes('PackagingOrders'),
    ).length;
    assert.equal(imports, 1);
    const second = await h.request(base, {
      user: 'local-a',
      env,
      method: 'POST',
      body,
    });
    assert.equal(second.status, 200, await second.clone().text());
    assert.equal(
      shopifyQueries.filter((x) => x.query.includes('PackagingOrders')).length,
      imports,
    );
    assert.equal(
      h.sql
        .prepare(
          'SELECT count(*) n FROM packaging_sync WHERE company_id=? AND webshop_id=?',
        )
        .get('company-a', 'shop-a2').n,
      0,
    );
  } finally {
    h.close();
  }
});

test('onboarding dates are independent, scoped and never inferred from history', async () => {
  const h = harness();
  try {
    const base = '/api/platform/tier1/shops/shop-a1/integrations/start-date';
    let r = await h.request(base + '?provider=shopify', { user: 'local-a' });
    assert.equal((await r.json()).bookingStartDate, '');
    r = await h.request(base, {
      user: 'local-a',
      method: 'POST',
      body: {
        provider: 'shopify',
        startDate: '2020-01-01',
        bookingStartDate: '2030-01-01',
      },
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).bookingStartDate, '2030-01-01');
    r = await h.request(
      base.replace('shop-a1', 'shop-a2') + '?provider=shopify',
      { user: 'local-a' },
    );
    assert.equal((await r.json()).bookingStartDate, '');
    r = await h.request(base, {
      user: 'local-b',
      method: 'POST',
      body: {
        provider: 'shopify',
        startDate: '2020-01-01',
        bookingStartDate: '2026-01-01',
      },
    });
    assert.equal(r.status, 404);
    r = await h.request(base, {
      user: 'local-a',
      method: 'POST',
      body: {
        provider: 'shopify',
        startDate: '2020-01-01',
        bookingStartDate: '2026-02-30',
      },
    });
    assert.equal(r.status, 400);
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM accounting_reconciliations').get()
        .n,
      0,
    );
  } finally {
    h.close();
  }
});

test('Dinero reconciliation is explicit, read-only, tenant scoped and immutable', async () => {
  const calls = [],
    guid = '11111111-1111-4111-8111-111111111111';
  let status = 'Booked',
    timestamp = 'v1';
  const h = harness(jose, async (url, options) => {
    calls.push([String(url), options.method]);
    if (String(url).includes('/oauth/token'))
      return Response.json({ access_token: 'synthetic' });
    assert.equal(options.method, 'GET');
    assert.equal(
      String(url),
      'https://api.dinero.dk/v1/123/vouchers/manuel/' + guid,
    );
    return Response.json({
      Guid: guid,
      Status: status,
      Timestamp: timestamp,
      VoucherDate: '2026-09-01',
      VoucherNumber: 17,
      ExternalReference: 'example:order:123',
      Lines: [
        { Description: 'Order 123', AmountInclVatValue: 125, Currency: 'DKK' },
      ],
    });
  });
  try {
    const env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) };
    const encrypted = await loader()('platform/connections.ts').seal(
      { ...h.env, ...env },
      ['company-a', 'dinero', '123'],
      {
        organizationId: '123',
        clientId: 'test',
        clientSecret: 'test',
        apiKey: 'test',
      },
    );
    h.sql
      .prepare(
        'INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)',
      )
      .run('company-a', '123', encrypted, 'r1', '[]');
    const payload = JSON.stringify({
      id: 'gid://shopify/Order/123',
      name: '#123',
      createdAt: '2026-09-01T12:00:00Z',
      currentTotalPriceSet: {
        shopMoney: { amount: '125.00', currencyCode: 'DKK' },
      },
    });
    for (const shop of ['shop-a1', 'shop-a2'])
      h.sql
        .prepare(
          'INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)',
        )
        .run(
          'company-a',
          shop,
          'orders',
          'gid://shopify/Order/123',
          '2026-09-01T12:00:00Z',
          payload,
        );
    const path =
      '/api/platform/tier1/shops/shop-a1/integrations/reconciliation';
    const body = {
      action: 'preview',
      provider: 'shopify',
      module: 'orders',
      externalId: 'gid://shopify/Order/123',
      guid,
    };
    const request = (b, user = 'local-a', p = path) =>
      h.request(p, { user, method: 'POST', env, body: b });
    assert.equal((await request(body, 'local-b')).status, 404);
    assert.equal((await request(body, 'local-reader')).status, 403);
    assert.equal(calls.length, 0);
    status = 'Draft';
    const draft = await (await request(body)).json();
    assert.equal(
      (
        await request({
          ...body,
          action: 'confirm',
          confirmation: draft.confirmation,
          confirmMatch: true,
        })
      ).status,
      409,
    );
    status = 'Booked';
    let r = await request(body);
    assert.equal(r.status, 200, await r.clone().text());
    let preview = await r.json();
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM accounting_reconciliations').get()
        .n,
      0,
    );
    assert.equal(
      (
        await request(
          {
            ...body,
            action: 'confirm',
            confirmation: preview.confirmation,
            confirmMatch: true,
          },
          'local-a',
          path.replace('shop-a1', 'shop-a2'),
        )
      ).status,
      409,
    );
    timestamp = 'v2';
    assert.equal(
      (
        await request({
          ...body,
          action: 'confirm',
          confirmation: preview.confirmation,
          confirmMatch: true,
        })
      ).status,
      409,
    );
    r = await request(body);
    preview = await r.json();
    h.sql
      .prepare(
        "UPDATE operation_snapshots SET payload_json=? WHERE webshop_id='shop-a1'",
      )
      .run('{"changed":true}');
    assert.equal(
      (
        await request({
          ...body,
          action: 'confirm',
          confirmation: preview.confirmation,
          confirmMatch: true,
        })
      ).status,
      409,
    );
    h.sql
      .prepare(
        "UPDATE operation_snapshots SET payload_json=? WHERE webshop_id='shop-a1'",
      )
      .run(payload);
    h.sql.exec("UPDATE accounting_connections SET revision='r2'");
    assert.equal(
      (
        await request({
          ...body,
          action: 'confirm',
          confirmation: preview.confirmation,
          confirmMatch: true,
        })
      ).status,
      409,
    );
    r = await request(body);
    preview = await r.json();
    r = await request({
      ...body,
      action: 'confirm',
      confirmation: preview.confirmation,
      confirmMatch: true,
    });
    assert.equal(r.status, 200, await r.clone().text());
    r = await request({
      ...body,
      action: 'confirm',
      confirmation: preview.confirmation,
      confirmMatch: true,
    });
    assert.equal(r.status, 409);
    const second = await (
      await request(body, 'local-a', path.replace('shop-a1', 'shop-a2'))
    ).json();
    r = await request(
      {
        ...body,
        action: 'confirm',
        confirmation: second.confirmation,
        confirmMatch: true,
      },
      'local-a',
      path.replace('shop-a1', 'shop-a2'),
    );
    assert.equal(r.status, 409);
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM accounting_reconciliations').get()
        .n,
      1,
    );
    const statusFor = await loader({ jose })(
      'platform/booking-onboarding.ts',
    ).bookingStatuses(h.env, 'company-a', 'shop-a1');
    assert.equal(
      statusFor('shopify', 'orders', body.externalId, '2026-09-01', payload),
      'booked',
    );
    assert.equal(
      statusFor('shopify', 'orders', body.externalId, '2026-09-01', 'changed'),
      'booked_changed',
    );
    const other = await loader({ jose })(
      'platform/booking-onboarding.ts',
    ).bookingStatuses(h.env, 'company-a', 'shop-a2');
    assert.equal(
      other('shopify', 'orders', body.externalId, '2026-09-01', payload),
      'setup_required',
    );
    assert.ok(
      calls.every(
        ([url, method]) => method === 'GET' || url.endsWith('/oauth/token'),
      ),
    );
  } finally {
    h.close();
  }
});

test('webshop sync: stock goes both ways with compare-and-set, and a write without a certain answer is resolved first', () => {
  const { stockStep, resolvePending } = loader()(
    'platform/shop-sync-calculations.ts',
  );
  // First link: the target gets the source's quantity.
  assert.deepEqual(stockStep(null, 5, 0), {
    sold: 0,
    sourceTo: null,
    targetTo: 5,
    next: 5,
  });
  // The target sold 2 (5 → 3) and the source sold 1 (5 → 4): both end at 2.
  assert.deepEqual(stockStep(5, 4, 3), {
    sold: 2,
    sourceTo: 2,
    targetTo: 2,
    next: 2,
  });
  // A return in the target (2 → 3) goes back to the source.
  assert.deepEqual(stockStep(2, 2, 3), {
    sold: -1,
    sourceTo: 3,
    targetTo: null,
    next: 3,
  });
  assert.deepEqual(stockStep(3, 3, 3), {
    sold: 0,
    sourceTo: null,
    targetTo: null,
    next: 3,
  });
  const pending = { side: 'source', from: 4, to: 2, last: 3, key: 'k' };
  assert.equal(resolvePending(pending, 2), 'applied');
  assert.equal(resolvePending(pending, 4), 'not-applied');
  assert.equal(resolvePending(pending, 1), 'unknown');
});

test('webshop sync: creates products and collections in the target, syncs stock, leaves the copies out of the inventory value and only writes in production', async () => {
  const shops = {
    source: 'shop-a1.myshopify.com',
    target: 'shop-a2.myshopify.com',
  };
  const loc = {
    source: 'gid://shopify/Location/1',
    target: 'gid://shopify/Location/2',
  };
  const stock = { source: 5, target: 0 };
  const calls = [];
  let created = null,
    inCollection = false,
    lose = false,
    edit = {},
    sourceMembers = ['gid://shopify/Product/10'];
  const product = () => ({
    id: 'gid://shopify/Product/10',
    handle: 'kop',
    title: 'Kop',
    descriptionHtml: '<p>Kop</p>',
    vendor: 'LA',
    productType: 'Køkken',
    tags: ['nyhed'],
    status: 'ACTIVE',
    category: null,
    seo: { title: null, description: null },
    options: [
      { name: 'Title', position: 1, optionValues: [{ name: 'Default Title' }] },
    ],
    media: {
      nodes: [{ image: { url: 'https://cdn.test/kop.jpg', altText: 'Kop' } }],
    },
    variants: {
      nodes: [
        {
          id: 'gid://shopify/ProductVariant/11',
          sku: 'KOP',
          barcode: null,
          price: '99.00',
          compareAtPrice: null,
          inventoryPolicy: 'DENY',
          taxable: true,
          selectedOptions: [{ name: 'Title', value: 'Default Title' }],
          inventoryItem: {
            id: 'gid://shopify/InventoryItem/12',
            tracked: true,
            requiresShipping: true,
            unitCost: { amount: '40.00' },
            measurement: { weight: { unit: 'GRAMS', value: 300 } },
            inventoryLevel: {
              quantities: [{ name: 'available', quantity: stock.source }],
            },
          },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    weight: { value: '25' },
    reportable: { value: 'true' },
    ...edit,
  });
  const targetVariants = () => ({
    nodes: [
      {
        id: 'gid://shopify/ProductVariant/21',
        selectedOptions: [{ name: 'Title', value: 'Default Title' }],
        inventoryItem: {
          id: 'gid://shopify/InventoryItem/22',
          inventoryLevel: {
            quantities: [{ name: 'available', quantity: stock.target }],
          },
        },
      },
    ],
  });
  const network = async (url, options) => {
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'synthetic' });
    const host = new URL(url).hostname,
      side = host === shops.source ? 'source' : 'target',
      { query, variables } = JSON.parse(options.body),
      name = query.match(/^\s*(?:query|mutation) (\w+)/)[1];
    calls.push([side, name, variables]);
    if (/^\s*mutation/.test(query) && side === 'source')
      assert.equal(name, 'SyncStock', 'the source only gets stock changes');
    if (name === 'SyncShop')
      return Response.json({ data: { shop: { currencyCode: 'DKK' } } });
    if (name === 'SyncCollection')
      return Response.json({
        data: {
          collection: {
            id: 'gid://shopify/Collection/30',
            handle: 'koekken',
            title: 'Køkken',
            descriptionHtml: '',
            image: null,
            products: {
              nodes: sourceMembers.map((id) => ({ id })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    if (name === 'SyncProducts') {
      assert.equal(variables.location, loc.source);
      return Response.json({ data: { nodes: [product()] } });
    }
    if (name === 'SyncTargets') {
      assert.equal(variables.location, loc.target);
      return Response.json({
        data: {
          nodes: created
            ? [{ id: created, variants: targetVariants() }]
            : [null],
        },
      });
    }
    if (name === 'SyncCreate') {
      const input = variables.input;
      assert.ok(input.tags.includes('wtb-sync-10'));
      assert.equal(input.handle, 'kop');
      assert.equal(input.files.length, 1);
      assert.deepEqual(
        input.metafields.map((m) => [m.key, m.value]),
        [
          ['synkroniseret_fra', 'Webshop A1'],
          ['emballage_vaegt_gram', '25'],
          ['emballage_indberetning', 'true'],
        ],
      );
      assert.equal(input.variants[0].price, '99.00');
      assert.deepEqual(input.variants[0].inventoryQuantities, [
        { locationId: loc.target, name: 'available', quantity: 5 },
      ]);
      created = 'gid://shopify/Product/20';
      stock.target = 5;
      return Response.json({
        data: {
          productSet: {
            product: { id: created, variants: targetVariants() },
            userErrors: [],
          },
        },
      });
    }
    if (name === 'SyncUpdate') {
      assert.equal(variables.identifier.id, created);
      assert.ok(
        !('metafields' in variables.input),
        "productSet would replace the target's own metafields",
      );
      assert.ok('category' in variables.input, 'a removed category is cleared');
      assert.equal(variables.input.category, null);
      return Response.json({
        data: {
          productSet: {
            product: { id: created, variants: targetVariants() },
            userErrors: [],
          },
        },
      });
    }
    if (name === 'SyncMetafields' || name === 'SyncMetafieldsRemove') {
      assert.ok(variables.metafields.every((m) => m.ownerId === created));
      return Response.json({
        data:
          name === 'SyncMetafields'
            ? { metafieldsSet: { metafields: [], userErrors: [] } }
            : { metafieldsDelete: { deletedMetafields: [], userErrors: [] } },
      });
    }
    if (name === 'SyncCollectionRemove') {
      assert.deepEqual(variables.productIds, [created]);
      inCollection = false;
      return Response.json({
        data: {
          collectionRemoveProducts: { job: { id: 'job' }, userErrors: [] },
        },
      });
    }
    if (name === 'SyncStock') {
      const q = variables.input.quantities[0];
      assert.equal(variables.input.name, 'available');
      assert.equal(q.locationId, loc[side]);
      assert.equal(q.changeFromQuantity, stock[side], 'compare-and-set');
      stock[side] = q.quantity;
      if (lose) throw Error('connection lost');
      return Response.json({
        data: {
          inventorySetQuantities: {
            inventoryAdjustmentGroup: { createdAt: 'now' },
            userErrors: [],
          },
        },
      });
    }
    if (name === 'SyncCollectionHandle')
      return Response.json({ data: { collectionByIdentifier: null } });
    if (name === 'SyncCollectionCreate')
      return Response.json({
        data: {
          collectionCreate: {
            collection: { id: 'gid://shopify/Collection/40' },
            userErrors: [],
          },
        },
      });
    if (name === 'SyncTargetCollection')
      return Response.json({
        data: {
          collection: {
            products: {
              nodes: inCollection ? [{ id: created }] : [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    if (name === 'SyncCollectionAdd') {
      assert.deepEqual(variables.productIds, [created]);
      inCollection = true;
      return Response.json({
        data: {
          collectionAddProducts: {
            collection: { id: variables.id },
            userErrors: [],
          },
        },
      });
    }
    if (name === 'InventoryAccess')
      return Response.json({
        data: { currentAppInstallation: { accessScopes: [] } },
      });
    if (name === 'InventoryStatus')
      return Response.json({
        data: {
          inventoryItems: {
            nodes: [
              ['22', created, 'Kop', stock.target],
              ['23', 'gid://shopify/Product/50', 'Egen vare', 2],
            ].map(([id, productId, title, quantity]) => ({
              id: 'gid://shopify/InventoryItem/' + id,
              tracked: true,
              unitCost: { amount: '40.00', currencyCode: 'DKK' },
              variant: {
                title: 'Default Title',
                sku: '',
                product: { id: productId, title, status: 'ACTIVE' },
              },
              inventoryLevels: {
                nodes: [
                  {
                    location: { id: loc.target },
                    quantities: [{ name: 'on_hand', quantity }],
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    throw Error('Unexpected Shopify call ' + name);
  };
  const h = harness(jose, network);
  try {
    // Credentials are sealed for the environment they are used in.
    const keys = {
      PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32),
      PLATFORM_ENV: 'production',
    };
    await testShopConnections(h, keys);
    h.sql
      .exec(`INSERT INTO custom_apps(app_id,company_id,enabled_by) VALUES('webshop-sync','company-a','local-admin');
      INSERT INTO shop_sync_settings(company_id,source_webshop_id,target_webshop_id,source_location_id,target_location_id,interval_minutes,enabled,selection_json,revision,updated_by)
      VALUES('company-a','shop-a1','shop-a2','${loc.source}','${loc.target}',15,1,'{"collections":[{"id":"gid://shopify/Collection/30","title":"Køkken"}],"products":[]}','r1','local-a')`);
    const load = loader({ jose, fetch: network });
    const sync = load('platform/shop-sync.ts'),
      { readInventory } = load('platform/inventory-source.ts');
    const production = {
        ...h.env,
        ...keys,
        PLATFORM_EXTERNAL_WRITES: 'enabled',
      },
      // Production without external writes: a run only says what it would do (as everywhere else).
      readOnly = { ...h.env, ...keys };
    const mutations = () =>
      calls.filter(([, n]) =>
        /^Sync(Create|Update|Stock|Metafields|MetafieldsRemove|Collection(Create|Add|Remove)|Draft)$/.test(
          n,
        ),
      );
    const due = () =>
      h.sql.exec(
        "UPDATE shop_sync_settings SET next_run_at=0 WHERE company_id='company-a'",
      );

    // Outside production a run only says what it would do.
    const dry = await sync.syncCompany(readOnly, 'company-a', true);
    assert.equal(dry.created, 1);
    assert.match(dry.actions.join('\n'), /Opretter "Kop"/);
    assert.equal(mutations().length, 0);
    assert.equal(await sync.runDueShopSyncs(readOnly), 0);
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM shop_sync_products').get().n,
      0,
    );

    // First run: product and collection are created, and the product is put in the collection.
    assert.equal(await sync.runDueShopSyncs(production), 1);
    assert.deepEqual(
      mutations().map(([side, n]) => side + ':' + n),
      [
        'target:SyncCreate',
        'target:SyncCollectionCreate',
        'target:SyncCollectionAdd',
      ],
    );
    assert.deepEqual(
      {
        ...h.sql
          .prepare('SELECT state,target_product_id FROM shop_sync_products')
          .get(),
      },
      { state: 'linked', target_product_id: created },
    );
    assert.equal(
      h.sql.prepare('SELECT last_quantity FROM shop_sync_variants').get()
        .last_quantity,
      5,
    );
    // Not due yet: nothing runs.
    assert.equal(await sync.runDueShopSyncs(production), 0);

    // The target sold 2 and the source sold 1: the source pays for the target's sale, and both end at 2.
    stock.target = 3;
    stock.source = 4;
    calls.length = 0;
    due();
    await sync.runDueShopSyncs(production);
    assert.deepEqual(
      mutations().map(([side, n]) => side + ':' + n),
      ['source:SyncStock', 'target:SyncStock'],
      'unchanged product data is not sent again',
    );
    assert.deepEqual(stock, { source: 2, target: 2 });

    // A stock write without an answer is kept as pending and resolved from the quantity before anything is sent.
    stock.target = 1;
    lose = true;
    calls.length = 0;
    due();
    await sync.runDueShopSyncs(production);
    assert.deepEqual(stock, { source: 1, target: 1 - 0 });
    assert.equal(mutations().length, 1);
    assert.ok(
      h.sql.prepare('SELECT pending_json FROM shop_sync_variants').get()
        .pending_json,
    );
    lose = false;
    calls.length = 0;
    due();
    await sync.runDueShopSyncs(production);
    assert.equal(mutations().length, 0, 'the applied write is not sent again');
    assert.deepEqual(
      {
        ...h.sql
          .prepare(
            'SELECT last_quantity,pending_json,state FROM shop_sync_variants',
          )
          .get(),
      },
      { last_quantity: 1, pending_json: null, state: 'ok' },
    );
    calls.length = 0;
    due();
    await sync.runDueShopSyncs(production);
    assert.equal(mutations().length, 0);
    assert.deepEqual(
      stock,
      { source: 1, target: 1 },
      'the sale was taken once',
    );

    // A changed product is sent again. The sync's metafields are written on their own (productSet would delete the
    // target's other metafields), and a packaging field emptied in the source is removed.
    edit = { title: 'Kop 2', reportable: null };
    calls.length = 0;
    due();
    await sync.runDueShopSyncs(production);
    assert.deepEqual(
      mutations().map(([side, n, v]) => [
        side + ':' + n,
        (v.metafields ?? []).map((m) => m.key),
      ]),
      [
        ['target:SyncUpdate', []],
        [
          'target:SyncMetafields',
          ['synkroniseret_fra', 'emballage_vaegt_gram'],
        ],
        ['target:SyncMetafieldsRemove', ['emballage_indberetning']],
      ],
    );
    edit = {};

    // A product that leaves the source collection leaves the target collection, even while it is still chosen.
    h.sql.exec(
      `UPDATE shop_sync_settings SET selection_json='{"collections":[{"id":"gid://shopify/Collection/30","title":"Køkken"}],"products":[{"id":"gid://shopify/Product/10","title":"Kop"}]}'`,
    );
    sourceMembers = [];
    calls.length = 0;
    due();
    await sync.runDueShopSyncs(production);
    assert.deepEqual(
      mutations().map(([side, n]) => side + ':' + n),
      [
        'target:SyncUpdate',
        'target:SyncMetafields',
        'target:SyncCollectionRemove',
      ],
    );
    assert.equal(inCollection, false);

    // The copy in the target is shown on Lager but not counted in its value.
    const inventory = await readInventory(readOnly, 'company-a', 'shop-a2');
    assert.deepEqual(
      inventory.rows.map((r) => r.product),
      ['Egen vare'],
    );
    assert.equal(inventory.totalValueMinor, 2 * 4000);
    assert.deepEqual(
      inventory.synced.map((r) => [r.product, r.from]),
      [['Kop', 'Webshop A1']],
    );

    // The portal: company A reaches the app, company B does not, and only a company administrator saves.
    const settings = await h.request(
      '/api/platform/tier1/shops/shop-a1/custom-apps/webshop-sync/settings',
      { user: 'local-a' },
    );
    assert.equal(settings.status, 200);
    assert.equal((await settings.json()).settings.sourceWebshopId, 'shop-a1');
    // A reader of only one of the two webshops sees neither the setup nor the synced products.
    for (const part of ['settings', 'status'])
      assert.equal(
        (
          await h.request(
            `/api/platform/tier1/shops/shop-a1/custom-apps/webshop-sync/${part}`,
            { user: 'local-reader' },
          )
        ).status,
        403,
      );
    assert.equal(
      (
        await h.request(
          '/api/platform/tier1/shops/shop-b1/custom-apps/webshop-sync/settings',
          { user: 'local-b' },
        )
      ).status,
      404,
    );
    const save = (user, body) =>
      h.request(
        '/api/platform/tier1/shops/shop-a1/custom-apps/webshop-sync/settings',
        { user, method: 'PUT', body },
      );
    const body = {
      sourceWebshopId: 'shop-a1',
      targetWebshopId: 'shop-a2',
      sourceLocationId: loc.source,
      targetLocationId: loc.target,
      intervalMinutes: 60,
      enabled: true,
      selection: { collections: [], products: [] },
      revision: 'r1',
    };
    assert.equal((await save('local-reader', body)).status, 403);
    assert.equal(
      (await save('local-a', { ...body, targetWebshopId: 'shop-a1' })).status,
      400,
    );
    assert.equal(
      (await save('local-a', { ...body, targetWebshopId: 'shop-b1' })).status,
      404,
    );
    assert.equal(
      (await save('local-a', { ...body, revision: 'old' })).status,
      409,
    );
    const saved = await save('local-a', body);
    assert.equal(saved.status, 200, await saved.clone().text());

    // No longer chosen: the copy is set to draft in the target, nothing is deleted.
    const removed = await sync.syncCompany(readOnly, 'company-a', true);
    assert.equal(removed.removed, 1);
    assert.match(removed.actions.join('\n'), /Sætter "Kop" til kladde/);
  } finally {
    h.close();
  }
});
