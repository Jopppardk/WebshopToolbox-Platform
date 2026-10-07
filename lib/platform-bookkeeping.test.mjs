// Bookkeeping: receipts, sales, payouts, refunds, reconciliation and the production scheduler.
import {
  test,
  assert,
  jose,
  pdfLib,
  loader,
  harness,
  testShopConnections,
  productionSaleHarness,
  domesticMarkets,
  refundMoney,
  shopifyRefund,
} from './platform-harness.mjs';

test('Flatpay payout reports are listed and generated from the same checked Flatpay source as bookkeeping', async () => {
  const h = harness();
  try {
    const payment = {
      paymentID: '12345',
      merchantID: 'm',
      agreementNumber: '11',
      paidDate: '2026-09-03T00:00:00',
      currency: 'DKK',
      payoutAmount: 98,
      settlements: '56789',
    };
    const settlement = {
      settlementNumber: '56789',
      merchantID: 'm',
      agreementNumber: '11',
      currency: 'DKK',
      transactions: '1',
      grossPurchase: 100,
      grossSettlement: 100,
      netPurchase: 100,
      netSettlement: 98,
      payout: 98,
      feeAmount: 2,
      deduction: 2,
      refundAmount: 0,
      chargeback: 0,
      rollingReserve: 0,
      rollingRelease: 0,
      addedSum: 0,
      deductedSum: 0,
    };
    const tx = {
      transactionID: '9',
      settlementNumber: '56789',
      merchantID: 'm',
      agreementID: 'a',
      purchaseDate: '2026-09-02',
      transactionCode: 'Purchase',
      currency: 'DKK',
      grossAmount: 100,
      fees: 2,
      netAmount: 98,
    };
    h.sql
      .prepare(
        "INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES('company-a','shop-a1','flatpay','f','{\"merchantID\":\"m\",\"agreementNumber\":\"11\",\"agreementId\":\"a\"}','x','2026-09-01')",
      )
      .run();
    const record = h.sql.prepare(
      "INSERT INTO payment_records(company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json,paid) VALUES('company-a','shop-a1','flatpay','payments',?,?,?,?)",
    );
    record.run('12345', '2026-09-03', JSON.stringify(payment), 1);
    record.run(
      '99999',
      '2026-10-01',
      JSON.stringify({ ...payment, paymentID: '99999', paidDate: null }),
      0,
    );
    const objects = new Map(),
      env = {
        ...h.env,
        PLATFORM_DOCUMENTS: {
          put: async (k, b) => objects.set(k, b),
          get: async (k) => (objects.has(k) ? { body: objects.get(k) } : null),
        },
      };
    const reads = [];
    const { handleDocuments } = loader({
      jose,
      'pdf-lib': pdfLib,
      './connections': {
        unseal: async () => ({ username: 'u', password: 'p' }),
      },
      './flatpay-read': {
        flatpayRead: async (c, resource, q) => {
          reads.push([resource, q.SettlementNumber]);
          return resource === 'payments'
            ? [payment]
            : resource === 'settlements'
              ? [settlement]
              : [tx];
        },
      },
    })('platform/documents.ts');
    const post = (externalId) =>
      handleDocuments(
        new Request('https://portal.test/x', {
          method: 'POST',
          headers: {
            origin: 'https://portal.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ externalId }),
        }),
        env,
        {
          id: 'local-a',
          email: 'a@example.test',
          platformAdmin: false,
          fullName: 'A',
        },
        'company-a',
        'shop-a1',
      );
    const list = async () =>
      (
        await (
          await h.request('/api/platform/tier1/shops/shop-a1/documents', {
            user: 'local-a',
          })
        ).json()
      ).documents.filter((d) => d.provider === 'flatpay');
    assert.deepEqual(
      (await list()).map((d) => [d.externalId, d.amount.amount, d.ready]),
      [['flatpay:12345', '98', false]],
    );
    await assert.rejects(() => post('flatpay:99999'), /Kun gennemførte/);
    await assert.rejects(() => post('flatpay:abc'), /Vælg en udbetaling/);
    const r = await post('flatpay:12345');
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(
      reads.map((x) => x.join(':')),
      ['payments:56789', 'settlements:56789', 'transactions:56789'],
    );
    assert.ok(
      (
        await pdfLib.PDFDocument.load([...objects.values()][0])
      ).getPageCount() >= 1,
    );
    assert.deepEqual(
      (await list()).map((d) => d.ready),
      [true],
    );
    assert.equal((await (await post('flatpay:12345')).json()).existing, true);
    settlement.merchantID = 'other';
    h.sql.prepare('DELETE FROM platform_payout_documents').run();
    await assert.rejects(() => post('flatpay:12345'), /afstemmes entydigt/);
  } finally {
    h.close();
  }
});

test('payout documents reconcile transactions, scope PDFs and preserve generation claims', async () => {
  const payoutId = 'gid://shopify/ShopifyPaymentsPayout/77';
  const { payoutSummaryFields } = loader()('platform/payout-calculations.ts');
  const summary = Object.fromEntries(
    payoutSummaryFields.map((f) => [
      f,
      { amount: '0.00', currencyCode: 'DKK' },
    ]),
  );
  summary.chargesGross.amount = '100.00';
  summary.chargesFee.amount = '2.00';
  const source = {
    id: payoutId,
    issuedAt: '2026-09-01T12:00:00Z',
    status: 'PAID',
    transactionType: 'DEPOSIT',
    net: { amount: '98.00', currencyCode: 'DKK' },
    summary,
  };
  let mismatch = false,
    failStore = false;
  const h = harness(jose, async (url, opt) => {
    assert.equal(opt.redirect, 'manual');
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'fixture' });
    if (url.includes('/balance/transactions.json'))
      return Response.json({
        transactions: [
          {
            id: 1,
            type: 'charge',
            test: false,
            payout_id: 77,
            currency: 'DKK',
            amount: '100.00',
            fee: '2.00',
            net: mismatch ? '97.00' : '98.00',
            source_type: 'charge',
            source_order_id: 42,
            processed_at: '2026-09-01T08:00:00Z',
          },
        ],
      });
    assert.doesNotMatch(JSON.parse(opt.body).query, /mutation/);
    return Response.json({
      data: { nodes: [{ id: 'gid://shopify/Order/42', name: '#42' }] },
    });
  });
  const objects = new Map(),
    env = {
      ...h.env,
      PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32),
      PLATFORM_DOCUMENTS: {
        put: async (k, b) => {
          if (failStore) throw Error('failed');
          objects.set(k, b);
        },
        get: async (k) => (objects.has(k) ? { body: objects.get(k) } : null),
      },
    };
  try {
    const { seal } = loader()('platform/connections.ts');
    for (const shop of ['shop-a1', 'shop-a2']) {
      const domain = shop + '.myshopify.com';
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
            clientId: 'test',
            clientSecret: 'secret',
          }),
        );
      h.sql
        .prepare(
          'INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)',
        )
        .run(
          'company-a',
          shop,
          'payouts',
          payoutId,
          source.issuedAt,
          JSON.stringify(source),
        );
    }
    const base = (shop) =>
      '/api/platform/companies/company-a/webshops/' + shop + '/documents';
    mismatch = true;
    assert.equal(
      (
        await h.request(base('shop-a1'), {
          env,
          user: 'local-a',
          method: 'POST',
          body: { externalId: payoutId },
        })
      ).status,
      409,
    );
    assert.equal(objects.size, 0);
    mismatch = false;
    const generated = await h.request(base('shop-a1'), {
      env,
      user: 'local-a',
      method: 'POST',
      body: { externalId: payoutId },
    });
    assert.equal(generated.status, 200, await generated.clone().text());
    const { id } = await generated.json();
    assert.equal(
      (await pdfLib.PDFDocument.load([...objects.values()][0])).getPageCount(),
      2,
    );
    assert.ok(
      [...objects.keys()][0].startsWith(
        'companies/company-a/webshops/shop-a1/',
      ),
    );
    assert.equal(
      (await h.request(base('shop-a1') + '?id=' + id, { env, user: 'local-b' }))
        .status,
      403,
    );
    assert.equal(
      (await h.request(base('shop-a2') + '?id=' + id, { env, user: 'local-a' }))
        .status,
      404,
    );
    assert.equal(
      (
        await h.request(base('shop-a1') + '?id=' + id, {
          env,
          user: 'local-reader',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await (
          await h.request(base('shop-a1'), {
            env,
            user: 'local-a',
            method: 'POST',
            body: { externalId: payoutId },
          })
        ).json()
      ).existing,
      true,
    );
    failStore = true;
    assert.equal(
      (
        await h.request(base('shop-a2'), {
          env,
          user: 'local-a',
          method: 'POST',
          body: { externalId: payoutId },
        })
      ).status,
      500,
    );
    assert.equal(
      (
        await h.request(base('shop-a2'), {
          env,
          user: 'local-a',
          method: 'POST',
          body: { externalId: payoutId },
        })
      ).status,
      409,
    );
  } finally {
    h.close();
  }
});

test('refund and payout overviews page by the requested size up to 100', async () => {
  const h = harness(),
    base = '/api/platform/tier1/shops/shop-a1';
  try {
    const put = h.sql.prepare(
      "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','payouts',?,?,?)",
    );
    for (let i = 0; i < 30; i++) {
      const id = 'gid://shopify/ShopifyPaymentsPayout/' + (i + 1),
        at = new Date(Date.UTC(2026, 8, 1, 12, i)).toISOString();
      put.run(
        id,
        at,
        JSON.stringify({
          id,
          issuedAt: at,
          status: 'PAID',
          net: { amount: '10.00', currencyCode: 'DKK' },
        }),
      );
    }
    const page = async (q) =>
      (
        await h.request(base + '/payouts/overview' + q, { user: 'local-a' })
      ).json();
    let d = await page('?limit=25');
    assert.equal(d.total, 30);
    assert.equal(d.payouts.length, 25);
    d = await page('?limit=25&offset=25');
    assert.equal(d.payouts.length, 5);
    assert.equal((await page('')).payouts.length, 30);
    for (const q of ['?limit=101', '?limit=-1'])
      assert.equal(
        (await h.request(base + '/payouts/overview' + q, { user: 'local-a' }))
          .status,
        400,
      );
    assert.equal(
      (
        await h.request(base + '/refunds/overview?limit=25', {
          user: 'local-a',
        })
      ).status,
      200,
    );
  } finally {
    h.close();
  }
});

test('booking boundaries use Danish event dates and receipts override changed dates', () => {
  const { onboardingStatus: status } = loader({ jose })(
    'platform/booking-onboarding.ts',
  );
  assert.equal(
    status('2026-03-28T22:59:59Z', '2026-03-29', '2026-03-29'),
    'historical',
  );
  assert.equal(
    status('2026-03-28T23:00:00Z', '2026-03-29', '2026-03-29'),
    'reconciliation_required',
  );
  assert.equal(
    status('2026-03-29T22:00:00Z', '2026-03-30', '2026-03-30'),
    'reconciliation_required',
  );
  assert.equal(status('2026-03-30', '2026-03-29', '2026-04-01'), 'historical');
  assert.equal(status('2026-03-30', '', '2026-04-01'), 'setup_required');
  assert.equal(
    status(
      '2020-01-01',
      '',
      '',
      { voucher_status: 'Booked', source_json: 'same' },
      'same',
    ),
    'booked',
  );
  assert.equal(
    status(
      '2020-01-01',
      '',
      '',
      { voucher_status: 'Booked', source_json: 'same' },
      'changed',
    ),
    'booked_changed',
  );
  assert.equal(
    status(
      '2020-01-01',
      '',
      '',
      { voucher_status: 'Draft', source_json: 'same' },
      'same',
    ),
    'draft',
  );
  // A later sync that only adds or moves Shopify's updatedAt is not a changed post.
  const booked = JSON.stringify({
    id: 'gid://shopify/Order/1',
    name: '#1',
    currentTotalPriceSet: {
      shopMoney: { amount: '100.00', currencyCode: 'DKK' },
    },
  });
  const resynced = JSON.stringify({
    ...JSON.parse(booked),
    updatedAt: '2026-09-29T10:00:00Z',
  });
  assert.equal(
    status(
      '2020-01-01',
      '',
      '',
      { voucher_status: 'Booked', source_json: booked },
      resynced,
    ),
    'booked',
  );
  assert.equal(
    status(
      '2020-01-01',
      '',
      '',
      { voucher_status: 'Booked', source_json: booked },
      JSON.stringify({ ...JSON.parse(resynced), name: '#2' }),
    ),
    'booked_changed',
  );
});

test('production receipts serialize contenders, isolate tenants and never reopen uncertain or completed writes', async () => {
  const h = harness();
  try {
    const { saveReceipt, readReceipt } = loader()(
      'platform/production-receipts.ts',
    );
    const key = {
      company: 'company-a',
      shop: 'shop-a1',
      provider: 'shopify',
      module: 'orders',
      externalId: 'overlap',
      destination: '123',
    };
    const first = await saveReceipt(h.env, key, null, 'prepared', {
      amount: 100,
    });
    const races = await Promise.allSettled([
      saveReceipt(h.env, key, first, 'creating', { amount: 100 }),
      saveReceipt(h.env, key, first, 'creating', { amount: 100 }),
    ]);
    assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
    const current = await readReceipt(h.env, key);
    const uncertain = await saveReceipt(
      h.env,
      key,
      current,
      'uncertain',
      current.payload,
    );
    await assert.rejects(
      () => saveReceipt(h.env, key, uncertain, 'creating', {}),
      /genstartes/,
    );
    await assert.rejects(
      () => saveReceipt(h.env, key, null, 'prepared', {}),
      /allerede/,
    );
    const other = await saveReceipt(
      h.env,
      { ...key, shop: 'shop-a2' },
      null,
      'prepared',
      { amount: 200 },
    );
    assert.equal(other.payload.amount, 200);
    assert.equal((await readReceipt(h.env, key)).payload.amount, 100);
    const booked = await saveReceipt(h.env, key, uncertain, 'booked', {
      guid: 'verified',
    });
    await assert.rejects(
      () => saveReceipt(h.env, key, booked, 'prepared', {}),
      /genstartes/,
    );
  } finally {
    h.close();
  }
});

test('production sale books once, reuses verified receipt and rejects stale, test and historical attempts', async () => {
  const h = await productionSaleHarness();
  try {
    await assert.rejects(
      () => h.call('inspect', null, { PLATFORM_ENV: 'remote-test' }),
      /ikke aktiveret/,
    );
    const inspected = await (await h.call('inspect')).json();
    assert.equal(inspected.phase, 'prepared');
    assert.equal(h.posts, 0);
    await assert.rejects(() => h.call('retry', 'stale'), /godkend/);
    const results = await Promise.allSettled([
      h.call('retry', inspected.version),
      h.call('retry', inspected.version),
    ]);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(h.posts, 1);
    assert.equal(h.books, 1);
    assert.equal(h.receipt().phase, 'booked');
    h.changeOrder();
    assert.equal((await (await h.call('inspect')).json()).phase, 'booked');
    assert.equal(h.posts, 1);
  } finally {
    h.close();
  }
  const changed = await productionSaleHarness();
  try {
    const inspected = await (await changed.call('inspect')).json();
    changed.changeOrder();
    await assert.rejects(
      () => changed.call('retry', inspected.version),
      /faktura-PDF/,
    );
    assert.equal(changed.posts, 0);
  } finally {
    changed.close();
  }
  const historical = await productionSaleHarness();
  try {
    historical.sql
      .prepare("UPDATE booking_start_dates SET start_date='2026-09-10'")
      .run();
    await assert.rejects(() => historical.call('inspect'), /bogføringsperiode/);
    assert.equal(historical.posts, 0);
  } finally {
    historical.close();
  }
});

test('production sale never recreates uncertain create and recovers known booked GUID by reading', async () => {
  const lost = await productionSaleHarness();
  try {
    const inspected = await (await lost.call('inspect')).json();
    lost.failCreate();
    await assert.rejects(
      () => lost.call('retry', inspected.version),
      /uafklaret/,
    );
    assert.equal(lost.receipt().phase, 'uncertain');
    await assert.rejects(() => lost.call('inspect'), /uafklaret/);
    assert.equal(lost.posts, 1);
    assert.equal(lost.books, 0);
  } finally {
    lost.close();
  }
  const booked = await productionSaleHarness();
  try {
    const inspected = await (await booked.call('inspect')).json();
    booked.failBook();
    await assert.rejects(
      () => booked.call('retry', inspected.version),
      /uafklaret/,
    );
    assert.equal(booked.receipt().phase, 'uncertain');
    assert.equal((await (await booked.call('inspect')).json()).phase, 'booked');
    assert.equal(booked.posts, 1);
    assert.equal(booked.books, 1);
  } finally {
    booked.close();
  }
});

test('reconciliation and production claims cannot win for the same source, in either order', async () => {
  const h = harness();
  try {
    const { saveReceipt } = loader()('platform/production-receipts.ts');
    const key = {
      company: 'company-a',
      shop: 'shop-a1',
      provider: 'shopify',
      module: 'orders',
      externalId: '123',
      destination: '123',
    };
    const reconcile = (id) =>
      h.sql
        .prepare(
          "INSERT INTO accounting_reconciliations(company_id,webshop_id,provider,module,external_id,organization_id,voucher_guid,voucher_status,source_json,evidence_json,actor_id) VALUES(?,?,?,?,?,?,?,'Booked','{}','{}','local-a')",
        )
        .run(
          'company-a',
          'shop-a1',
          'shopify',
          'orders',
          id,
          '123',
          'guid-' + id,
        );
    const prepared = await saveReceipt(h.env, key, null, 'prepared', {});
    reconcile('123');
    await assert.rejects(
      () => saveReceipt(h.env, key, prepared, 'creating', {}),
      /afstemt/,
    );
    const other = { ...key, externalId: '456' },
      pending = await saveReceipt(h.env, other, null, 'prepared', {});
    await saveReceipt(h.env, other, pending, 'creating', {});
    assert.throws(() => reconcile('456'), /allerede/);
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM accounting_reconciliations').get()
        .n,
      1,
    );
  } finally {
    h.close();
  }
});

test('automatic sync picks up new and changed orders every run, walks payout history once, and needs only a Shopify connection', async () => {
  const h = harness();
  try {
    h.sql
      .prepare(
        "INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted,verified_at) VALUES('company-a','shop-a1','shopify','a1.myshopify.com','x',CURRENT_TIMESTAMP)",
      )
      .run();
    // No tier1_preferences row: the shop must still be synced.
    const orders = new Map(
      [1, 2, 3, 4, 5].map((n) => [n, `2026-09-2${n}T10:00:00Z`]),
    );
    const calls = [];
    const payoutPages = {
      null: { hasNextPage: true, endCursor: 'p2' },
      p2: { hasNextPage: true, endCursor: 'p3' },
      p3: { hasNextPage: false, endCursor: null },
    };
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './documents': { generatePayoutReport: async () => ({}) },
      './operations': {
        handleOperations: async (req, env, actor, company, shop, module) => {
          const b = await req.json();
          calls.push([shop, module, b.after, b.since]);
          if (module !== 'orders')
            return Response.json(
              module === 'payouts'
                ? payoutPages[b.after]
                : { hasNextPage: false, endCursor: null },
            );
          const rows = [...orders]
              .filter(([, u]) => u >= b.since)
              .sort((x, y) => x[1].localeCompare(y[1])),
            start = b.after ? Number(b.after) : 0,
            page = rows.slice(start, start + 2);
          return Response.json({
            count: page.length,
            hasNextPage: start + 2 < rows.length,
            endCursor: start + 2 < rows.length ? String(start + 2) : null,
            maxUpdatedAt:
              page
                .map((r) => r[1])
                .sort()
                .at(-1) ?? null,
            ids: page.map((r) => r[0]),
          });
        },
      },
    });
    const run = load('platform/production-jobs.ts').runProductionJobs,
      env = {
        ...h.env,
        PLATFORM_ENV: 'production',
        PLATFORM_EXTERNAL_WRITES: 'enabled',
      };
    const again = async () => {
      h.sql
        .prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'")
        .run();
      h.sql
        .prepare("DELETE FROM production_jobs WHERE job='pace.payouts'")
        .run();
      calls.length = 0;
      await run(env);
    };
    const orderCalls = () => calls.filter((c) => c[1] === 'orders'),
      state = (job) =>
        JSON.parse(
          h.sql
            .prepare(
              "SELECT cursor_json FROM production_jobs WHERE webshop_id='shop-a1' AND job=?",
            )
            .get(job).cursor_json,
        );
    await run(env);
    assert.ok(
      calls.every((c) => c[0] === 'shop-a1'),
      'shops without a Shopify connection are not imported',
    );
    assert.deepEqual(
      orderCalls().map((c) => [c[2], c[3]]),
      [
        [null, '2000-01-01T00:00:00Z'],
        ['2', '2000-01-01T00:00:00Z'],
        ['4', '2000-01-01T00:00:00Z'],
      ],
    );
    assert.equal(state('import.orders').since, '2026-09-25T09:50:00.000Z');
    assert.equal(state('import.orders').after, null);
    assert.deepEqual(
      calls.filter((c) => c[1] === 'payouts').map((c) => c[2]),
      [null, 'p2'],
    );
    // A new order and a later change to an older order are both fetched on the next run.
    orders.set(6, '2026-09-26T08:00:00Z');
    orders.set(2, '2026-09-26T09:00:00Z');
    await again();
    assert.deepEqual(
      orderCalls().map((c) => c[3]),
      ['2026-09-25T09:50:00.000Z', '2026-09-25T09:50:00.000Z'],
    );
    assert.equal(state('import.orders').since, '2026-09-26T08:50:00.000Z');
    assert.deepEqual(
      calls.filter((c) => c[1] === 'payouts').map((c) => c[2]),
      [null, 'p3'],
    );
    assert.equal(state('import.payouts').done, true);
    await again();
    assert.deepEqual(
      calls.filter((c) => c[1] === 'payouts').map((c) => c[2]),
      [null],
      'after one full walk only the newest page is fetched',
    );
    // Shops synced by the earlier backwards walk resume 30 days back, not from scratch.
    const scope = state('import.orders').scope;
    h.sql
      .prepare(
        "UPDATE production_jobs SET cursor_json=? WHERE webshop_id='shop-a1' AND job='import.orders'",
      )
      .run(JSON.stringify({ scope, after: 'old-cursor' }));
    await again();
    const resumed = Date.parse(orderCalls()[0][3]);
    assert.ok(Math.abs(resumed - (Date.now() - 30 * 86400000)) < 60000);
    assert.equal(orderCalls()[0][2], null);
  } finally {
    h.close();
  }
});
test('production scheduler is off in DEV, leases each shop and continues other orders after failure', async () => {
  const h = harness();
  try {
    const automation = {
      sales: true,
      payments: false,
      refunds: false,
      payouts: false,
      inventory: false,
      invoiceEmails: false,
      salesBookDinero: true,
    };
    for (const [company, shop] of [
      ['company-a', 'shop-a1'],
      ['company-b', 'shop-b1'],
    ]) {
      h.sql
        .prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)')
        .run(
          company,
          shop,
          JSON.stringify({ automation, syncIntervalMinutes: 5 }),
          'r1',
        );
      for (const provider of ['shopify', 'dinero'])
        h.sql
          .prepare(
            'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
          )
          .run(company, shop, provider, '2026-09-01');
      for (const id of ['1', '2', '3'])
        h.sql
          .prepare(
            'INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)',
          )
          .run(
            company,
            shop,
            'orders',
            'gid://shopify/Order/' + id,
            '2026-09-02T10:00:00Z',
            JSON.stringify({
              displayFulfillmentStatus: 'FULFILLED',
              fulfillments: [
                { createdAt: '2026-09-02T10:00:00Z', status: 'SUCCESS' },
              ],
            }),
          );
      for (const [id, payload] of [
        [
          'old',
          {
            displayFulfillmentStatus: 'FULFILLED',
            fulfillments: [
              { createdAt: '2026-08-01T10:00:00Z', status: 'SUCCESS' },
            ],
          },
        ],
        ['open', { displayFulfillmentStatus: 'UNFULFILLED', fulfillments: [] }],
        [
          'test',
          {
            test: true,
            displayFulfillmentStatus: 'FULFILLED',
            fulfillments: [
              { createdAt: '2026-09-02T10:00:00Z', status: 'SUCCESS' },
            ],
          },
        ],
      ])
        h.sql
          .prepare(
            'INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)',
          )
          .run(
            company,
            shop,
            'orders',
            id,
            '2026-09-02T10:00:00Z',
            JSON.stringify(payload),
          );
    }
    for (const [company, shop] of [
      ['company-a', 'shop-a1'],
      ['company-b', 'shop-b1'],
    ])
      h.sql
        .prepare(
          "INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted,verified_at) VALUES(?,?,'shopify',?,'x',CURRENT_TIMESTAMP)",
        )
        .run(company, shop, shop + '.myshopify.com');
    const calls = [],
      imports = [];
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './order-markets': domesticMarkets(h),
      './operations': {
        handleOperations: async (req, env, actor, company, shop, module) => {
          const b = await req.json();
          if (module === 'orders')
            imports.push([company, shop, module, b.since]);
          return Response.json({ hasNextPage: false, endCursor: null });
        },
      },
      './invoices': {
        handleInvoices: async (req, env, actor, company, action) => {
          const b = await req.json();
          if (b.externalId.endsWith('/1'))
            throw new Error('synthetic source failure');
          return Response.json({ invoice: { date: '2026-09-02T10:00:00Z' } });
        },
      },
      './production-sales': {
        handleProductionSale: async (req, env, actor, company, shop) => {
          calls.push([company, shop, actor.id, (await req.json()).externalId]);
          return Response.json({ phase: 'booked' });
        },
      },
    });
    const run = load('platform/production-jobs.ts').runProductionJobs;
    assert.equal((await run(h.env)).status, 'disabled');
    assert.equal(imports.length, 0);
    const env = {
      ...h.env,
      PLATFORM_ENV: 'production',
      PLATFORM_EXTERNAL_WRITES: 'enabled',
    };
    await Promise.all([run(env), run(env)]);
    assert.equal(imports.length, 2);
    assert.equal(calls.length, 4);
    // A 5-minute interval is planned from the start of the run with a minute of slack, so every 5-minute tick runs it.
    for (const row of h.sql
      .prepare(
        "SELECT webshop_id,next_run_at FROM production_jobs WHERE job='runtime'",
      )
      .all()) {
      const left = row.next_run_at - Date.now();
      assert.ok(
        ['shop-a1', 'shop-b1'].includes(row.webshop_id)
          ? left >= 3 * 60000 && left <= 4 * 60000
          : left >= 13 * 60000,
        row.webshop_id + ': ' + left,
      );
    }
    const { normalizeSyncInterval } = loader()(
      'platform/tier1/src/lib/sync-schedule.ts',
    );
    for (const value of [undefined, 1, 10])
      assert.equal(normalizeSyncInterval(value), 15);
    assert.equal(normalizeSyncInterval(5), 5);
    assert.equal(normalizeSyncInterval(30), 30);
    assert.deepEqual(calls.map((x) => [x[0], x[2]]).sort(), [
      ['company-a', 'local-a'],
      ['company-a', 'local-a'],
      ['company-b', 'local-b'],
      ['company-b', 'local-b'],
    ]);
    assert.equal(
      h.sql
        .prepare('SELECT count(*) n FROM production_attempts WHERE failures=1')
        .get().n,
      2,
    );
    assert.equal(
      h.sql
        .prepare("SELECT count(*) n FROM operation_runs WHERE status='failed'")
        .get().n,
      2,
    );
    await run(env);
    assert.equal(imports.length, 2);
    h.sql
      .prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'")
      .run();
    await run(env);
    assert.equal(imports.length, 4);
    assert.equal(imports[0][3], '2000-01-01T00:00:00Z');
    assert.equal(calls.length, 4);
    h.sql
      .prepare(
        "INSERT INTO public_signups(company_id,user_id,cvr,terms_version,accepted_at,trial_ends_at,template_version) VALUES('company-a','local-a','12345678','test',0,1,1)",
      )
      .run();
    h.sql
      .prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'")
      .run();
    await run(env);
    assert.equal(imports.length, 5);
    assert.equal(imports[4][0], 'company-b');
    await assert.rejects(
      () =>
        load('platform/auth.ts').requireCompany(
          h.env.PLATFORM_DB,
          { id: 'local-a', platformAdmin: false },
          'company-a',
        ),
      /Prøveperioden/,
    );
  } finally {
    h.close();
  }
});

test('the job creates payout reports for paid Shopify Payments and Flatpay payouts, newest first, with a cooldown on failure', async () => {
  const h = harness();
  try {
    h.sql
      .prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)')
      .run(
        'company-a',
        'shop-a1',
        JSON.stringify({ automation: {}, syncIntervalMinutes: 15 }),
        'r1',
      );
    const payout = (n, status, day) =>
      h.sql
        .prepare(
          'INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)',
        )
        .run(
          'company-a',
          'shop-a1',
          'payouts',
          'gid://shopify/ShopifyPaymentsPayout/' + n,
          `2026-09-${day}T10:00:00Z`,
          JSON.stringify({ status, transactionType: 'DEPOSIT' }),
        );
    for (let n = 1; n <= 5; n++) payout(n, 'PAID', 10 + n);
    payout(6, 'SCHEDULED', 20);
    h.sql
      .prepare(
        "INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES('company-a','shop-a1','flatpay','f','{}','x','2026-09-01')",
      )
      .run();
    const fp = h.sql.prepare(
      "INSERT INTO payment_records(company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json,paid) VALUES('company-a','shop-a1','flatpay','payments',?,?,'{}',?)",
    );
    fp.run('700', '2026-09-19', 1);
    fp.run('701', '2026-09-25', 0);
    h.sql
      .prepare(
        "INSERT INTO platform_payout_documents(company_id,webshop_id,external_id,id,status,r2_key,source_json) VALUES('company-a','shop-a1','gid://shopify/ShopifyPaymentsPayout/1','d1','generated','k','{}')",
      )
      .run();
    let failing = '';
    const made = [];
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './operations': {
        handleOperations: async () =>
          Response.json({ hasNextPage: false, endCursor: null }),
      },
      './documents': {
        generatePayoutReport: async (env, company, shop, id) => {
          if (id === failing) throw new Error('boom');
          made.push(id);
          h.sql
            .prepare(
              "INSERT INTO platform_payout_documents(company_id,webshop_id,external_id,id,status,r2_key,source_json) VALUES(?,?,?,?,'generated','k','{}')",
            )
            .run(company, shop, id, crypto.randomUUID());
          return { id: 'x' };
        },
      },
    });
    const run = load('platform/production-jobs.ts').runProductionJobs,
      env = {
        ...h.env,
        PLATFORM_ENV: 'production',
        PLATFORM_EXTERNAL_WRITES: 'enabled',
      };
    failing = 'gid://shopify/ShopifyPaymentsPayout/4';
    await run(env);
    assert.deepEqual(made, [
      'flatpay:700',
      'gid://shopify/ShopifyPaymentsPayout/5',
      'gid://shopify/ShopifyPaymentsPayout/3',
      'gid://shopify/ShopifyPaymentsPayout/2',
    ]);
    assert.match(
      h.sql
        .prepare(
          "SELECT message FROM operation_runs WHERE module='auto.reports' AND status='failed'",
        )
        .get().message,
      /^En udbetalingsrapport kunne ikke dannes automatisk\. Udbetaling 4 \(Shopify Payments\): /,
    );
    // The list marks the payout whose automatic report failed, so it can be found and retried.
    const listed = (
      await (
        await h.request('/api/platform/tier1/shops/shop-a1/documents', {
          user: 'local-a',
        })
      ).json()
    ).documents;
    assert.equal(listed.find((d) => d.externalId.endsWith('/4')).failed, true);
    assert.equal(listed.find((d) => d.externalId.endsWith('/5')).failed, false);
    assert.equal(
      listed.find((d) => d.externalId.endsWith('/6')).status,
      'SCHEDULED',
    );
    // Upcoming Flatpay settlements are listed too, without a report until they are paid out.
    h.sql
      .prepare(
        "INSERT INTO payment_records(company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json,paid) VALUES('company-a','shop-a1','flatpay','payments','upcoming:60622781','2026-09-30',?,0)",
      )
      .run(
        JSON.stringify({
          source: 'settlement',
          estimate: true,
          settlementNumber: 60622781,
          scheduledDate: '2026-09-30',
          paidDate: null,
          currency: 'DKK',
          payoutAmount: 1743.11,
        }),
      );
    const upcoming = (
      await (
        await h.request('/api/platform/tier1/shops/shop-a1/documents', {
          user: 'local-a',
        })
      ).json()
    ).documents.find((d) => d.externalId === 'flatpay:upcoming:60622781');
    assert.deepEqual(
      {
        status: upcoming.status,
        filename: upcoming.filename,
        date: upcoming.date,
        ready: upcoming.ready,
      },
      {
        status: 'SCHEDULED',
        filename: 'Afregning 60622781',
        date: '2026-09-30',
        ready: false,
      },
    );
    h.sql
      .prepare(
        "DELETE FROM payment_records WHERE external_id='upcoming:60622781'",
      )
      .run();
    h.sql
      .prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'")
      .run();
    failing = '';
    await run(env);
    assert.equal(made.length, 4, 'the failed report waits for its cooldown');
    // A second failure of the same payout backs off further and does not ring the bell again.
    failing = 'gid://shopify/ShopifyPaymentsPayout/4';
    h.sql
      .prepare(
        "UPDATE production_attempts SET next_attempt_at=0 WHERE job='reports'",
      )
      .run();
    h.sql
      .prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'")
      .run();
    await run(env);
    assert.equal(
      h.sql
        .prepare(
          "SELECT count(*) n FROM operation_runs WHERE module='auto.reports' AND status='failed'",
        )
        .get().n,
      1,
    );
    const retry = h.sql
      .prepare(
        "SELECT failures,next_attempt_at-attempted_at wait FROM production_attempts WHERE job='reports'",
      )
      .get();
    assert.equal(retry.failures, 2);
    assert.equal(retry.wait, 12 * 3600000);
    failing = '';
    h.sql
      .prepare(
        "UPDATE production_attempts SET next_attempt_at=0 WHERE job='reports'",
      )
      .run();
    h.sql
      .prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'")
      .run();
    await run(env);
    assert.equal(made.at(-1), 'gid://shopify/ShopifyPaymentsPayout/4');
    assert.equal(made.length, 5);
  } finally {
    h.close();
  }
});

test('upcoming payouts are not booked early and show as awaiting payout instead of failed', async () => {
  const h = harness();
  try {
    const automation = {
      sales: false,
      payments: false,
      refunds: false,
      payouts: true,
      inventory: false,
      invoiceEmails: false,
      payoutsBookDinero: true,
    };
    h.sql
      .prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)')
      .run(
        'company-a',
        'shop-a1',
        JSON.stringify({ automation, syncIntervalMinutes: 15 }),
        'r1',
      );
    for (const provider of ['shopify', 'dinero'])
      h.sql
        .prepare(
          'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
        )
        .run('company-a', 'shop-a1', provider, '2026-09-01');
    const payout = (id, status) =>
      h.sql
        .prepare(
          'INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)',
        )
        .run(
          'company-a',
          'shop-a1',
          'payouts',
          'gid://shopify/ShopifyPaymentsPayout/' + id,
          '2026-09-20T10:00:00Z',
          JSON.stringify({
            id: 'gid://shopify/ShopifyPaymentsPayout/' + id,
            issuedAt: '2026-09-20T10:00:00Z',
            status,
            net: { amount: '10.00', currencyCode: 'DKK' },
          }),
        );
    payout('1', 'PAID');
    payout('2', 'SCHEDULED');
    payout('3', 'IN_TRANSIT');
    const calls = [];
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './operations': {
        handleOperations: async () =>
          Response.json({ hasNextPage: false, endCursor: null }),
      },
      './production-proposals': {
        handleProductionOther: async (req) => {
          const b = await req.json();
          calls.push([b.action, b.externalId]);
          return Response.json({
            phase: b.action === 'inspect' ? 'prepared' : 'booked',
            version: 'v',
          });
        },
      },
    });
    await load('platform/production-jobs.ts').runProductionJobs({
      ...h.env,
      PLATFORM_ENV: 'production',
      PLATFORM_EXTERNAL_WRITES: 'enabled',
    });
    assert.deepEqual(
      [...new Set(calls.map((c) => c[1]))],
      ['gid://shopify/ShopifyPaymentsPayout/1'],
    );
    assert.equal(
      h.sql
        .prepare("SELECT count(*) n FROM operation_runs WHERE status='failed'")
        .get().n,
      0,
    );
    for (const id of ['1', '2'])
      h.sql
        .prepare(
          "INSERT INTO production_attempts(company_id,webshop_id,job,external_id,attempted_at,next_attempt_at,failures) VALUES('company-a','shop-a1','payouts',?,0,0,1) ON CONFLICT(company_id,webshop_id,job,external_id) DO UPDATE SET failures=1",
        )
        .run('gid://shopify/ShopifyPaymentsPayout/' + id);
    const rows = (
      await (
        await h.request('/api/platform/tier1/shops/shop-a1/payouts/overview', {
          user: 'local-a',
        })
      ).json()
    ).payouts;
    const booking = Object.fromEntries(
      rows.map((r) => [r.id.split('/').pop(), [r.status, r.booking]]),
    );
    assert.deepEqual(booking, {
      1: ['Udbetalt', 'failed_retry'],
      2: ['Kommende', 'expected'],
      3: ['Under overførsel', 'expected'],
    });
  } finally {
    h.close();
  }
});

test('production proposals validate current Shopify payouts, numeric refund references and scoped Flatpay settlement', async () => {
  const h = harness();
  try {
    const a = {
      bank: '55000',
      clearing: '55110',
      fees: '7220',
      shopifyPaymentsClearing: '55100',
      flatpayClearing: '55105',
      refundGoodsVat: '2000',
      vatCode: 'U25',
      noVatCode: 'NONE',
    };
    const chart = [55000, 55110, 7220, 55100, 55105, 2000].map((n) => ({
      number: String(n),
      name: String(n),
      hidden: false,
      vatCode: n === 2000 ? 'U25' : '',
      kind: 'entry',
    }));
    for (const provider of ['shopify', 'flatpay', 'dinero'])
      h.sql
        .prepare(
          'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
        )
        .run('company-a', 'shop-a1', provider, '2026-09-01');
    h.sql
      .prepare(
        'INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        'company-a',
        'shop-a1',
        'flatpay',
        'identity',
        JSON.stringify({
          merchantID: 'm',
          agreementId: 'a',
          agreementNumber: '11',
        }),
        'encrypted',
        '2026-09-01',
      );
    const { payoutSummaryFields } = loader()('platform/payout-calculations.ts');
    const summary = Object.fromEntries(
      payoutSummaryFields.map((f) => [
        f,
        { amount: '0.00', currencyCode: 'DKK' },
      ]),
    );
    summary.chargesGross.amount = '100.00';
    summary.chargesFee.amount = '2.00';
    const payout = {
      id: 'gid://shopify/ShopifyPaymentsPayout/1',
      issuedAt: '2026-09-02T12:00:00Z',
      status: 'PAID',
      transactionType: 'DEPOSIT',
      net: { amount: '98.00', currencyCode: 'DKK' },
      summary,
    };
    const refund = {
      id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/2',
      type: 'REFUND',
      test: false,
      transactionDate: '2026-09-02T12:00:00Z',
      amount: { amount: '-100.00', currencyCode: 'DKK' },
      associatedOrder: { id: 'gid://shopify/Order/4', name: '#4' },
      sourceOrderTransactionId: '99999999999999999',
    };
    const money = (v) => ({ shopMoney: { amount: v, currencyCode: 'DKK' } }),
      connection = (nodes) => ({ nodes, pageInfo: { hasNextPage: false } });
    const details = {
      id: 'refund',
      processedAt: '2026-09-02T12:00:00Z',
      refundLineItems: connection([
        { subtotalSet: money('80.00'), totalTaxSet: money('20.00') },
      ]),
      refundShippingLines: connection([]),
      orderAdjustments: connection([]),
      transactions: connection([
        {
          id:
            'gid://shopify/OrderTransaction/' + refund.sourceOrderTransactionId,
          kind: 'REFUND',
          status: 'SUCCESS',
          test: false,
          amountSet: money('100.00'),
        },
      ]),
    };
    const payment = {
      paymentID: '12345',
      merchantID: 'm',
      agreementNumber: '11',
      paidDate: '2026-09-02T12:00:00Z',
      currency: 'DKK',
      payoutAmount: 98,
      settlements: '56789',
    };
    const settlement = {
      settlementNumber: '56789',
      merchantID: 'm',
      agreementNumber: '11',
      currency: 'DKK',
      transactions: '1',
      grossPurchase: 100,
      grossSettlement: 100,
      netPurchase: 100,
      netSettlement: 98,
      payout: 98,
      feeAmount: 2,
      deduction: 2,
      refundAmount: 0,
      chargeback: 0,
      rollingReserve: 0,
      rollingRelease: 0,
      addedSum: 0,
      deductedSum: 0,
      balanceTransfer: 0,
      reversals: 0,
    };
    const objects = new Map(),
      env = {
        ...h.env,
        PLATFORM_DOCUMENTS: {
          put: async (key, bytes) => objects.set(key, bytes),
          get: async (key) =>
            objects.has(key)
              ? {
                  size: 8,
                  etag: key,
                  arrayBuffer: async () => objects.get(key).buffer,
                }
              : null,
        },
      };
    const ctx = {
      env,
      company: 'company-a',
      shop: 'shop-a1',
      credentials: { organizationId: '123' },
      mapping: { accounts_json: JSON.stringify(a) },
      prefs: {
        preferences_json: JSON.stringify({
          automation: {
            payoutsBookDinero: true,
            refundsBookDinero: true,
            attachments: true,
          },
        }),
      },
      sourceRow: { payload_json: JSON.stringify(payment) },
    };
    let calls = 0;
    const api = loader({
      jose,
      'pdf-lib': pdfLib,
      './production-booking': {
        handleProductionBooking: async (
          req,
          e,
          actor,
          company,
          shop,
          kind,
          module,
          provider,
          pattern,
          prepare,
        ) => {
          const b = await req.json();
          assert.match(b.externalId, pattern);
          return prepare({ ...ctx, id: b.externalId });
        },
      },
      './dinero-read': { readDineroAccounts: async () => chart },
      './invoice-source': {
        shopAccess: async () => ({ shop: 'a.myshopify.com' }),
        orderQuery: async (access, query) => {
          calls++;
          return query.includes('Payout')
            ? { node: payout }
            : query.includes('RefundDetails')
              ? { order: { refunds: [details] } }
              : { node: refund };
        },
      },
      './payout-source': { fetchPayoutTransactions: async () => [] },
      './payout-pdf': { buildPayoutReport: async () => new Uint8Array(8) },
      './connections': {
        unseal: async () => ({ username: 'synthetic', password: 'synthetic' }),
      },
      './flatpay-read': {
        flatpayRead: async (c, resource) =>
          resource === 'payments'
            ? [payment]
            : resource === 'settlements'
              ? [settlement]
              : [
                  {
                    transactionID: '9',
                    settlementNumber: '56789',
                    merchantID: 'm',
                    agreementID: 'a',
                    purchaseDate: '2026-09-02',
                    transactionCode: 'Purchase',
                    currency: 'DKK',
                    grossAmount: 100,
                    fees: 2,
                    netAmount: 98,
                  },
                ],
      },
    })('platform/production-proposals.ts');
    const run = (kind, externalId) =>
      api.handleProductionOther(
        new Request('https://portal.example.test', {
          method: 'POST',
          body: JSON.stringify({ externalId }),
        }),
        env,
        {},
        'company-a',
        'shop-a1',
        kind,
      );
    const p = await run('payout', payout.id);
    assert.deepEqual(
      p.snapshot.voucher.Lines.map((x) => x.Amount),
      [100, 2, 98],
    );
    assert.ok(p.file);
    assert.match(p.snapshot.pdfKey, /companies\/company-a\/webshops\/shop-a1/);
    const r = await run('refund', refund.id);
    assert.deepEqual(
      r.snapshot.expected.map((x) => x.gross),
      [-10000, 10000],
    );
    assert.match(r.snapshot.voucher.ExternalReference, /^wtb:shop-a1:refund:/);
    const f = await run('flatpay', '12345');
    assert.deepEqual(
      f.snapshot.voucher.Lines.map((x) => x.Amount),
      [100, 2, 98],
    );
    assert.ok(f.file);
    // Bookkeeping registers its report on Udbetalingsrapporter and reuses it next time: one report per payout.
    const doc = (id) =>
      h.sql
        .prepare(
          'SELECT r2_key FROM platform_payout_documents WHERE external_id=?',
        )
        .get(id)?.r2_key;
    assert.equal(doc(payout.id), p.snapshot.pdfKey);
    assert.equal(doc('flatpay:12345'), f.snapshot.pdfKey);
    h.sql
      .prepare(
        "UPDATE platform_payout_documents SET r2_key='companies/company-a/webshops/shop-a1/payout-reports/shown.pdf' WHERE external_id=?",
      )
      .run(payout.id);
    objects.set(
      'companies/company-a/webshops/shop-a1/payout-reports/shown.pdf',
      new Uint8Array(8),
    );
    assert.equal(
      (await run('payout', payout.id)).snapshot.pdfKey,
      'companies/company-a/webshops/shop-a1/payout-reports/shown.pdf',
    );
    ctx.prefs.preferences_json = JSON.stringify({
      automation: { payoutsBookDinero: true, attachments: false },
    });
    assert.equal((await run('flatpay', '12345')).file, undefined);
    assert.equal((await run('payout', payout.id)).file, undefined);
    settlement.chargeback = 1;
    await assert.rejects(() => run('flatpay', '12345'));
    refund.sourceOrderTransactionId = 'another';
    await assert.rejects(() => run('refund', refund.id));
    payout.summary.chargesGross.amount = '101.00';
    await assert.rejects(() => run('payout', payout.id));
    assert.ok(calls >= 5);
  } finally {
    h.close();
  }
});

test('production sale respects disabled attachments while preserving its PDF and booking receipt', async () => {
  for (const attach of [false, true]) {
    const h = await productionSaleHarness();
    try {
      h.sql
        .prepare(
          "UPDATE tier1_preferences SET preferences_json=json_set(preferences_json,'$.automation.attachments',json(?))",
        )
        .run(attach ? 'true' : 'false');
      const inspected = await (await h.call('inspect')).json();
      await h.call('retry', inspected.version);
      assert.equal(h.uploads, attach ? 1 : 0);
      assert.equal(h.posts, 1);
      assert.equal(h.books, 1);
      assert.equal(h.receipt().phase, 'booked');
      assert.ok(JSON.parse(h.receipt().payload_json).pdfKey);
    } finally {
      h.close();
    }
  }
});

test('booking display distinguishes waiting, safe retries and uncertain writes without crossing shops', async () => {
  const h = harness();
  try {
    const load = loader({ jose }),
      get = () =>
        load('platform/booking-onboarding.ts').bookingStatuses(
          h.env,
          'company-a',
          'shop-a1',
        );
    const source = JSON.stringify({ displayFulfillmentStatus: 'UNFULFILLED' });
    h.sql
      .prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)')
      .run(
        'company-a',
        'shop-a1',
        JSON.stringify({ automation: { sales: true } }),
        'r1',
      );
    let status = await get();
    assert.equal(
      status('shopify', 'orders', 'same', '2026-09-01', source),
      'pending',
    );
    h.sql
      .prepare('INSERT INTO production_attempts VALUES(?,?,?,?,?,?,?)')
      .run('company-b', 'shop-b1', 'sales', 'same', 1, 2, 1);
    status = await get();
    assert.equal(
      status('shopify', 'orders', 'same', '2026-09-01', source),
      'pending',
    );
    h.sql
      .prepare('INSERT INTO production_attempts VALUES(?,?,?,?,?,?,?)')
      .run('company-a', 'shop-a1', 'sales', 'same', 1, 2, 1);
    status = await get();
    assert.equal(
      status('shopify', 'orders', 'same', '2026-09-01', source),
      'failed_retry',
    );
    h.sql
      .prepare(
        'INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)',
      )
      .run('company-a', '123', 'unused', 'r1', '[]');
    h.sql
      .prepare(
        'INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        'company-a',
        'shop-a1',
        'shopify',
        'orders',
        'same',
        '123',
        'uncertain',
        'v1',
        JSON.stringify({ sourceJson: source }),
      );
    status = await get();
    assert.equal(
      status('shopify', 'orders', 'same', '2026-09-01', source),
      'failed_manual',
    );
    h.sql.exec("UPDATE production_receipts SET phase='booked'");
    status = await get();
    assert.equal(
      status('shopify', 'orders', 'same', '2026-09-01', source),
      'booked',
    );
    const labels = load(
      'platform/tier1/src/lib/payout-status.ts',
    ).payoutStatusLabel;
    assert.equal(labels('PAID'), labels('Udbetalt'));
    assert.equal(labels('Afregnet'), labels('PAID'));
    assert.equal(labels('SCHEDULED'), labels('Kommende'));
    assert.equal(labels('FAILED'), 'Fejlet');
  } finally {
    h.close();
  }
});

test('"Synkronisér nu" invoices and books fulfilled orders at once, only as the automation switches allow', async () => {
  const h = harness();
  try {
    const prefs = (automation) =>
      h.sql
        .prepare(
          'INSERT INTO tier1_preferences VALUES(?,?,?,?) ON CONFLICT DO UPDATE SET preferences_json=excluded.preferences_json',
        )
        .run(
          'company-a',
          'shop-a1',
          JSON.stringify({ automation, syncIntervalMinutes: 15 }),
          'r1',
        );
    prefs({ sales: true, salesBookDinero: true, invoiceEmails: false });
    for (const provider of ['shopify', 'dinero'])
      h.sql
        .prepare(
          'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
        )
        .run('company-a', 'shop-a1', provider, '2026-09-01');
    const order = (id, payload) =>
      h.sql
        .prepare(
          'INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)',
        )
        .run(
          'company-a',
          'shop-a1',
          'orders',
          'gid://shopify/Order/' + id,
          '2026-09-02T10:00:00Z',
          JSON.stringify(payload),
        );
    order('1', {
      displayFulfillmentStatus: 'FULFILLED',
      fulfillments: [{ createdAt: '2026-09-02T10:00:00Z', status: 'SUCCESS' }],
    });
    order('2', {
      displayFulfillmentStatus: 'FULFILLED',
      fulfillments: [{ createdAt: '2026-09-02T10:00:00Z', status: 'SUCCESS' }],
    });
    order('3', { displayFulfillmentStatus: 'UNFULFILLED', fulfillments: [] });
    h.sql.exec(
      "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) SELECT company_id,webshop_id,external_id,'DK','DKK' FROM operation_snapshots WHERE module='orders'",
    );
    const imports = [],
      sales = [];
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './order-markets': domesticMarkets(h),
      './operations': {
        handleOperations: async () => {
          imports.push(1);
          return Response.json({ hasNextPage: false, endCursor: null });
        },
      },
      './invoices': {
        handleInvoices: async (req, env, actor, company, action) => {
          const b = await req.json();
          if (action === 'generate')
            h.sql
              .prepare(
                "INSERT OR IGNORE INTO platform_invoices VALUES(?,?,?,?,?,'generated',?,?,?,CURRENT_TIMESTAMP)",
              )
              .run(
                'company-a',
                'shop-a1',
                b.externalId,
                'doc-' + b.externalId,
                'f',
                'k',
                '{}',
                '{}',
              );
          return Response.json({ invoice: { date: '2026-09-02T10:00:00Z' } });
        },
      },
      './production-sales': {
        handleProductionSale: async (req) => {
          const b = await req.json();
          if (b.action === 'inspect')
            return Response.json({
              phase:
                h.sql
                  .prepare(
                    'SELECT phase FROM production_receipts WHERE external_id=?',
                  )
                  .get(b.externalId)?.phase || 'prepared',
              version: 'v',
            });
          sales.push(b.externalId);
          h.sql
            .prepare(
              "INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES('company-a','shop-a1','shopify','orders',?,'dinero','booked','v','{}')",
            )
            .run(b.externalId);
          return Response.json({ phase: 'booked' });
        },
      },
    });
    const { runSalesNow } = load('platform/production-jobs.ts'),
      env = {
        ...h.env,
        PLATFORM_ENV: 'production',
        PLATFORM_EXTERNAL_WRITES: 'enabled',
      };
    assert.deepEqual(await runSalesNow(h.env, 'company-a', 'shop-a1'), {
      status: 'disabled',
    });
    h.sql
      .prepare(
        "INSERT INTO production_jobs(company_id,webshop_id,job,next_run_at) VALUES('company-a','shop-a1','runtime',?)",
      )
      .run(Date.now() + 600000);
    assert.deepEqual(await runSalesNow(env, 'company-a', 'shop-a1'), {
      status: 'completed',
      invoices: 2,
      booked: 2,
      drafts: 0,
      sent: 0,
      failed: 0,
    });
    assert.deepEqual(sales.sort(), [
      'gid://shopify/Order/1',
      'gid://shopify/Order/2',
    ]);
    assert.equal(
      imports.length,
      0,
      'only the sales steps run; the orders were just fetched by the page',
    );
    const job = h.sql
      .prepare(
        "SELECT lease_owner,next_run_at FROM production_jobs WHERE job='runtime'",
      )
      .get();
    assert.equal(job.lease_owner, null);
    assert.ok(
      job.next_run_at > Date.now() + 500000,
      'the schedule is left as it was',
    );
    assert.deepEqual(await runSalesNow(env, 'company-a', 'shop-a1'), {
      status: 'completed',
      invoices: 0,
      booked: 0,
      drafts: 0,
      sent: 0,
      failed: 0,
    });
    h.sql
      .prepare(
        "UPDATE production_jobs SET lease_owner='cron',lease_until=? WHERE job='runtime'",
      )
      .run(Date.now() + 60000);
    assert.deepEqual(await runSalesNow(env, 'company-a', 'shop-a1'), {
      status: 'busy',
    });
    prefs({ sales: false, invoiceEmails: false });
    assert.deepEqual(await runSalesNow(env, 'company-a', 'shop-a1'), {
      status: 'off',
    });
    const { processedSummary } = loader()(
      'platform/tier1/src/lib/order-processing.ts',
    );
    assert.equal(
      processedSummary({
        status: 'completed',
        invoices: 1,
        sent: 0,
        booked: 2,
        drafts: 0,
        failed: 1,
      }),
      '1 faktura dannet · 2 ordrer bogført i Dinero · 1 ordre kunne ikke behandles – se klokken',
    );
    assert.equal(
      processedSummary({
        status: 'completed',
        invoices: 0,
        sent: 0,
        booked: 0,
        drafts: 0,
        failed: 0,
      }),
      'Ingen nye afsendte ordrer at fakturere eller bogføre',
    );
    // Through the portal: company administrators only, and nothing is written outside production.
    const path = '/api/platform/tier1/shops/shop-a1/shopify/orders/process';
    assert.equal(
      (
        await h.request(path, {
          user: 'local-reader',
          method: 'POST',
          body: {},
        })
      ).status,
      403,
    );
    const response = await h.request(path, {
      user: 'local-a',
      method: 'POST',
      body: {},
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).status, 'disabled');
  } finally {
    h.close();
  }
});

test('ViaBill is read at most every 30 minutes and backs off quietly when it answers 429', async () => {
  const h = harness();
  try {
    h.sql
      .prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)')
      .run(
        'company-a',
        'shop-a1',
        JSON.stringify({ automation: {}, syncIntervalMinutes: 5 }),
        'r1',
      );
    h.sql
      .prepare(
        "INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES('company-a','shop-a1','viabill','v','{}','x','2026-09-01')",
      )
      .run();
    let answer = 'ok';
    const calls = [];
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './payments': {
        handlePayments: async (req, env, actor, company, shop, provider) => {
          const b = await req.json();
          calls.push(provider + '.' + b.kind);
          if (answer === '429')
            return Response.json(
              {
                error:
                  'ViaBill begrænser hentningen (HTTP 429). Vent lidt og prøv igen.',
              },
              { status: 422 },
            );
          if (answer === '401')
            return Response.json(
              {
                error:
                  'ViaBill kunne ikke godkende API key og secret (HTTP 401) ved hentning af afregningsdata.',
              },
              { status: 422 },
            );
          return Response.json({ count: 0, next: null });
        },
      },
    });
    const run = load('platform/production-jobs.ts').runProductionJobs,
      env = {
        ...h.env,
        PLATFORM_ENV: 'production',
        PLATFORM_EXTERNAL_WRITES: 'enabled',
      };
    const again = async () => {
      h.sql
        .prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'")
        .run();
      h.sql
        .prepare("DELETE FROM production_jobs WHERE job='pace.payouts'")
        .run();
      await run(env);
    };
    const pace = () =>
      JSON.parse(
        h.sql
          .prepare(
            "SELECT cursor_json FROM production_jobs WHERE webshop_id='shop-a1' AND job='viabill.pace'",
          )
          .get().cursor_json,
      );
    const failures = () =>
      h.sql
        .prepare(
          "SELECT count(*) n FROM operation_runs WHERE module LIKE 'auto.import.viabill%' AND status='failed'",
        )
        .get().n;
    answer = '429';
    await run(env);
    assert.deepEqual(
      calls,
      ['viabill.payment'],
      'a 429 stops the rest of this ViaBill run',
    );
    assert.equal(failures(), 0, 'throttling does not ring the bell');
    assert.equal(pace().wait, 3600000);
    assert.ok(Math.abs(pace().nextAt - (Date.now() + 3600000)) < 60000);
    await again();
    assert.equal(
      calls.length,
      1,
      'it waits an hour even with a 5-minute interval',
    );
    h.sql
      .prepare(
        "UPDATE production_jobs SET cursor_json=? WHERE job='viabill.pace'",
      )
      .run(JSON.stringify({ ...pace(), nextAt: 0 }));
    await again();
    assert.equal(
      pace().wait,
      7200000,
      'the wait doubles while ViaBill keeps refusing',
    );
    answer = 'ok';
    h.sql
      .prepare(
        "UPDATE production_jobs SET cursor_json=? WHERE job='viabill.pace'",
      )
      .run(JSON.stringify({ ...pace(), nextAt: 0 }));
    calls.length = 0;
    await again();
    assert.deepEqual(calls, ['viabill.payment', 'viabill.payout']);
    assert.equal(pace().wait, 0);
    assert.ok(Math.abs(pace().nextAt - (Date.now() + 30 * 60000)) < 60000);
    await again();
    assert.equal(
      calls.length,
      2,
      'at most every 30 minutes after a successful read',
    );
    // Other ViaBill errors still ring the bell.
    answer = '401';
    h.sql
      .prepare(
        "UPDATE production_jobs SET cursor_json=? WHERE job='viabill.pace'",
      )
      .run(JSON.stringify({ nextAt: 0, wait: 0 }));
    await again();
    assert.ok(failures() >= 1);
  } finally {
    h.close();
  }
});

test('a payout that cannot be reconciled on its payout date waits as Afventer for 2 days before it counts as failed', async () => {
  const h = harness();
  try {
    const automation = { payouts: true, payoutsBookDinero: true };
    h.sql
      .prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)')
      .run(
        'company-a',
        'shop-a1',
        JSON.stringify({ automation, syncIntervalMinutes: 15 }),
        'r1',
      );
    for (const provider of ['shopify', 'dinero'])
      h.sql
        .prepare(
          'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
        )
        .run('company-a', 'shop-a1', provider, '2026-01-01');
    const zero = { amount: '0.00', currencyCode: 'DKK' },
      payout = (n, issuedAt) =>
        h.sql
          .prepare(
            "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','payouts',?,?,?)",
          )
          .run(
            'gid://shopify/ShopifyPaymentsPayout/' + n,
            issuedAt,
            JSON.stringify({
              id: 'gid://shopify/ShopifyPaymentsPayout/' + n,
              issuedAt,
              status: 'PAID',
              transactionType: 'DEPOSIT',
              net: { amount: '100.00', currencyCode: 'DKK' },
              summary: {
                chargesGross: { amount: '100.00', currencyCode: 'DKK' },
                chargesFee: zero,
              },
            }),
          );
    const today = new Date().toISOString(),
      old = new Date(Date.now() - 3 * 86400000).toISOString();
    payout(1, today);
    payout(2, old);
    // Shopify has not linked the transactions yet: reports and bookings fail for every payout.
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './operations': {
        handleOperations: async () =>
          Response.json({ hasNextPage: false, endCursor: null }),
      },
      './documents': {
        generatePayoutReport: async () => {
          throw new Error(
            'Shopifys transaktioner stemmer ikke med nettoudbetalingen.',
          );
        },
      },
      './production-proposals': {
        handleProductionOther: async () =>
          Response.json(
            {
              error:
                'Shopifys transaktioner stemmer ikke med nettoudbetalingen.',
            },
            { status: 409 },
          ),
      },
    });
    const run = load('platform/production-jobs.ts').runProductionJobs,
      env = {
        ...h.env,
        PLATFORM_ENV: 'production',
        PLATFORM_EXTERNAL_WRITES: 'enabled',
      };
    await run(env);
    const attempt = (job, n) =>
      h.sql
        .prepare(
          'SELECT failures,next_attempt_at-attempted_at wait FROM production_attempts WHERE job=? AND external_id=?',
        )
        .get(job, 'gid://shopify/ShopifyPaymentsPayout/' + n);
    assert.deepEqual(
      { ...attempt('payouts', 1) },
      { failures: 0, wait: 2 * 3600000 },
      'today: not ready, retried in 2 hours',
    );
    assert.deepEqual(
      { ...attempt('reports', 1) },
      { failures: 0, wait: 2 * 3600000 },
    );
    assert.equal(
      attempt('payouts', 2).failures,
      1,
      'after 2 days it is a real failure',
    );
    assert.equal(attempt('reports', 2).failures, 1);
    const bell = h.sql
      .prepare("SELECT message FROM operation_runs WHERE status='failed'")
      .all()
      .map((r) => r.message)
      .join(' ');
    assert.doesNotMatch(bell, /Udbetaling 1 /);
    assert.match(bell, /Udbetaling 2 /);
    const statuses = Object.fromEntries(
      (
        await (
          await h.request(
            '/api/platform/tier1/shops/shop-a1/payouts/overview',
            { user: 'local-a' },
          )
        ).json()
      ).payouts.map((p) => [p.id.split('/').pop(), p.booking]),
    );
    assert.equal(statuses['1'], 'reconciliation_required', 'shown as Afventer');
    assert.match(statuses['2'], /^failed/);
  } finally {
    h.close();
  }
});

test('orders and refunds follow the chosen interval; payouts run hourly (15 min when due) and inventory every 4 hours', async () => {
  const h = harness();
  try {
    h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run(
      'company-a',
      'shop-a1',
      JSON.stringify({
        automation: { inventory: true },
        syncIntervalMinutes: 5,
      }),
      'r1',
    );
    h.sql
      .prepare(
        "INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted,verified_at) VALUES('company-a','shop-a1','shopify','shop-a1.myshopify.com','x',CURRENT_TIMESTAMP)",
      )
      .run();
    h.sql
      .prepare(
        "INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES('company-a','shop-a1','flatpay','f','{}','x','2026-09-01')",
      )
      .run();
    const imports = [],
      providers = [];
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './operations': {
        handleOperations: async (req, env, actor, company, shop, module) => {
          if (shop === 'shop-a1') imports.push(module);
          return Response.json({ hasNextPage: false, endCursor: null });
        },
      },
      './payments': {
        handlePayments: async (req, env, actor, company, shop, provider) => {
          if (shop === 'shop-a1')
            providers.push(provider + '.' + (await req.json()).kind);
          return Response.json({ count: 0, next: null });
        },
      },
    });
    const run = load('platform/production-jobs.ts').runProductionJobs,
      env = {
        ...h.env,
        PLATFORM_ENV: 'production',
        PLATFORM_EXTERNAL_WRITES: 'enabled',
      };
    const again = async () => {
      imports.length = 0;
      providers.length = 0;
      h.sql
        .prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'")
        .run();
      await run(env);
    };
    const ago = (group, minutes) =>
      h.sql
        .prepare(
          "UPDATE production_jobs SET cursor_json=? WHERE webshop_id='shop-a1' AND job=?",
        )
        .run(
          JSON.stringify({ lastAt: Date.now() - minutes * 60000 }),
          'pace.' + group,
        );
    await run(env);
    assert.deepEqual(imports, [
      'orders',
      'refunds',
      'payments',
      'payouts',
      'inventory',
    ]);
    assert.ok(providers.length > 0);
    await again();
    assert.deepEqual(
      imports,
      ['orders', 'refunds'],
      'payouts and inventory wait',
    );
    assert.equal(providers.length, 0);
    ago('payouts', 61);
    await again();
    assert.deepEqual(imports, ['orders', 'refunds', 'payments', 'payouts']);
    assert.ok(providers.length > 0);
    // A payout due today is checked every 15 minutes.
    h.sql
      .prepare(
        "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','payouts','gid://shopify/ShopifyPaymentsPayout/9',?,?)",
      )
      .run(new Date().toISOString(), JSON.stringify({ status: 'IN_TRANSIT' }));
    ago('payouts', 16);
    await again();
    assert.ok(imports.includes('payouts'));
    ago('payouts', 10);
    await again();
    assert.ok(!imports.includes('payouts'));
    ago('inventory', 241);
    await again();
    assert.ok(imports.includes('inventory'));
  } finally {
    h.close();
  }
});

test('orders get their country and currency in a separate step, without changing the booked order data', async () => {
  const asked = [];
  const network = async (url, opt) => {
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'fixture' });
    const { query, variables } = JSON.parse(opt.body);
    if (!query.includes('OrderMarkets')) throw Error('unexpected request');
    asked.push(...variables.ids);
    return Response.json({
      data: {
        nodes: variables.ids.map((id) =>
          id.endsWith('/3')
            ? null
            : {
                id,
                presentmentCurrencyCode: id.endsWith('/1') ? 'SEK' : 'DKK',
                shipping: id.endsWith('/1') ? { countryCodeV2: 'SE' } : null,
                billing: { countryCodeV2: 'DK' },
                total: {
                  presentmentMoney: {
                    amount: id.endsWith('/1') ? '1450.00' : '100.00',
                    currencyCode: id.endsWith('/1') ? 'SEK' : 'DKK',
                  },
                },
              },
        ),
      },
    });
  };
  const h = harness(jose, network),
    env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) };
  try {
    await testShopConnections(h, env);
    const order = (n) => {
      const payload = JSON.stringify({
        id: 'gid://shopify/Order/' + n,
        name: '#' + n,
        createdAt: '2026-09-2' + n + 'T10:00:00Z',
        displayFulfillmentStatus: 'FULFILLED',
        currentTotalPriceSet: {
          shopMoney: { amount: '1000.00', currencyCode: 'DKK' },
        },
        totalRefundedSet: {
          shopMoney: { amount: '0.00', currencyCode: 'DKK' },
        },
        paymentGatewayNames: ['shopify_payments'],
      });
      h.sql
        .prepare(
          "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','orders',?,?,?)",
        )
        .run(
          'gid://shopify/Order/' + n,
          '2026-09-2' + n + 'T10:00:00Z',
          payload,
        );
      return payload;
    };
    const before = [order(1), order(2), order(3)];
    const { fillOrderMarkets, orderMarket } = loader({ jose, fetch: network })(
      'platform/order-markets.ts',
    );
    assert.deepEqual(
      orderMarket({
        id: 'x',
        presentmentCurrencyCode: 'SEK',
        shipping: { countryCodeV2: 'SE' },
        billing: { countryCodeV2: 'DK' },
      }),
      {
        country: 'SE',
        currency: 'SEK',
        total: null,
        orderTotal: null,
        netPayment: null,
      },
      'goods go to the shipping country',
    );
    assert.deepEqual(
      orderMarket({
        id: 'x',
        shipping: null,
        billing: { countryCodeV2: 'NO' },
        presentmentCurrencyCode: 'nok!',
      }),
      {
        country: 'NO',
        currency: null,
        total: null,
        orderTotal: null,
        netPayment: null,
      },
    );
    assert.equal(
      await fillOrderMarkets({ ...h.env, ...env }, 'company-a', 'shop-a1'),
      3,
    );
    assert.equal(
      await fillOrderMarkets({ ...h.env, ...env }, 'company-a', 'shop-a1'),
      0,
      'orders are asked for once',
    );
    assert.equal(asked.length, 3);
    assert.deepEqual(
      h.sql
        .prepare(
          'SELECT external_id,country,currency,presentment_total FROM order_markets ORDER BY external_id',
        )
        .all()
        .map((r) => [
          r.external_id.slice(-1),
          r.country,
          r.currency,
          r.presentment_total,
        ]),
      [
        ['1', 'SE', 'SEK', '1450.00'],
        ['2', 'DK', 'DKK', '100.00'],
        ['3', null, null, null],
      ],
    );
    assert.deepEqual(
      h.sql
        .prepare(
          "SELECT payload_json FROM operation_snapshots WHERE module='orders' ORDER BY external_id",
        )
        .all()
        .map((r) => r.payload_json),
      before,
      'order snapshots are untouched',
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT count(*) n FROM record_events WHERE event='source_changed'",
        )
        .get().n,
      0,
    );
    const list = async (q) =>
      await (
        await h.request(
          '/api/platform/tier1/shops/shop-a1/shopify/orders?limit=25' + q,
          { user: 'local-a' },
        )
      ).json();
    const all = await list('');
    assert.deepEqual(all.countries, ['DK', 'SE']);
    const swedish = all.orders.find((o) => o.country === 'SE');
    assert.match(swedish.customerTotal, /1\.450,00.*SEK/);
    assert.equal(
      all.orders.find((o) => o.country === 'DK').customerTotal,
      null,
    );
    assert.deepEqual(
      (await list('&country=SE')).orders.map((o) => o.id),
      ['#1'],
    );
    assert.equal((await list('&country=SE')).total, 1);
    assert.deepEqual(
      (await list('&country=unknown')).orders.map((o) => o.id),
      ['#3'],
    );
    assert.equal(
      (
        await h.request(
          '/api/platform/tier1/shops/shop-a1/shopify/orders?country=sverige',
          { user: 'local-a' },
        )
      ).status,
      400,
    );
  } finally {
    h.close();
  }
});

test('orders to another country or in another currency are held from invoicing and booking until markets are set up', async () => {
  const h = harness();
  try {
    h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run(
      'company-a',
      'shop-a1',
      JSON.stringify({
        automation: {
          sales: true,
          salesBookDinero: true,
          invoiceEmails: true,
        },
        syncIntervalMinutes: 15,
      }),
      'r1',
    );
    for (const provider of ['shopify', 'dinero'])
      h.sql
        .prepare(
          'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
        )
        .run('company-a', 'shop-a1', provider, '2026-09-01');
    const order = (n, country, currency) => {
      h.sql
        .prepare(
          "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','orders',?,?,?)",
        )
        .run(
          'gid://shopify/Order/' + n,
          '2026-09-02T10:00:00Z',
          JSON.stringify({
            id: 'gid://shopify/Order/' + n,
            name: '#' + n,
            createdAt: '2026-09-02T10:00:00Z',
            displayFulfillmentStatus: 'FULFILLED',
            fulfillments: [
              { createdAt: '2026-09-02T12:00:00Z', status: 'SUCCESS' },
            ],
            currentTotalPriceSet: {
              shopMoney: { amount: '100.00', currencyCode: 'DKK' },
            },
            totalRefundedSet: {
              shopMoney: { amount: '0.00', currencyCode: 'DKK' },
            },
            paymentGatewayNames: ['shopify_payments'],
          }),
        );
      h.sql
        .prepare(
          "INSERT INTO invoice_orders(company_id,webshop_id,external_id,name,created_at,payload_json) VALUES('company-a','shop-a1',?,?,'2026-09-02T10:00:00Z','{}')",
        )
        .run('gid://shopify/Order/' + n, '#' + n);
      if (country !== undefined)
        h.sql
          .prepare(
            "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) VALUES('company-a','shop-a1',?,?,?)",
          )
          .run('gid://shopify/Order/' + n, country, currency);
    };
    order(1, 'DK', 'DKK');
    order(2, 'SE', 'SEK');
    order(3, 'SE', 'DKK');
    order(4, 'DK', 'SEK');
    order(5);
    const touched = [];
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './order-markets': {
        ...loader()('platform/order-markets.ts'),
        fillOrderMarkets: async () => 0,
      },
      './invoices': {
        handleInvoices: async (req, env, actor, company, action) => {
          touched.push(
            'invoice:' + (await req.json()).externalId.split('/').pop(),
          );
          return Response.json({ invoice: { date: '2026-09-02T10:00:00Z' } });
        },
      },
      './production-sales': {
        handleProductionSale: async (req) => {
          const b = await req.json();
          touched.push('book:' + b.externalId.split('/').pop());
          return Response.json({ phase: 'booked' });
        },
      },
    });
    await load('platform/production-jobs.ts').runProductionJobs({
      ...h.env,
      PLATFORM_ENV: 'production',
      PLATFORM_EXTERNAL_WRITES: 'enabled',
    });
    assert.deepEqual(
      [...new Set(touched.map((t) => t.split(':')[1]))],
      ['1'],
      'only the domestic order; order 5 waits until its market is known',
    );
    // Manual actions are refused as well, with an explanation.
    const markets = loader()('platform/order-markets.ts');
    for (const n of [2, 3, 4])
      assert.equal(
        await markets.isForeignOrder(
          h.env.PLATFORM_DB,
          'company-a',
          'shop-a1',
          'gid://shopify/Order/' + n,
        ),
        true,
        String(n),
      );
    for (const n of [1, 5])
      assert.equal(
        await markets.isForeignOrder(
          h.env.PLATFORM_DB,
          'company-a',
          'shop-a1',
          'gid://shopify/Order/' + n,
        ),
        false,
        String(n),
      );
    const listed = (
      await (
        await h.request(
          '/api/platform/tier1/shops/shop-a1/shopify/orders?limit=25',
          { user: 'local-a' },
        )
      ).json()
    ).orders;
    assert.equal(
      listed.find((o) => o.id === '#2').status,
      'Afventer · marked ikke sat op',
    );
    assert.notEqual(
      listed.find((o) => o.id === '#1').status,
      'Afventer · marked ikke sat op',
    );
    const invoice = await h.request(
      '/api/platform/tier1/shops/shop-a1/invoices',
      {
        user: 'local-a',
        method: 'POST',
        body: { action: 'generate', externalId: 'gid://shopify/Order/2' },
      },
    );
    assert.equal(invoice.status, 409);
    assert.match(
      (await invoice.json()).error,
      /ikke er sat op til fakturering og bogføring/,
    );
  } finally {
    h.close();
  }
});

test('a refunded order stays Bogført and shows its original amount and what was realized', async () => {
  const h = harness();
  try {
    const original = {
      id: 'gid://shopify/Order/2683',
      name: '#2683',
      createdAt: '2026-10-02T08:00:00Z',
      displayFinancialStatus: 'PAID',
      displayFulfillmentStatus: 'FULFILLED',
      fulfillments: [{ createdAt: '2026-10-02T09:00:00Z', status: 'SUCCESS' }],
      paymentGatewayNames: ['MobilePay'],
      currentTotalPriceSet: {
        shopMoney: { amount: '5.24', currencyCode: 'DKK' },
      },
      totalRefundedSet: { shopMoney: { amount: '0.00', currencyCode: 'DKK' } },
    };
    // After a partial refund with a returned item, Shopify lowers the current total and raises the refunded amount.
    const refunded = {
      ...original,
      displayFinancialStatus: 'PARTIALLY_REFUNDED',
      currentTotalPriceSet: {
        shopMoney: { amount: '1.95', currencyCode: 'DKK' },
      },
      totalRefundedSet: { shopMoney: { amount: '3.29', currencyCode: 'DKK' } },
    };
    h.sql
      .prepare(
        "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','orders',?,?,?)",
      )
      .run(original.id, original.createdAt, JSON.stringify(refunded));
    h.sql
      .prepare(
        "INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES('company-a','123','x','r','[]')",
      )
      .run();
    h.sql
      .prepare(
        "INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES('company-a','shop-a1','shopify','orders',?,'123','booked','v',?)",
      )
      .run(
        original.id,
        JSON.stringify({ sourceJson: JSON.stringify(original) }),
      );
    h.sql
      .prepare(
        "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency,order_total,net_payment) VALUES('company-a','shop-a1',?,'DK','DKK','5.24','1.95')",
      )
      .run(original.id);
    const order = (
      await (
        await h.request(
          '/api/platform/tier1/shops/shop-a1/shopify/orders?limit=25',
          { user: 'local-a' },
        )
      ).json()
    ).orders.find((o) => o.id === '#2683');
    assert.equal(
      order.status,
      'Bogført',
      'a refund is booked on its own and does not change the booked sale',
    );
    assert.match(order.amount, /5,24/);
    assert.match(order.realized, /1,95/);
    // A cancellation after booking still counts as a change.
    h.sql
      .prepare(
        'UPDATE operation_snapshots SET payload_json=? WHERE external_id=?',
      )
      .run(
        JSON.stringify({ ...refunded, cancelledAt: '2026-10-02T10:00:00Z' }),
        original.id,
      );
    const cancelled = (
      await (
        await h.request(
          '/api/platform/tier1/shops/shop-a1/shopify/orders?limit=25',
          { user: 'local-a' },
        )
      ).json()
    ).orders.find((o) => o.id === '#2683');
    assert.equal(cancelled.status, 'Afstemt · ændret post');
  } finally {
    h.close();
  }
});

test('a refund is read the same way for every gateway, partial or full, and must add up to the money returned', () => {
  const { normalizeRefund } = loader()('platform/order-refunds.ts');
  const order = {
    id: 'gid://shopify/Order/2683',
    name: '#2683',
    taxesIncluded: true,
    totalPriceSet: refundMoney('1000.00'),
  };
  const partial = normalizeRefund(order, shopifyRefund(), 1);
  assert.equal(partial.problem, null);
  assert.equal(partial.gross, 40000);
  assert.equal(partial.full, false);
  assert.deepEqual(partial.gateways, [
    { gateway: 'mobilepay', name: 'MobilePay', amount: 40000 },
  ]);
  assert.deepEqual(
    partial.lines.map((l) => [l.kind, l.net, l.tax]),
    [['goods', 32000, 8000]],
    'the subtotal includes VAT in a shop with prices incl. VAT',
  );
  // Shopify may also give the subtotal without VAT; the reading that adds up is used.
  assert.deepEqual(
    normalizeRefund(
      order,
      shopifyRefund({ lines: [['Ring', '320.00', '80.00']] }),
      1,
    ).lines.map((l) => [l.net, l.tax]),
    [[32000, 8000]],
  );
  // Shipping, and a full refund through Shopify Payments.
  const full = normalizeRefund(
    order,
    shopifyRefund({
      lines: [['Ring', '950.00', '190.00']],
      shipping: [['50.00', '10.00']],
      transactions: [
        ['1000.00', 'shopify_payments', 'Shopify Payments', 'SUCCESS'],
      ],
    }),
    2,
  );
  assert.equal(full.full, true);
  assert.deepEqual(
    full.lines.map((l) => [l.kind, l.net + l.tax]),
    [
      ['goods', 95000],
      ['shipping', 5000],
    ],
  );
  // Less returned than the items: Shopify's discrepancy becomes a (negative) regulation with VAT.
  const less = normalizeRefund(
    order,
    shopifyRefund({
      adjustments: [['REFUND_DISCREPANCY', '50.00', '10.00']],
      transactions: [['350.00', 'viabill', 'ViaBill', 'SUCCESS']],
    }),
    1,
  );
  assert.deepEqual(
    less.lines.map((l) => [l.kind, l.net, l.tax]),
    [
      ['goods', 32000, 8000],
      ['services', -4000, -1000],
    ],
  );
  // Lines that do not add up, without a regulation, are never booked.
  assert.match(
    normalizeRefund(
      order,
      shopifyRefund({
        transactions: [['390.00', 'mobilepay', 'MobilePay', 'SUCCESS']],
      }),
      1,
    ).problem,
    /stemmer ikke/,
  );
  // Nothing returned yet (pending), or only a restock: not a refund to book.
  assert.equal(
    normalizeRefund(
      order,
      shopifyRefund({
        transactions: [['400.00', 'mobilepay', 'MobilePay', 'PENDING']],
      }),
      1,
    ),
    null,
  );
  // The voucher credits the clearing account the sale debited.
  const { refundVoucher } = loader()('platform/refund-voucher.ts');
  const mapping = {
    clearing: '55110',
    vatCode: 'U25',
    noVatCode: 'none',
    refundGoodsVat: '1000',
    refundGoodsNoVat: '1050',
    refundShippingVat: '1350',
    refundShippingNoVat: '1300',
    refundServicesVat: '1400',
    refundServicesNoVat: '1450',
  };
  const voucher = refundVoucher(
    {
      transactionId: less.id,
      orderName: '#2683',
      date: '2026-09-20',
      gross: less.gross,
      parts: less.lines.map((l) => ({
        kind: l.kind,
        net: l.net,
        tax: l.tax,
        description: l.title,
      })),
    },
    mapping,
  ).voucher;
  assert.deepEqual(
    voucher.Lines.map((l) => [l.AccountNumber, l.Amount]),
    [
      [55110, -350],
      [1000, 400],
      [1400, -50],
    ],
  );
});

test('refunds of refunded orders are fetched once per change, listed across gateways and wait for the sale before booking', async () => {
  const asked = [];
  const network = async (url, opt) => {
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'fixture' });
    const { query, variables } = JSON.parse(opt.body);
    if (!query.includes('ToolboxOrderRefunds'))
      throw Error('unexpected request');
    asked.push(variables.id);
    return Response.json({
      data: {
        order: {
          id: variables.id,
          name: '#2683',
          taxesIncluded: true,
          totalPriceSet: refundMoney('1000.00'),
          refunds: [
            shopifyRefund({
              id: 2,
              processedAt: '2026-09-22T10:00:00Z',
              lines: [['Kæde', '200.00', '40.00']],
              transactions: [['200.00', 'mobilepay', 'MobilePay', 'SUCCESS']],
            }),
            shopifyRefund(),
          ],
        },
      },
    });
  };
  const h = harness(jose, network),
    env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) };
  try {
    await testShopConnections(h, env);
    const order = (refunded) =>
      h.sql
        .prepare(
          "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','orders','gid://shopify/Order/2683','2026-09-10T10:00:00Z',?) ON CONFLICT DO UPDATE SET payload_json=excluded.payload_json",
        )
        .run(
          JSON.stringify({
            id: 'gid://shopify/Order/2683',
            name: '#2683',
            paymentGatewayNames: ['mobilepay'],
            currentTotalPriceSet: refundMoney('400.00'),
            totalRefundedSet: refundMoney(refunded),
          }),
        );
    order('400.00');
    for (const provider of ['shopify', 'dinero'])
      h.sql
        .prepare(
          'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
        )
        .run('company-a', 'shop-a1', provider, '2026-09-01');
    h.sql
      .prepare(
        "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) VALUES('company-a','shop-a1','gid://shopify/Order/2683','DK','DKK')",
      )
      .run();
    const { syncOrderRefunds } = loader({ jose, fetch: network })(
      'platform/order-refunds.ts',
    );
    assert.deepEqual(
      await syncOrderRefunds({ ...h.env, ...env }, 'company-a', 'shop-a1'),
      { orders: 1, refunds: 2 },
    );
    assert.deepEqual(
      await syncOrderRefunds({ ...h.env, ...env }, 'company-a', 'shop-a1'),
      { orders: 0, refunds: 0 },
      'an unchanged order is not asked again',
    );
    order('600.00');
    assert.equal(
      (await syncOrderRefunds({ ...h.env, ...env }, 'company-a', 'shop-a1'))
        .orders,
      1,
      'a new refund on the order is read',
    );
    assert.equal(asked.length, 2);
    const rows = h.sql
      .prepare(
        "SELECT external_id,json_extract(payload_json,'$.sequence') sequence FROM order_refunds ORDER BY occurred_at",
      )
      .all()
      .map((r) => [r.external_id.split('/').pop(), r.sequence]);
    assert.deepEqual(
      rows,
      [
        ['1', 1],
        ['2', 2],
      ],
      'credit notes are numbered in refund order',
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT count(*) n FROM record_events WHERE module='order_refunds' AND event='imported'",
        )
        .get().n,
      2,
    );
    const list = await (
      await h.request(
        '/api/platform/tier1/shops/shop-a1/order-refunds?from=2026-09-01&to=2026-09-30',
        { user: 'local-a' },
      )
    ).json();
    assert.deepEqual(
      list.refunds.map((r) => [
        r.orderName,
        r.amount,
        r.gateways.join(),
        r.full,
        r.booking,
      ]),
      [
        ['#2683', 200, 'MobilePay', false, 'sale_pending'],
        ['#2683', 400, 'MobilePay', false, 'sale_pending'],
      ],
    );
    assert.deepEqual(list.totals, [{ currency: 'DKK', count: 2, amount: 600 }]);
    // Once the sale is in Dinero the refunds are ready to book.
    h.sql
      .prepare(
        "INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES('company-a','shop-a1','shopify','orders','gid://shopify/Order/2683','org','booked','v','{}')",
      )
      .run();
    const { saleBookedSql } = loader()('platform/order-refunds.ts');
    assert.equal(
      h.sql
        .prepare(
          'SELECT count(*) n FROM order_refunds s WHERE ' + saleBookedSql,
        )
        .get().n,
      2,
    );
    assert.equal(
      (
        await h.request(
          '/api/platform/tier1/shops/shop-a1/order-refunds/credit-note?externalId=gid://shopify/Refund/1',
          { user: 'local-a' },
        )
      ).status,
      404,
      'no credit note for an order not invoiced here',
    );
  } finally {
    h.close();
  }
});

test('the schedule books refunds of domestic orders whose sale is booked, never twice and never a foreign one', async () => {
  const h = harness();
  try {
    h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run(
      'company-a',
      'shop-a1',
      JSON.stringify({
        automation: { refunds: true, refundsBookDinero: true },
        syncIntervalMinutes: 15,
      }),
      'r1',
    );
    for (const provider of ['shopify', 'dinero'])
      h.sql
        .prepare(
          'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
        )
        .run('company-a', 'shop-a1', provider, '2026-09-01');
    const refund = (n, country, sale, legacy) => {
      const id = 'gid://shopify/Refund/' + n,
        orderId = 'gid://shopify/Order/' + n;
      h.sql
        .prepare(
          "INSERT INTO order_refunds(company_id,webshop_id,external_id,order_id,occurred_at,payload_json) VALUES('company-a','shop-a1',?,?,'2026-09-20T10:00:00Z',?)",
        )
        .run(
          id,
          orderId,
          JSON.stringify({
            id,
            orderId,
            orderName: '#' + n,
            processedAt: '2026-09-20T10:00:00Z',
            currency: 'DKK',
            gross: 10000,
            problem: null,
            lines: [],
          }),
        );
      h.sql
        .prepare(
          "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) VALUES('company-a','shop-a1',?,?,'DKK')",
        )
        .run(orderId, country);
      if (sale)
        h.sql
          .prepare(
            "INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES('company-a','shop-a1','shopify','orders',?,'org','booked','v','{}')",
          )
          .run(orderId);
      if (legacy)
        h.sql
          .prepare(
            "INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES('company-a','shop-a1','shopify','refunds',?,'org','booked','v',?)",
          )
          .run(
            'gid://shopify/ShopifyPaymentsBalanceTransaction/' + n,
            JSON.stringify({ source: { refund: { id } } }),
          );
    };
    refund(1, 'DK', true, false);
    refund(2, 'DK', false, false);
    refund(3, 'SE', true, false);
    refund(4, 'DK', true, true);
    const booked = [];
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './order-markets': {
        ...loader()('platform/order-markets.ts'),
        fillOrderMarkets: async () => 0,
      },
      './order-refunds': {
        ...loader()('platform/order-refunds.ts'),
        syncOrderRefunds: async () => ({ orders: 0, refunds: 0 }),
      },
      './production-proposals': {
        handleProductionOther: async (req, env, actor, company, shop, kind) => {
          const b = await req.json();
          booked.push(
            kind + ':' + b.externalId.split('/').pop() + ':' + b.action,
          );
          return Response.json({
            phase: b.action === 'inspect' ? 'prepared' : 'booked',
            version: 'v',
          });
        },
      },
    });
    await load('platform/production-jobs.ts').runProductionJobs({
      ...h.env,
      PLATFORM_ENV: 'production',
      PLATFORM_EXTERNAL_WRITES: 'enabled',
    });
    assert.deepEqual(booked, [
      'order_refund:1:inspect',
      'order_refund:1:retry',
    ]);
  } finally {
    h.close();
  }
});

test('a post that keeps failing rings the bell once, with the post and the reason, and is retried with growing pauses', async () => {
  const h = harness();
  try {
    h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run(
      'company-a',
      'shop-a1',
      JSON.stringify({
        automation: { sales: true, salesBookDinero: true },
        syncIntervalMinutes: 15,
      }),
      'r1',
    );
    for (const provider of ['shopify', 'dinero'])
      h.sql
        .prepare(
          'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
        )
        .run('company-a', 'shop-a1', provider, '2026-09-01');
    h.sql
      .prepare(
        "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','orders','gid://shopify/Order/2701','2026-09-02T10:00:00Z',?)",
      )
      .run(
        JSON.stringify({
          id: 'gid://shopify/Order/2701',
          name: '#2701',
          test: false,
          cancelledAt: null,
          displayFulfillmentStatus: 'FULFILLED',
          fulfillments: [
            { createdAt: '2026-09-03T10:00:00Z', status: 'SUCCESS' },
          ],
          currentTotalPriceSet: {
            shopMoney: { amount: '100.00', currencyCode: 'DKK' },
          },
        }),
      );
    h.sql
      .prepare(
        "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) VALUES('company-a','shop-a1','gid://shopify/Order/2701','DK','DKK')",
      )
      .run();
    let load;
    load = loader({
      jose,
      'pdf-lib': pdfLib,
      './order-markets': {
        ...loader()('platform/order-markets.ts'),
        fillOrderMarkets: async () => 0,
      },
      './order-refunds': {
        ...loader()('platform/order-refunds.ts'),
        syncOrderRefunds: async () => ({ orders: 0, refunds: 0 }),
      },
      './invoices': {
        handleInvoices: async () => {
          const { InvoiceCheckError } = load('platform/invoice-check.ts');
          throw new InvoiceCheckError(
            'Ordren er ændret eller refunderet. Faktura/kreditnota skal gennemgås særskilt.',
          );
        },
      },
    });
    const jobs = load('platform/production-jobs.ts'),
      env = {
        ...h.env,
        PLATFORM_ENV: 'production',
        PLATFORM_EXTERNAL_WRITES: 'enabled',
      };
    const due = () =>
      h.sql.exec(
        'UPDATE production_jobs SET next_run_at=0,lease_until=0;UPDATE production_attempts SET next_attempt_at=0',
      );
    await jobs.runProductionJobs(env);
    const failed = () =>
      h.sql
        .prepare(
          "SELECT message FROM operation_runs WHERE module='auto.sales' AND status='failed'",
        )
        .all()
        .map((r) => r.message);
    assert.deepEqual(failed(), [
      'Ordre #2701: Ordren er ændret eller refunderet. Faktura/kreditnota skal gennemgås særskilt.',
    ]);
    assert.match(
      h.sql
        .prepare("SELECT details_json FROM record_events WHERE event='error'")
        .get().details_json,
      /ændret eller refunderet/,
      'the order log keeps the reason',
    );
    due();
    await jobs.runProductionJobs(env);
    assert.equal(
      failed().length,
      1,
      'a repeat of the same failure does not ring again',
    );
    const attempt = h.sql
      .prepare(
        "SELECT failures,next_attempt_at-attempted_at pause FROM production_attempts WHERE job='sales'",
      )
      .get();
    assert.deepEqual(
      [attempt.failures, attempt.pause],
      [2, 3600000],
      'the second failure waits an hour',
    );
  } finally {
    h.close();
  }
});

test('an order whose invoice was mailed and sale booked is not checked again after a later refund', async () => {
  const h = harness();
  try {
    h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run(
      'company-a',
      'shop-a1',
      JSON.stringify({
        automation: {
          sales: true,
          salesBookDinero: true,
          invoiceEmails: true,
        },
        syncIntervalMinutes: 15,
      }),
      'r1',
    );
    for (const provider of ['shopify', 'dinero'])
      h.sql
        .prepare(
          'INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)',
        )
        .run('company-a', 'shop-a1', provider, '2026-09-01');
    const order = (n) => {
      const id = 'gid://shopify/Order/' + n;
      h.sql
        .prepare(
          "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','orders',?,'2026-09-02T10:00:00Z',?)",
        )
        .run(
          id,
          JSON.stringify({
            id,
            name: '#' + n,
            test: false,
            cancelledAt: null,
            displayFulfillmentStatus: 'FULFILLED',
            displayFinancialStatus: 'PARTIALLY_REFUNDED',
            fulfillments: [
              { createdAt: '2026-09-03T10:00:00Z', status: 'SUCCESS' },
            ],
            currentTotalPriceSet: {
              shopMoney: { amount: '100.00', currencyCode: 'DKK' },
            },
          }),
        );
      h.sql
        .prepare(
          "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) VALUES('company-a','shop-a1',?,'DK','DKK')",
        )
        .run(id);
      return id;
    };
    const done = order(2683),
      open = order(2700);
    h.sql
      .prepare(
        "INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES('company-a','shop-a1','shopify','orders',?,'org','booked','v','{}')",
      )
      .run(done);
    h.sql
      .prepare(
        "INSERT INTO platform_invoices(company_id,webshop_id,external_id,id,fingerprint,status,r2_key,issuer_json,source_json) VALUES('company-a','shop-a1',?,'inv-2683','f','generated','k','{}','{}')",
      )
      .run(done);
    h.sql
      .prepare(
        "INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES('company-a','shop-a1','invoice','email','inv-2683','customer','accepted','v','{}')",
      )
      .run();
    const checked = [];
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './order-markets': {
        ...loader()('platform/order-markets.ts'),
        fillOrderMarkets: async () => 0,
      },
      './order-refunds': {
        ...loader()('platform/order-refunds.ts'),
        syncOrderRefunds: async () => ({ orders: 0, refunds: 0 }),
      },
      './invoices': {
        handleInvoices: async (req) => {
          checked.push((await req.json()).externalId);
          throw new HttpErrorForTest();
        },
      },
    });
    class HttpErrorForTest extends Error {}
    await load('platform/production-jobs.ts').runProductionJobs({
      ...h.env,
      PLATFORM_ENV: 'production',
      PLATFORM_EXTERNAL_WRITES: 'enabled',
      PLATFORM_CUSTOMER_EMAIL: 'enabled',
    });
    assert.ok(checked.length > 0);
    assert.ok(
      checked.every((id) => id === open),
      'only the unfinished order is checked',
    );
  } finally {
    h.close();
  }
});

test('an unexpected error in an automatic run is logged with an ID shown in the run log, never its details', async () => {
  const h = harness();
  try {
    h.sql
      .prepare(
        "INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted,verified_at) VALUES('company-a','shop-a1','shopify','a1.myshopify.com','x',CURRENT_TIMESTAMP)",
      )
      .run();
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './documents': { generatePayoutReport: async () => ({}) },
      './operations': {
        handleOperations: async () => {
          throw Error('internal detail with secret-token');
        },
      },
    });
    const logged = [],
      consoleError = console.error;
    console.error = (line) => logged.push(String(line));
    try {
      await load('platform/production-jobs.ts').runProductionJobs({
        ...h.env,
        PLATFORM_ENV: 'production',
        PLATFORM_EXTERNAL_WRITES: 'enabled',
      });
    } finally {
      console.error = consoleError;
    }
    const failed = h.sql
      .prepare(
        "SELECT module,message FROM operation_runs WHERE status='failed' AND module='auto.import.orders'",
      )
      .get();
    const id = failed.message.match(/Fejl-ID: ([a-f0-9]{8})$/)?.[1];
    assert.ok(id, failed.message);
    assert.doesNotMatch(failed.message, /secret-token/);
    const entry = JSON.parse(logged.find((line) => line.includes(id)));
    assert.equal(entry.job, 'auto.import.orders');
    assert.equal(entry.webshop, 'shop-a1');
    assert.match(entry.message, /internal detail/);
  } finally {
    h.close();
  }
});

test('a second automatic run that changes nothing adds no rows to the run log', async () => {
  const h = harness();
  try {
    h.sql
      .prepare(
        "INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted,verified_at) VALUES('company-a','shop-a1','shopify','a1.myshopify.com','x',CURRENT_TIMESTAMP)",
      )
      .run();
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './documents': { generatePayoutReport: async () => ({}) },
      './operations': {
        handleOperations: async () =>
          Response.json({
            count: 0,
            hasNextPage: false,
            endCursor: null,
            maxUpdatedAt: null,
            ids: [],
          }),
      },
    });
    const env = {
      ...h.env,
      PLATFORM_ENV: 'production',
      PLATFORM_EXTERNAL_WRITES: 'enabled',
    };
    const run = load('platform/production-jobs.ts').runProductionJobs;
    const log = () =>
      h.sql
        .prepare(
          "SELECT count(*) rows,sum(repeats) runs FROM operation_runs WHERE status='success'",
        )
        .get();
    await run(env);
    const first = log();
    assert.ok(first.rows > 0);
    h.sql
      .prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'")
      .run();
    await run(env);
    const second = log();
    assert.equal(second.rows, first.rows, 'no new rows');
    // Payouts and reports are read hourly, so not every job runs again within the same hour.
    assert.ok(second.runs > first.runs, 'but every run is counted');
  } finally {
    h.close();
  }
});

test('"Kræver handling" lists failed and uncertain posts, orders waiting for a market and refunds waiting for their sale', async () => {
  const h = harness();
  try {
    const db = h.sql,
      ago = (days) =>
        new Date(Date.now() - days * 86400000).toISOString().slice(0, 19) + 'Z';
    const order = (shop, n, days, extra = {}) =>
      db
        .prepare(
          "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a',?,'orders',?,?,?)",
        )
        .run(
          shop,
          'gid://shopify/Order/' + n,
          ago(days),
          JSON.stringify({
            id: 'gid://shopify/Order/' + n,
            name: '#' + n,
            currentTotalPriceSet: {
              shopMoney: { amount: '100.00', currencyCode: 'DKK' },
            },
            ...extra,
          }),
        );
    const receipt = (shop, provider, module, id, phase) =>
      db
        .prepare(
          "INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES('company-a',?,?,?,?,'org-1',?,'v','{}')",
        )
        .run(shop, provider, module, id, phase);
    const attempt = (shop, job, id, failures) =>
      db
        .prepare(
          "INSERT INTO production_attempts(company_id,webshop_id,job,external_id,attempted_at,next_attempt_at,failures) VALUES('company-a',?,?,?,?,?,?)",
        )
        .run(shop, job, id, Date.now() - 60000, Date.now() + 900000, failures);
    db.prepare(
      "INSERT INTO tier1_preferences(company_id,webshop_id,preferences_json,revision) VALUES('company-a','shop-a1',?,'r1')",
    ).run(JSON.stringify({ automation: { sales: true, refunds: true } }));
    // A failed sale with its reason, one that was booked by hand since, and a post that recovered (failures 0).
    order('shop-a1', 2701, 2);
    attempt('shop-a1', 'sales', 'gid://shopify/Order/2701', 3);
    db.prepare(
      "INSERT INTO record_events(company_id,webshop_id,provider,module,external_id,event,details_json) VALUES('company-a','shop-a1','shopify','orders','gid://shopify/Order/2701','error',?)",
    ).run(JSON.stringify({ stage: 'x', message: 'Momsen stemmer ikke.' }));
    order('shop-a1', 2702, 2);
    attempt('shop-a1', 'sales', 'gid://shopify/Order/2702', 1);
    receipt(
      'shop-a1',
      'shopify',
      'orders',
      'gid://shopify/Order/2702',
      'booked',
    );
    order('shop-a1', 2703, 2);
    attempt('shop-a1', 'sales', 'gid://shopify/Order/2703', 0);
    receipt(
      'shop-a1',
      'shopify',
      'orders',
      'gid://shopify/Order/2703',
      'booked',
    );
    // A stock regulation Dinero may not have received.
    receipt('shop-a1', 'shopify', 'stocktake', 'stocktake-1', 'uncertain');
    // A Swedish order without a Swedish market, and an old one beyond 90 days.
    order('shop-a1', 2704, 1);
    db.prepare(
      "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) VALUES('company-a','shop-a1','gid://shopify/Order/2704','SE','SEK')",
    ).run();
    order('shop-a1', 2705, 120);
    db.prepare(
      "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) VALUES('company-a','shop-a1','gid://shopify/Order/2705','SE','SEK')",
    ).run();
    // A two-day-old refund on an unbooked sale, and one on a booked sale (2703).
    const refund = (n, orderN, days) =>
      db
        .prepare(
          "INSERT INTO order_refunds(company_id,webshop_id,external_id,order_id,occurred_at,payload_json) VALUES('company-a','shop-a1',?,?,?,'{}')",
        )
        .run(
          'gid://shopify/Refund/' + n,
          'gid://shopify/Order/' + orderN,
          ago(days),
        );
    refund(9001, 2701, 2);
    refund(9003, 2703, 2);
    // Another webshop's failure is not shown.
    order('shop-a2', 2801, 1);
    attempt('shop-a2', 'sales', 'gid://shopify/Order/2801', 2);

    const get = async (user = 'local-a') =>
      (
        await h.request('/api/platform/tier1/shops/shop-a1/attention', { user })
      ).json();
    const data = await get();
    assert.deepEqual(data.counts, {
      failed: 1,
      uncertain: 1,
      market: 1,
      waiting: 1,
    });
    assert.equal(data.total, 4);
    const [failed, uncertain, market, waiting] = data.items;
    assert.equal(failed.title, 'Ordre #2701');
    assert.match(failed.detail, /^Momsen stemmer ikke\. Forsøgt 3 gange/);
    assert.equal(failed.view, 'orders');
    assert.deepEqual(
      [uncertain.title, uncertain.view],
      ['Lagerregulering stocktake-1', 'inventory'],
    );
    assert.deepEqual([market.title, market.view], ['Ordre #2704', 'settings']);
    assert.match(market.detail, /SE \(SEK\)/);
    assert.deepEqual(
      [waiting.title, waiting.view],
      ['Tilbagebetaling på ordre #2701', 'refunds'],
    );
    // Readers of the webshop see the same list; without automatic refunds and sales, the waiting kinds go.
    assert.equal((await get('local-reader')).total, 4);
    db.prepare(
      'UPDATE tier1_preferences SET preferences_json=\'{"automation":{}}\'',
    ).run();
    assert.deepEqual((await get()).counts, {
      failed: 1,
      uncertain: 1,
      market: 0,
      waiting: 0,
    });
    assert.equal(
      (
        await h.request('/api/platform/tier1/shops/shop-a1/attention', {
          user: 'local-a',
          method: 'POST',
          body: {},
        })
      ).status,
      405,
    );
  } finally {
    h.close();
  }
});

test('a Flatpay payout covering several settlements is read, checked, booked as one voucher and reported', async () => {
  const h = harness();
  try {
    const payment = {
      paymentID: '12346',
      merchantID: 'm',
      agreementNumber: '11',
      paidDate: '2026-10-05T00:00:00',
      currency: 'DKK',
      payoutAmount: 147,
      settlements: '56789, 56790',
    };
    const base = {
      merchantID: 'm',
      agreementNumber: '11',
      currency: 'DKK',
      transactions: '1',
      refundAmount: 0,
      chargeback: 0,
      rollingReserve: 0,
      rollingRelease: 0,
      addedSum: 0,
      deductedSum: 0,
      balanceTransfer: 0,
      reversals: 0,
    };
    const settlements = {
      56789: {
        ...base,
        settlementNumber: '56789',
        grossPurchase: 100,
        grossSettlement: 100,
        netPurchase: 100,
        netSettlement: 98,
        payout: 98,
        feeAmount: 2,
        deduction: 2,
      },
      56790: {
        ...base,
        settlementNumber: '56790',
        grossPurchase: 50,
        grossSettlement: 50,
        netPurchase: 50,
        netSettlement: 49,
        payout: 49,
        feeAmount: 1,
        deduction: 1,
      },
    };
    const tx = (id, number, gross, fee) => ({
      transactionID: id,
      settlementNumber: number,
      merchantID: 'm',
      agreementID: 'a',
      purchaseDate: '2026-10-03',
      transactionCode: 'Purchase',
      currency: 'DKK',
      grossAmount: gross,
      fees: fee,
      netAmount: gross - fee,
    });
    const transactions = {
      56789: [tx('9', '56789', 100, 2)],
      56790: [tx('10', '56790', 50, 1)],
    };
    h.sql
      .prepare(
        "INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES('company-a','shop-a1','flatpay','f','{\"merchantID\":\"m\",\"agreementNumber\":\"11\",\"agreementId\":\"a\"}','x','2026-01-01')",
      )
      .run();
    let current = payment;
    const reads = [];
    const load = loader({
      jose,
      'pdf-lib': pdfLib,
      './connections': {
        unseal: async () => ({ username: 'u', password: 'p' }),
      },
      './flatpay-read': {
        flatpayRead: async (c, resource, q) => {
          reads.push(resource + ':' + q.SettlementNumber);
          return resource === 'payments'
            ? [current]
            : resource === 'settlements'
              ? [settlements[q.SettlementNumber]]
              : transactions[q.SettlementNumber];
        },
      },
    });
    const { readFlatpayPayout } = load('platform/flatpay-payout.ts');
    const read = await readFlatpayPayout(
      h.env,
      'company-a',
      'shop-a1',
      '12346',
      payment.settlements,
    );
    assert.deepEqual(reads, [
      'payments:56789',
      'settlements:56789',
      'transactions:56789',
      'settlements:56790',
      'transactions:56790',
    ]);
    assert.equal(read.settlements.length, 2);
    assert.equal(read.source.payment.settlements, '56789,56790');
    assert.deepEqual(
      read.source.transactions.map((t) => t.transactionID),
      ['10', '9'],
    );
    // The voucher is the bank payout, and the report holds both settlements.
    const { flatpayDraft } = load('platform/flatpay-draft.ts');
    const draft = flatpayDraft(read.payment, read.settlements, {
      bank: 55000,
      clearing: 55110,
      fees: 7220,
      flatpay: 55105,
    });
    assert.deepEqual([draft.gross, draft.fees, draft.net], [15000, 300, 14700]);
    const { buildFlatpayReport } = load('platform/flatpay-report.ts');
    assert.ok(
      (
        await pdfLib.PDFDocument.load(await buildFlatpayReport(read.source))
      ).getPageCount() >= 1,
    );
    // A payout whose settlement list changed since it was saved, or whose settlements do not make the payout, is refused.
    current = { ...payment, settlements: '56789' };
    await assert.rejects(
      () =>
        readFlatpayPayout(
          h.env,
          'company-a',
          'shop-a1',
          '12346',
          payment.settlements,
        ),
      /ændret/,
    );
    current = { ...payment, payoutAmount: 150 };
    await assert.rejects(
      () =>
        readFlatpayPayout(
          h.env,
          'company-a',
          'shop-a1',
          '12346',
          payment.settlements,
        ),
      /stemmer ikke/,
    );
    await assert.rejects(
      () => readFlatpayPayout(h.env, 'company-a', 'shop-a1', '12346', 'x'),
      /kan ikke læses/,
    );
  } finally {
    h.close();
  }
});
