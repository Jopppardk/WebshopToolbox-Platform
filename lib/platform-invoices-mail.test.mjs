// Invoices, invoice mail and senders, markets per country and credit notes.
import {
  test,
  assert,
  jose,
  pdfLib,
  fixture,
  loader,
  validateConfig,
  read,
  harness,
  mailFixture,
  invoiceHarness,
  testShopConnections,
} from './platform-harness.mjs';

test('company mail isolates settings, validates headers, hides credentials and uses standard fallback until verified', async () => {
  const h = harness(),
    base = '/api/platform/companies/company-a/mail';
  try {
    const get = await (await h.request(base, { user: 'local-a' })).json();
    assert.equal(get.effectiveFrom, 'faktura@webshoptoolbox.dk');
    assert.equal((await h.request(base, { user: 'local-b' })).status, 403);
    assert.equal(
      (
        await h.request(base, {
          user: 'local-reader',
          method: 'PUT',
          body: { senderName: 'A' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request(base, {
          user: 'local-a',
          method: 'PUT',
          body: { senderName: 'A\r\nB' },
        })
      ).status,
      400,
    );
    const input = {
      senderName: 'Test A',
      replyTo: 'contact@example.test',
      customFrom: 'invoice@a.example.test',
      accountId: 'a'.repeat(32),
      apiToken: 'synthetic-test-token-value-12345',
      status: 'verified',
    };
    const response = await h.request(base, {
      user: 'local-a',
      method: 'PUT',
      body: input,
      env: { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) },
    });
    assert.equal(response.status, 200, await response.clone().text());
    const saved = await response.json();
    assert.equal(saved.status, 'pending');
    assert.equal(saved.effectiveFrom, get.effectiveFrom);
    assert.equal(saved.credentialsSaved, true);
    assert.ok(!JSON.stringify(saved).includes(input.apiToken));
    const encrypted = h.sql
      .prepare('SELECT credentials_encrypted FROM company_mail')
      .get().credentials_encrypted;
    assert.ok(!encrypted.includes(input.apiToken));
    const { unseal } = loader()('platform/connections.ts');
    await assert.rejects(() =>
      unseal(
        {
          PLATFORM_ENV: 'local-test',
          PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32),
        },
        ['company-b', 'mail', input.customFrom, input.accountId],
        encrypted,
      ),
    );
    assert.equal(
      (
        await h.request(base, {
          user: 'local-a',
          method: 'PUT',
          body: { ...input, customFrom: 'new@a.example.test', apiToken: '' },
        })
      ).status,
      400,
    );
    const reset = await (
      await h.request(base, {
        user: 'local-a',
        method: 'PUT',
        body: {
          senderName: 'Test A',
          replyTo: 'contact@example.test',
          customFrom: '',
        },
      })
    ).json();
    assert.equal(reset.status, 'standard');
    assert.equal(reset.credentialsSaved, false);
  } finally {
    h.close();
  }
});
test('test mail is restricted to authenticated recipients, rate limited and idempotent across concurrent requests', async () => {
  const h = mailFixture();
  let sent = 0;
  const messages = [];
  h.env.PLATFORM_MAIL_TEST = {
    send: async (m) => {
      sent++;
      messages.push(m);
      return { messageId: 'fixture-receipt' };
    },
  };
  try {
    await assert.rejects(
      () =>
        h.call({
          requestId: crypto.randomUUID(),
          mode: 'standard',
          recipient: 'victim@example.test',
        }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      () =>
        h.call(
          { requestId: crypto.randomUUID(), mode: 'standard' },
          { ...h.actor, support: { adminId: 'local-admin' } },
        ),
      (e) => e.status === 403,
    );
    await assert.rejects(
      () =>
        h.call(
          { requestId: crypto.randomUUID(), mode: 'standard' },
          { ...h.actor, email: 'not-approved@example.test' },
        ),
      (e) => e.status === 403,
    );
    const id = crypto.randomUUID();
    const responses = await Promise.allSettled([
      h.call({ requestId: id, mode: 'standard' }),
      h.call({ requestId: id, mode: 'standard' }),
    ]);
    assert.equal(sent, 1);
    assert.equal(
      (await (await h.call({ requestId: id, mode: 'standard' })).json()).status,
      'accepted',
    );
    assert.equal(sent, 1);
    await assert.rejects(
      () => h.call({ requestId: crypto.randomUUID(), mode: 'standard' }),
      (e) => e.status === 429,
    );
    const b = await (
      await h.call(
        { requestId: id, mode: 'standard' },
        { ...h.actor, id: 'local-b', email: 'b@example.test' },
        'company-b',
      )
    ).json();
    assert.equal(b.status, 'accepted');
    assert.equal(sent, 2);
    assert.deepEqual(
      messages.map((m) => m.to),
      ['a@example.test', 'b@example.test'],
    );
  } finally {
    h.close();
  }
});
test('uncertain test sends never retry the same request or claim successful delivery', async () => {
  const h = mailFixture();
  let sent = 0;
  h.env.PLATFORM_MAIL_TEST = {
    send: async () => {
      sent++;
      throw Error('secret-provider-token');
    },
  };
  try {
    const body = { requestId: crypto.randomUUID(), mode: 'standard' };
    const result = await (await h.call(body)).json();
    assert.equal(result.status, 'uncertain');
    assert.ok(!JSON.stringify(result).includes('secret'));
    assert.equal((await (await h.call(body)).json()).status, 'uncertain');
    assert.equal(sent, 1);
  } finally {
    h.close();
  }
});
test('custom Cloudflare mail verifies only the saved revision using a fixed endpoint and no redirects', async () => {
  const requests = [];
  const h = mailFixture(async (url, options) => {
    requests.push({ url, options });
    return Response.json({
      success: true,
      result: {
        delivered: [],
        queued: ['a@example.test'],
        permanent_bounces: [],
      },
    });
  });
  h.env.PLATFORM_MAIL_TEST = {
    send: async () => {
      throw Error('must not use standard');
    },
  };
  try {
    await h.call(
      {
        senderName: 'A',
        replyTo: 'reply@a.example.test',
        customFrom: 'invoice@a.example.test',
        accountId: 'a'.repeat(32),
        apiToken: 'synthetic-token-123456789',
      },
      h.actor,
      'company-a',
      '',
      'PUT',
    );
    const result = await (
      await h.call({ requestId: crypto.randomUUID(), mode: 'custom' })
    ).json();
    assert.equal(result.status, 'accepted');
    assert.equal(
      requests[0].url,
      'https://api.cloudflare.com/client/v4/accounts/' +
        'a'.repeat(32) +
        '/email/sending/send',
    );
    assert.equal(requests[0].options.redirect, 'manual');
    assert.deepEqual(JSON.parse(requests[0].options.body).from, {
      address: 'invoice@a.example.test',
      name: 'A',
    });
    assert.equal(
      JSON.parse(requests[0].options.body).reply_to,
      'reply@a.example.test',
    );
    const saved = h.sql.prepare('SELECT * FROM company_mail').get();
    assert.equal(saved.verified_revision, saved.revision);
    await h.call(
      {
        senderName: 'A',
        customFrom: 'new@a.example.test',
        accountId: 'a'.repeat(32),
        apiToken: 'different-token-123456789',
      },
      h.actor,
      'company-a',
      '',
      'PUT',
    );
    assert.equal(
      h.sql.prepare('SELECT verified_revision FROM company_mail').get()
        .verified_revision,
      null,
    );
  } finally {
    h.close();
  }
});
test('custom mail cannot promote a setting edited while sending, and local preview never sends', async () => {
  let h;
  h = mailFixture(async () => {
    h.sql.prepare("UPDATE company_mail SET revision='new-revision'").run();
    return Response.json({
      success: true,
      result: { delivered: ['a@example.test'] },
    });
  });
  h.env.PLATFORM_MAIL_TEST = {
    send: async () => {
      throw Error('unexpected');
    },
  };
  try {
    await h.call(
      {
        senderName: 'A',
        customFrom: 'invoice@a.example.test',
        accountId: 'a'.repeat(32),
        apiToken: 'synthetic-token-123456789',
      },
      h.actor,
      'company-a',
      '',
      'PUT',
    );
    await h.call({ requestId: crypto.randomUUID(), mode: 'custom' });
    assert.equal(
      h.sql.prepare('SELECT verified_revision FROM company_mail').get()
        .verified_revision,
      null,
    );
    h.env.PLATFORM_ENV = 'local-test';
    h.sql.prepare('DELETE FROM mail_test_deliveries').run();
    const preview = await (
      await h.call({ requestId: crypto.randomUUID(), mode: 'standard' })
    ).json();
    assert.equal(preview.status, 'preview');
  } finally {
    h.close();
  }
});
test('test mail binding permits invoice recipients but cannot change sender or add hidden restrictions', () => {
  const cfg = JSON.parse(read('wrangler.platform-test.json'));
  validateConfig(cfg, true);
  const unsafe = structuredClone(cfg);
  unsafe.send_email[1].allowed_destination_addresses = ['hidden@example.test'];
  assert.throws(() => validateConfig(unsafe, true));
});

test('platform invoices isolate overlapping IDs, preserve changed invoices and enforce document permissions', async () => {
  const h = await invoiceHarness();
  try {
    for (const shop of ['shop-a1', 'shop-a2']) {
      assert.equal((await h.call('sync', { webshopId: shop })).status, 200);
      const r = await h.call('generate', h.input(shop));
      assert.equal(r.status, 200, await r.text());
    }
    assert.equal(h.objects.size, 2);
    const keys = [...h.objects.keys()];
    assert.ok(keys.some((k) => k.includes('/shop-a1/')));
    assert.ok(keys.some((k) => k.includes('/shop-a2/')));
    const pdf = await h.call('pdf?' + new URLSearchParams(h.input('shop-a1')));
    assert.equal(pdf.status, 200);
    assert.equal(
      (await pdfLib.PDFDocument.load(await pdf.arrayBuffer())).getPageCount(),
      1,
    );
    assert.equal(
      (
        await h.call(
          'pdf?' + new URLSearchParams(h.input('shop-a2')),
          undefined,
          { user: 'local-reader' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.call(
          'pdf?' + new URLSearchParams(h.input('shop-a1')),
          undefined,
          { user: 'local-b' },
        )
      ).status,
      403,
    );
    const reader = await (
      await h.call('', undefined, { user: 'local-reader' })
    ).json();
    assert.deepEqual(
      reader.orders.map((r) => r.webshop_id),
      ['shop-a1'],
    );
    assert.equal(
      (await h.call('generate', h.input('shop-a1'), { user: 'local-reader' }))
        .status,
      403,
    );
    const original = [...h.objects.values()].map((b) =>
      Buffer.from(b).toString('base64'),
    );
    const reused = await (await h.call('generate', h.input('shop-a1'))).json();
    assert.equal(reused.existing, true);
    h.order.billingAddress.name = 'Ændret modtager';
    const changed = await h.call('generate', h.input('shop-a1'));
    assert.equal(changed.status, 409);
    assert.match((await changed.json()).error, /bevares/);
    assert.deepEqual(
      [...h.objects.values()].map((b) => Buffer.from(b).toString('base64')),
      original,
    );
  } finally {
    h.close();
  }
});

test('invoice validation and durable generation claims prevent unsafe retries and duplicate PDFs', async () => {
  const h = await invoiceHarness();
  try {
    await h.call('sync', { webshopId: 'shop-a1' });
    h.order.displayFulfillmentStatus = 'UNFULFILLED';
    const r = await h.call('generate', h.input('shop-a1'));
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /Afventer/);
    assert.equal(h.objects.size, 0);
    h.order.displayFulfillmentStatus = 'FULFILLED';
    const responses = await Promise.all([
      h.call('generate', h.input('shop-a1')),
      h.call('generate', h.input('shop-a1')),
    ]);
    assert.ok(responses.some((r) => r.status === 200));
    assert.equal(h.objects.size, 1);
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM platform_invoices').get().n,
      1,
    );
    await h.call('sync', { webshopId: 'shop-a2' });
    h.failStore();
    // An unexpected error is logged with an ID that the user also sees; the request body is never logged.
    const logged = [],
      consoleError = console.error;
    console.error = (line) => logged.push(line);
    let failed;
    try {
      failed = await h.call('generate', h.input('shop-a2'));
    } finally {
      console.error = consoleError;
    }
    assert.equal(failed.status, 500);
    const { error, errorId } = await failed.json();
    assert.match(errorId, /^[a-f0-9]{8}$/);
    assert.equal(
      error,
      `Handlingen kunne ikke gennemføres. Fejl-ID: ${errorId}`,
    );
    const entry = JSON.parse(logged.find((line) => line.includes(errorId)));
    assert.equal(entry.method, 'POST');
    assert.equal(
      entry.path,
      '/api/platform/companies/company-a/invoices/generate',
    );
    assert.doesNotMatch(JSON.stringify(entry), /shop-a2|externalId/);
    assert.equal((await h.call('generate', h.input('shop-a2'))).status, 409);
    assert.equal(
      h.sql
        .prepare(
          "SELECT status FROM platform_invoices WHERE webshop_id='shop-a2'",
        )
        .get().status,
      'generating',
    );
  } finally {
    h.close();
  }
});

test('invoice test sends scoped PDF and rendered template only to self, with no retry after uncertainty', async () => {
  const h = await invoiceHarness();
  try {
    await h.call('sync', { webshopId: 'shop-a1' });
    await h.call('generate', h.input('shop-a1'));
    const handle = loader({ jose, 'pdf-lib': pdfLib, fetch: h.network })(
      'platform/invoices.ts',
    ).handleInvoices;
    let sends = 0,
      sentMessage;
    const env = {
      ...h.env,
      PLATFORM_ENV: 'remote-test',
      PLATFORM_MAIL_FROM: 'faktura@webshoptoolbox.dk',
      PLATFORM_MAIL_TEST_RECIPIENTS: 'a@example.test',
      PLATFORM_MAIL_TEST: {
        send: async (m) => {
          sends++;
          sentMessage = m;
          throw Error('uncertain network');
        },
      },
    };
    // Re-encrypt only synthetic Shopify credentials for the remote-test test harness.
    const { seal } = loader()('platform/connections.ts');
    h.sql
      .prepare(
        "UPDATE webshop_connections SET credentials_encrypted=? WHERE webshop_id='shop-a1'",
      )
      .run(
        await seal(
          env,
          ['company-a', 'shop-a1', 'shopify', 'a1.myshopify.com'],
          { clientId: 'fixture-client', clientSecret: 'fixture-secret' },
        ),
      );
    const id = crypto.randomUUID(),
      actor = { id: 'local-a', email: 'a@example.test', platformAdmin: false };
    const send = () =>
      handle(
        new Request(
          'https://dev.example.test/api/platform/companies/company-a/invoices/test',
          {
            method: 'POST',
            headers: {
              origin: 'https://dev.example.test',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              ...h.input('shop-a1'),
              mode: 'standard',
              requestId: id,
            }),
          },
        ),
        env,
        actor,
        'company-a',
        'test',
      );
    assert.equal((await (await send()).json()).status, 'uncertain');
    assert.equal((await (await send()).json()).status, 'uncertain');
    assert.equal(sends, 1);
    assert.equal(sentMessage.to, 'a@example.test');
    assert.match(
      sentMessage.subject,
      /\[TEST\] Faktura TEST-999999 fra Eksempelhandel/,
    );
    assert.match(sentMessage.text, /Testkunde/);
    assert.equal(sentMessage.attachments[0].type, 'application/pdf');
    assert.equal(
      (
        await pdfLib.PDFDocument.load(sentMessage.attachments[0].content)
      ).getPageCount(),
      1,
    );
    assert.equal(
      h.sql
        .prepare('SELECT status FROM mail_test_deliveries WHERE request_id=?')
        .get(id).status,
      'uncertain',
    );
  } finally {
    h.close();
  }
});

test('demo invoice email matches saved preview, accepts a validated recipient and remains idempotent', async () => {
  const h = await invoiceHarness();
  try {
    const handle = loader({
      jose,
      'pdf-lib': pdfLib,
      fetch: async () => {
        throw Error('Demo must not contact Shopify');
      },
    })('platform/invoices.ts').handleInvoices;
    let sends = 0,
      message;
    const env = {
      ...h.env,
      PLATFORM_ENV: 'remote-test',
      PLATFORM_MAIL_FROM: 'faktura@webshoptoolbox.dk',
      PLATFORM_MAIL_TEST_RECIPIENTS: 'a@example.test',
      PLATFORM_MAIL_TEST: {
        send: async (m) => {
          sends++;
          message = m;
          return { messageId: 'demo-receipt' };
        },
      },
    };
    const actor = {
        id: 'local-a',
        email: 'a@example.test',
        platformAdmin: false,
      },
      requestId = crypto.randomUUID();
    const recipient = 'customer@example.test';
    const send = (to = recipient, webshopId = 'shop-a1', who = actor) =>
      handle(
        new Request('https://dev.example.test/demo', {
          method: 'POST',
          headers: {
            origin: 'https://dev.example.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ recipient: to, webshopId, requestId }),
        }),
        env,
        who,
        'company-a',
        'example-test',
      );
    const preview = await handle(
      new Request('https://dev.example.test/preview?webshopId=shop-a1'),
      env,
      actor,
      'company-a',
      'preview',
    );
    assert.equal(preview.status, 200);
    assert.equal((await (await send()).json()).status, 'accepted');
    assert.equal((await (await send()).json()).status, 'accepted');
    assert.equal(sends, 1);
    assert.deepEqual(
      Buffer.from(message.attachments[0].content),
      Buffer.from(await preview.arrayBuffer()),
    );
    assert.equal(message.from.name, 'Eksempelhandel ApS');
    assert.match(message.subject, /TEST · DEMO/);
    assert.match(message.text, /Eksempelkunde/);
    assert.equal(message.attachments[0].filename, 'eksempelfaktura.pdf');
    assert.equal(message.to, recipient);
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM platform_invoices').get().n,
      0,
    );
    assert.equal(h.objects.size, 0);
    assert.equal(h.calls, 0);
    await assert.rejects(() => send('ikke-en-mail'), /gyldig mailadresse/);
    await assert.rejects(
      () =>
        send('someone@example.test', 'shop-a1', {
          ...actor,
          support: { adminId: 'local-admin' },
        }),
      /supportadgang/,
    );
    await assert.rejects(() => send(actor.email, 'shop-b1'));
  } finally {
    h.close();
  }
});

test('unified demo test verifies a pending custom sender and never falls back on failure', async () => {
  const h = await invoiceHarness();
  try {
    let calls = 0,
      fail = false;
    const modules = loader({
      jose,
      'pdf-lib': pdfLib,
      fetch: async (url, options) => {
        calls++;
        assert.match(url, /api.cloudflare.com/);
        const body = JSON.parse(options.body);
        assert.equal(body.from.address, 'invoice@a.example.test');
        assert.equal(body.to, 'demo@example.test');
        assert.equal(body.attachments[0].filename, 'eksempelfaktura.pdf');
        if (fail) throw Error('timeout');
        return Response.json({
          success: true,
          result: { queued: ['demo@example.test'] },
        });
      },
    });
    const env = {
      ...h.env,
      PLATFORM_ENV: 'remote-test',
      PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32),
      PLATFORM_MAIL_TEST: {
        send: async () => {
          throw Error('Standard sender must not be used');
        },
      },
    };
    const actor = {
      id: 'local-a',
      email: 'a@example.test',
      platformAdmin: false,
    };
    await modules('platform/mail.ts').handleMail(
      new Request('https://dev.example.test/sender', {
        method: 'PUT',
        headers: {
          origin: 'https://dev.example.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          senderName: 'A',
          customFrom: 'invoice@a.example.test',
          accountId: 'a'.repeat(32),
          apiToken: 'synthetic-token-123456789',
        }),
      }),
      env,
      actor,
      'company-a',
    );
    assert.equal(
      h.sql.prepare('SELECT verified_revision FROM company_mail').get()
        .verified_revision,
      null,
    );
    const send = (id) =>
      modules('platform/invoices.ts').handleInvoices(
        new Request('https://dev.example.test/demo', {
          method: 'POST',
          headers: {
            origin: 'https://dev.example.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            recipient: 'demo@example.test',
            webshopId: 'shop-a1',
            requestId: id,
          }),
        }),
        env,
        actor,
        'company-a',
        'example-test',
      );
    const id = crypto.randomUUID();
    assert.equal((await (await send(id)).json()).status, 'accepted');
    const saved = h.sql.prepare('SELECT * FROM company_mail').get();
    assert.equal(saved.revision, saved.verified_revision);
    assert.equal((await (await send(id)).json()).status, 'accepted');
    assert.equal(calls, 1);
    h.sql.prepare('UPDATE mail_test_deliveries SET created_at=0').run();
    fail = true;
    const failedId = crypto.randomUUID();
    assert.equal((await (await send(failedId)).json()).status, 'uncertain');
    assert.equal(
      h.sql.prepare('SELECT verified_revision FROM company_mail').get()
        .verified_revision,
      null,
    );
    assert.equal((await (await send(failedId)).json()).status, 'uncertain');
    assert.equal(calls, 2);
  } finally {
    h.close();
  }
});

test('Shopify invoice pagination rejects repeated cursors and changed line revisions', async () => {
  const access = { shop: 'a1.myshopify.com', accessToken: 'fixture-token' };
  const repeated = loader({
    fetch: async () =>
      Response.json({
        data: {
          orders: {
            nodes: [],
            pageInfo: { hasNextPage: true, endCursor: 'same' },
          },
        },
      }),
  })('platform/invoice-source.ts');
  await assert.rejects(
    () => repeated.listInvoiceOrders(access, 'same', '2026-01-01'),
    /fuldstændigt/,
  );
  const order = fixture();
  order.lineItems.pageInfo = { hasNextPage: true, endCursor: 'line-cursor' };
  const changed = loader({
    fetch: async () =>
      Response.json({
        data: { order: { id: order.id, updatedAt: 'changed' } },
      }),
  })('platform/invoice-source.ts');
  await assert.rejects(
    () => changed.completeOrder(order, access),
    /ændret under kontrollen/,
  );
});
test('invoice template accepts 4000 characters and latest test fails safely without a PDF', async () => {
  const h = harness();
  try {
    const base = '/api/platform/companies/company-a/invoices';
    const settings = {
      name: 'Firma',
      address: 'Testvej 1',
      cvr: '12345678',
      contact: 'test@example.test',
      months: 3,
      subject: 'Faktura {{fakturanummer}}',
      body: 'a'.repeat(4000),
    };
    // Before anything is saved the issuer defaults to the company's own name.
    assert.equal(
      (await (await h.request(base + '/settings', { user: 'local-a' })).json())
        .name,
      'Testvirksomhed A',
    );
    assert.equal(
      (
        await h.request(base + '/settings', {
          user: 'local-a',
          method: 'PUT',
          body: settings,
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await h.request(base + '/settings', { user: 'local-a' })).json())
        .body.length,
      4000,
    );
    assert.equal(
      (
        await h.request(base + '/settings', {
          user: 'local-a',
          method: 'PUT',
          body: { ...settings, body: 'a'.repeat(4001) },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.request(base + '/test-latest', {
          user: 'local-a',
          method: 'POST',
          body: { requestId: crypto.randomUUID(), mode: 'standard' },
        })
      ).status,
      409,
    );
  } finally {
    h.close();
  }
});

test('platform invoice display groups engraving under its physical product without changing financial lines', () => {
  const { invoiceDisplayLines } = loader()('platform/invoice-line-order.ts');
  const lines = [
    { kind: 'service', title: 'Indgravering linje 2', id: 'e2' },
    { kind: 'service', title: 'Indgravering linje 1', id: 'e1' },
    { kind: 'goods', title: 'Et generisk produkt', id: 'p1' },
    { kind: 'shipping', title: 'Fragt', id: 's1' },
  ];
  const before = JSON.stringify(lines);
  assert.deepEqual(
    invoiceDisplayLines(lines).map((l) => l.id),
    ['p1', 'e1', 'e2', 's1'],
  );
  assert.equal(JSON.stringify(lines), before);
});

test('invoice designer isolates logos, validates uploads and previews without creating invoices', async () => {
  const h = harness(),
    files = new Map(),
    base = '/api/platform/tier1/shops/shop-a1/invoices';
  const env = {
    PLATFORM_DOCUMENTS: {
      put: async (k, v) => files.set(k, new Uint8Array(v)),
      get: async (k) =>
        files.has(k)
          ? {
              body: files.get(k),
              arrayBuffer: async () => files.get(k).slice().buffer,
            }
          : null,
    },
  };
  const get = (path) => h.request(base + path, { user: 'local-a', env });
  try {
    const initial = await (await get('/settings')).json();
    assert.equal(initial.revision, 0);
    const settings = {
      ...initial,
      name: 'Firma A',
      address: 'Testvej 1',
      cvr: '12345678',
      contact: 'faktura@firma.test',
      design: {
        accent: '#245b70',
        layout: 'modern',
        footer: 'Tak for din ordre',
      },
    };
    assert.equal(
      (
        await h.request(base + '/settings', {
          user: 'local-reader',
          method: 'PUT',
          body: settings,
          env,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request(base + '/settings', {
          user: 'local-a',
          method: 'PUT',
          body: { ...settings, design: { ...settings.design, accent: 'red' } },
          env,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.request(base + '/settings', {
          user: 'local-a',
          method: 'PUT',
          body: settings,
          env,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request(base + '/settings', {
          user: 'local-a',
          method: 'PUT',
          body: settings,
          env,
        })
      ).status,
      409,
    );
    const before = h.sql
      .prepare('SELECT count(*) n FROM platform_invoices')
      .get().n;
    const preview = await get('/preview');
    assert.equal(preview.status, 200, await preview.clone().text());
    assert.equal(preview.headers.get('content-type'), 'application/pdf');
    assert.equal(
      (
        await pdfLib.PDFDocument.load(await preview.arrayBuffer())
      ).getPageCount(),
      1,
    );
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM platform_invoices').get().n,
      before,
    );
    assert.equal(files.size, 0);
    assert.equal(
      (await h.request(base + '/preview', { user: 'local-b', env })).status,
      404,
    );
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
      'base64',
    );
    const upload = (data, user = 'local-a', origin = 'http://127.0.0.1:8790') =>
      h.request(base + '/logo', {
        user,
        env,
        method: 'PUT',
        rawBody: data,
        headers: { origin, 'content-type': 'image/png' },
      });
    assert.equal((await upload(png, 'local-reader')).status, 403);
    assert.equal(
      (await upload(png, 'local-a', 'https://foreign.test')).status,
      403,
    );
    assert.equal((await upload(Buffer.from('not a png'))).status, 400);
    assert.equal((await upload(png)).status, 200);
    assert.equal(files.size, 1);
    const saved = await (await get('/settings')).json();
    assert.equal(saved.hasLogo, true);
    assert.equal(saved.logo_key, undefined);
    assert.ok(
      [...files.keys()][0].startsWith('companies/company-a/invoice-logos/'),
    );
    assert.equal((await get('/logo')).status, 200);
    assert.equal(
      (
        await h.request(base.replace('shop-a1', 'shop-b1') + '/logo', {
          user: 'local-b',
          env,
        })
      ).status,
      404,
    );
    assert.equal((await get('/preview')).status, 200);
    assert.equal(
      (
        await h.request(base + '/logo', {
          user: 'local-a',
          env,
          method: 'DELETE',
          headers: { origin: 'http://127.0.0.1:8790' },
        })
      ).status,
      200,
    );
    assert.equal((await (await get('/settings')).json()).hasLogo, false);
    assert.equal((await get('/preview')).status, 200);
    assert.equal(
      files.size,
      1,
      'old objects remain available to preserved invoices',
    );
    const firstLogo = await h.request(
      base.replace('shop-a1', 'shop-b1') + '/logo',
      {
        user: 'local-b',
        env,
        method: 'PUT',
        rawBody: png,
        headers: {
          origin: 'http://127.0.0.1:8790',
          'content-type': 'image/png',
        },
      },
    );
    assert.equal(firstLogo.status, 200);
    assert.equal(
      h.sql
        .prepare(
          "SELECT address FROM invoice_settings WHERE company_id='company-b'",
        )
        .get().address,
      '',
    );
  } finally {
    h.close();
  }
});

test('Tier 1 sender setup uses standard fallback, hides secrets and leaves local custom test unverified', async () => {
  const h = harness(),
    base = '/api/platform/tier1/shops/shop-a1/invoices/sender',
    env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) };
  try {
    const initial = await (await h.request(base, { user: 'local-a' })).json();
    assert.equal(initial.status, 'standard');
    const body = {
      senderName: 'Firma',
      replyTo: 'reply@firma.test',
      customFrom: 'faktura@firma.test',
      accountId: 'a'.repeat(32),
      apiToken: 'synthetic-token-123456789',
    };
    assert.equal(
      (
        await h.request(base, {
          user: 'local-reader',
          method: 'PUT',
          body,
          env,
        })
      ).status,
      403,
    );
    const response = await h.request(base, {
      user: 'local-a',
      method: 'PUT',
      body,
      env,
    });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.status, 'pending');
    assert.equal(saved.effectiveFrom, initial.standardFrom);
    assert.equal(saved.apiToken, undefined);
    assert.equal(saved.credentialsSaved, true);
    const sent = await h.request(base + '/test', {
      user: 'local-a',
      method: 'POST',
      body: { mode: 'custom', requestId: crypto.randomUUID() },
      env,
    });
    assert.equal(sent.status, 200);
    assert.equal((await sent.json()).status, 'preview');
    assert.equal(
      (await (await h.request(base, { user: 'local-a', env })).json()).status,
      'pending',
    );
    assert.equal((await h.request(base, { user: 'local-b', env })).status, 404);
  } finally {
    h.close();
  }
});

test('platform edited orders use current quantities and totals without changing legacy validation', () => {
  const check = loader()('platform/order-check.ts').checkInvoice;
  const order = fixture(),
    money = (amount) => ({
      shopMoney: { amount: String(amount), currencyCode: 'DKK' },
    });
  order.edited = true;
  const line = order.lineItems.nodes[0];
  line.quantity = 2;
  line.currentQuantity = 1;
  line.originalUnitPriceSet = money(125);
  line.priceAfterAllDiscountsBeforeTaxesSet = money(90);
  line.taxLines[0].priceSet = money(45);
  order.totalPriceSet = money(275);
  order.totalTaxSet = money(55);
  order.lineItems.nodes.push({
    ...structuredClone(line),
    id: 'removed',
    currentQuantity: 0,
  });
  order.shippingLines.nodes.push({
    ...structuredClone(order.shippingLines.nodes[0]),
    id: 'removed-shipping',
    isRemoved: true,
  });
  const result = check(order);
  assert.equal(result.gross, 16250);
  assert.equal(result.tax, 3250);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].quantity, 1);
  assert.equal(order.lineItems.nodes.length, 2);
  assert.equal(order.edited, true);
  assert.throws(
    () => loader()('platform/invoice-check.ts').checkInvoice(order),
    /ændret/,
  );
  order.currentTotalTaxSet = money(32.51);
  assert.throws(() => check(order), /stemmer ikke/);
  order.currentTotalTaxSet = money(32.5);
  order.totalRefundedSet = money(1);
  assert.throws(() => check(order), /refunderet/);
});

test('order validation refetches fresh data and bounds retries before document writes', async () => {
  let reads = 0;
  const modules = loader({
    fetch: async () => {
      const order = fixture();
      reads++;
      if (reads === 1) order.billingAddress.address1 = '';
      return Response.json({ data: { order } });
    },
  });
  const { loadCompleteOrder } = modules('platform/invoice-source.ts'),
    { checkInvoice } = modules('platform/order-check.ts');
  const order = await loadCompleteOrder(
    fixture().id,
    { shop: 'a1.myshopify.com', accessToken: 'synthetic' },
    checkInvoice,
  );
  assert.equal(reads, 2);
  assert.equal(order.billingAddress.address1, 'Testvej 1');
  let failures = 0;
  const failing = loader({
    fetch: async () => {
      failures++;
      const order = fixture();
      order.currentTotalPriceSet.shopMoney.amount = '1';
      return Response.json({ data: { order } });
    },
  });
  await assert.rejects(
    () =>
      failing('platform/invoice-source.ts').loadCompleteOrder(
        fixture().id,
        { shop: 'a1.myshopify.com', accessToken: 'synthetic' },
        failing('platform/order-check.ts').checkInvoice,
      ),
    /stemmer ikke/,
  );
  assert.equal(failures, 3);
});

test('changed paginated order is reloaded from scratch with a bounded read retry', async () => {
  let starts = 0;
  const modules = loader({
    fetch: async (url, options) => {
      const { query } = JSON.parse(options.body),
        order = fixture();
      if (query.includes('query InvoiceOrder(')) {
        starts++;
        if (starts === 1)
          order.lineItems.pageInfo = { hasNextPage: true, endCursor: 'page1' };
      } else if (query.includes('MoreInvoiceLines'))
        order.updatedAt = '2026-09-05T08:00:00Z';
      return Response.json({ data: { order } });
    },
  });
  const order = await modules('platform/invoice-source.ts').loadCompleteOrder(
    fixture().id,
    { shop: 'a1.myshopify.com', accessToken: 'synthetic' },
    modules('platform/order-check.ts').checkInvoice,
  );
  assert.equal(starts, 2);
  assert.equal(order.lineItems.nodes.length, 1);
});

test('edited invoice generates once from refreshed current data', async () => {
  const h = await invoiceHarness();
  try {
    h.order.edited = true;
    Object.assign(h.order.lineItems.nodes[0], {
      originalUnitPriceSet: {
        shopMoney: { amount: '125', currencyCode: 'DKK' },
      },
      priceAfterAllDiscountsBeforeTaxesSet: {
        shopMoney: { amount: '90', currencyCode: 'DKK' },
      },
    });
    await h.call('sync', { webshopId: 'shop-a1' });
    const response = await h.call('generate', h.input('shop-a1'));
    assert.equal(response.status, 200, await response.text());
    assert.equal((await h.call('generate', h.input('shop-a1'))).status, 200);
    assert.equal(h.objects.size, 1);
  } finally {
    h.close();
  }
});

test('customer invoice delivery enforces production, tenant ownership and durable no-resend after acceptance or timeout', async () => {
  const h = await invoiceHarness();
  try {
    await h.call('sync', { webshopId: 'shop-a1' });
    await h.call('generate', h.input('shop-a1'));
    const invoiceId = h.sql
      .prepare("SELECT id FROM platform_invoices WHERE webshop_id='shop-a1'")
      .get().id;
    const { sendCustomerInvoice } = loader({ jose, 'pdf-lib': pdfLib })(
      'platform/mail.ts',
    );
    const actor = {
      id: 'local-a',
      email: 'a@example.test',
      platformAdmin: false,
    };
    let sends = 0,
      fail = false,
      message;
    const env = {
      ...h.env,
      PLATFORM_ENV: 'production',
      PLATFORM_CUSTOMER_EMAIL: 'enabled',
      PLATFORM_MAIL_FROM: 'faktura@webshoptoolbox.dk',
      PLATFORM_MAIL_TEST: {
        send: async (m) => {
          sends++;
          message = m;
          if (fail) throw Error('network lost after accept');
          return { messageId: 'synthetic-receipt' };
        },
      },
    };
    const attachment = {
      content: new ArrayBuffer(8),
      filename: 'invoice.pdf',
      type: 'application/pdf',
      disposition: 'attachment',
    };
    const send = (overrides = {}, shop = 'shop-a1', who = actor) =>
      sendCustomerInvoice(
        { ...env, ...overrides },
        who,
        'company-a',
        shop,
        invoiceId,
        'customer@example.test',
        'Faktura',
        'Vedhæftet',
        attachment,
      );
    await assert.rejects(
      () => send({ PLATFORM_ENV: 'remote-test' }),
      /ikke aktiveret/,
    );
    await assert.rejects(
      () => send({ PLATFORM_CUSTOMER_EMAIL: 'blocked' }),
      /ikke aktiveret/,
    );
    await assert.rejects(() => send({}, 'shop-a2'), /faktura findes ikke/);
    await assert.rejects(() =>
      send({}, 'shop-a1', { ...actor, id: 'local-b' }),
    );
    await assert.rejects(() =>
      send({}, 'shop-a1', { ...actor, support: { adminId: 'local-admin' } }),
    );
    assert.equal(sends, 0);
    const results = await Promise.allSettled([send(), send()]);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(sends, 1);
    assert.equal((await (await send()).json()).existing, true);
    assert.equal(sends, 1);
    assert.equal(message.to, 'customer@example.test');
    assert.equal(message.from.name, h.settings.name);
    // A different real invoice whose send times out must never be sent again.
    h.sql.prepare("DELETE FROM production_receipts WHERE module='email'").run();
    fail = true;
    await assert.rejects(() => send(), /uafklaret/);
    await assert.rejects(() => send(), /uafklaret/);
    assert.equal(sends, 2);
    assert.equal(
      h.sql
        .prepare("SELECT phase FROM production_receipts WHERE module='email'")
        .get().phase,
      'uncertain',
    );
  } finally {
    h.close();
  }
});

test('a credit note uses the invoice layout with its own number, reference and refunded lines', async () => {
  const { buildInvoicePdf } = loader({ 'pdf-lib': pdfLib })(
    'platform/invoice-pdf.ts',
  );
  const issuer = {
    name: 'Firma A/S',
    address: 'Vej 1, 1000 København',
    cvr: '12345678',
    contact: 'faktura@example.test',
  };
  const bytes = await buildInvoicePdf(fixture(), issuer, undefined, {
    number: '2683-K1',
    date: '2026-09-20T10:00:00Z',
    invoiceNumber: '2683',
    currency: 'DKK',
    lines: [
      { kind: 'goods', title: 'Ring', quantity: 1, net: 32000, tax: 8000 },
    ],
  });
  const document = await pdfLib.PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
});

test('an order refunded before invoicing is invoiced as sold, with the same fingerprint as before the refund', async () => {
  const { checkInvoice, invoiceFingerprint, originalOrder } = loader()(
    'platform/order-check.ts',
  );
  const sold = fixture(),
    refunded = structuredClone(sold);
  refunded.subtotalPriceSet = sold.currentSubtotalPriceSet;
  refunded.displayFinancialStatus = 'PARTIALLY_REFUNDED';
  refunded.totalRefundedSet = {
    shopMoney: { amount: '62.50', currencyCode: 'DKK' },
  };
  refunded.currentTotalPriceSet = {
    shopMoney: { amount: '100.00', currencyCode: 'DKK' },
  };
  refunded.currentSubtotalPriceSet = {
    shopMoney: { amount: '50.00', currencyCode: 'DKK' },
  };
  refunded.currentTotalTaxSet = {
    shopMoney: { amount: '20.00', currencyCode: 'DKK' },
  };
  refunded.lineItems.nodes[0].currentQuantity = 0;
  assert.equal(
    await invoiceFingerprint(checkInvoice(refunded)),
    await invoiceFingerprint(checkInvoice(sold)),
    'the invoice is the original order',
  );
  assert.equal(
    originalOrder(refunded).currentTotalPriceSet.shopMoney.amount,
    '162.50',
  );
  assert.equal(
    originalOrder(sold),
    null,
    'orders without a refund are unchanged',
  );
  const edited = { ...structuredClone(refunded), edited: true };
  assert.equal(
    originalOrder(edited),
    null,
    'edited orders keep their own path',
  );
  // Without the original subtotal Shopify gave, nothing is guessed.
  const unknown = structuredClone(refunded);
  delete unknown.subtotalPriceSet;
  assert.throws(() => checkInvoice(unknown), /refunderet/);
});

test('an order from an enabled market is invoiced in its currency and language and booked like a Danish order', async () => {
  const load = loader({ 'pdf-lib': pdfLib });
  const { inPresentment, checkInvoice } = load('platform/order-check.ts');
  // The Swedish customer paid 1,5 times the DKK amounts in SEK.
  const sek = (value) => ({
    amount: (Number(value) * 1.5).toFixed(2),
    currencyCode: 'SEK',
  });
  const withSek = (value) => {
    if (Array.isArray(value)) return value.map(withSek);
    if (!value || typeof value !== 'object') return value;
    if (value.shopMoney)
      return {
        shopMoney: value.shopMoney,
        presentmentMoney: sek(value.shopMoney.amount),
      };
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, withSek(v)]),
    );
  };
  const order = withSek({
    ...fixture(),
    billingAddress: {
      ...fixture().billingAddress,
      country: 'Sverige',
      countryCodeV2: 'SE',
    },
  });
  const local = checkInvoice(inPresentment(order)),
    shop = checkInvoice(order);
  assert.equal(local.currency, 'SEK');
  assert.equal(local.gross, 24375);
  assert.equal(shop.currency, 'DKK');
  assert.equal(shop.gross, 16250);
  assert.throws(
    () => inPresentment(fixture()),
    /kundens valuta/,
    'no presentment amounts, no customer-currency invoice',
  );
  const { salesDraft } = load('platform/sales-preview.ts');
  const accounts = {
      clearing: '5500',
      vatCode: 'U25',
      noVatCode: 'none',
      goodsVat: '1000',
      shippingVat: '1010',
    },
    chart = [
      {
        number: '5500',
        name: 'Mellemregning',
        vatCode: '',
        kind: 'entry',
        hidden: false,
      },
      {
        number: '1000',
        name: 'Salg',
        vatCode: 'U25',
        kind: 'entry',
        hidden: false,
      },
      {
        number: '1010',
        name: 'Fragt',
        vatCode: 'U25',
        kind: 'entry',
        hidden: false,
      },
    ];
  assert.ok(
    salesDraft(shop, accounts, chart).blockers.some((b) =>
      /danske ordrer/.test(b),
    ),
    'not without an enabled market',
  );
  assert.deepEqual(
    salesDraft(shop, accounts, chart, false, ['SE']).blockers,
    [],
    'booked in DKK when Sweden is enabled',
  );
  const { buildInvoicePdf } = load('platform/invoice-pdf.ts');
  const issuer = {
    name: 'Firma A/S',
    address: 'Vej 1, 1000 København',
    cvr: '12345678',
    contact: 'info@sabeln.se',
    locale: 'sv',
    soldVia: 'Sabeln.se',
  };
  assert.equal(
    (
      await pdfLib.PDFDocument.load(
        await buildInvoicePdf(inPresentment(order), issuer),
      )
    ).getPageCount(),
    1,
  );
  assert.equal(
    (
      await pdfLib.PDFDocument.load(
        await buildInvoicePdf(inPresentment(order), issuer, undefined, {
          number: 'TEST-999999-K1',
          date: '2026-09-10T10:00:00Z',
          invoiceNumber: 'TEST-999999',
          currency: 'SEK',
          lines: [
            {
              kind: 'goods',
              title: 'Testvara',
              quantity: 1,
              net: 15000,
              tax: 3750,
            },
          ],
        }),
      )
    ).getPageCount(),
    1,
  );
});

test('markets are set up per country under Faktura-afsendelse and only enabled ones release their orders', async () => {
  const network = async (url, opt) => {
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'fixture' });
    const { query } = JSON.parse(opt.body);
    if (!query.includes('FeedMarkets')) throw Error('unexpected request');
    return Response.json({
      data: {
        shop: {
          currencyCode: 'DKK',
          primaryDomain: { url: 'https://shop.test' },
          billingAddress: { countryCodeV2: 'DK' },
        },
        markets: {
          nodes: [
            {
              id: 'gid://shopify/Market/1',
              name: 'Denmark',
              status: 'ACTIVE',
              currencySettings: null,
              conditions: {
                regionsCondition: { regions: { nodes: [{ code: 'DK' }] } },
              },
              webPresences: { nodes: [] },
            },
            {
              id: 'gid://shopify/Market/2',
              name: 'Sweden',
              status: 'ACTIVE',
              currencySettings: { baseCurrency: { currencyCode: 'SEK' } },
              conditions: {
                regionsCondition: { regions: { nodes: [{ code: 'SE' }] } },
              },
              webPresences: {
                nodes: [
                  {
                    defaultLocale: { locale: 'sv' },
                    rootUrls: [{ locale: 'sv', url: 'https://sabeln.se/' }],
                  },
                ],
              },
            },
          ],
        },
      },
    });
  };
  const h = harness(jose, network),
    env = { PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) };
  try {
    await testShopConnections(h, env);
    const call = (method = 'GET', body) =>
      h.request('/api/platform/tier1/shops/shop-a1/markets/settings', {
        user: 'local-a',
        method,
        ...(body ? { body } : {}),
        env: { ...h.env, ...env },
      });
    const listed = await (await call()).json();
    assert.deepEqual(
      listed.markets.map((m) => [
        m.name,
        m.currency,
        m.settings.enabled,
        m.settings.locale,
        m.settings.storeName,
      ]),
      [['Sweden', 'SEK', false, 'sv', 'Sabeln.se']],
      'only markets other than the home market, with Swedish defaults',
    );
    assert.match(listed.markets[0].settings.invoiceSubject, /från/);
    const sweden = {
      marketId: 'gid://shopify/Market/2',
      enabled: true,
      storeName: 'Sabeln.se',
      invoiceSubject: 'Faktura {{fakturanummer}}',
      invoiceBody: 'Hej {{kundenavn}}',
      creditSubject: 'Kreditfaktura {{kreditnotanummer}}',
      creditBody: 'Hej {{kundenavn}}',
      vatMode: 'domestic',
      revision: 0,
    };
    assert.equal(
      (await call('PUT', { ...sweden, vatMode: 'oss' })).status,
      400,
      'OSS is not offered yet',
    );
    assert.equal(
      (await call('PUT', { ...sweden, marketId: 'gid://shopify/Market/1' }))
        .status,
      409,
      'the home market is not set up here',
    );
    // Orders: a Swedish order in SEK waits until Sweden is enabled; a Danish order is never affected.
    const { domesticOrderSql } = loader()('platform/order-markets.ts');
    const order = (n, country, currency) => {
      h.sql
        .prepare(
          "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','orders',?,'2026-09-02T10:00:00Z',?)",
        )
        .run(
          'gid://shopify/Order/' + n,
          JSON.stringify({
            currentTotalPriceSet: {
              shopMoney: { amount: '100.00', currencyCode: 'DKK' },
            },
          }),
        );
      h.sql
        .prepare(
          "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) VALUES('company-a','shop-a1',?,?,?)",
        )
        .run('gid://shopify/Order/' + n, country, currency);
    };
    order(1, 'DK', 'DKK');
    order(2, 'SE', 'SEK');
    order(3, 'NO', 'NOK');
    order(4, 'SE', 'DKK');
    const released = () =>
      h.sql
        .prepare(
          "SELECT external_id FROM operation_snapshots s WHERE s.module='orders' AND " +
            domesticOrderSql +
            ' ORDER BY external_id',
        )
        .all()
        .map((r) => r.external_id.split('/').pop());
    assert.deepEqual(released(), ['1']);
    const saved = await call('PUT', sweden);
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual(
      released(),
      ['1', '2'],
      'Swedish orders in SEK are released; Norway and SEK-less Swedish orders wait',
    );
    assert.equal(
      (await call('PUT', sweden)).status,
      409,
      'a stale revision is refused',
    );
    assert.equal(
      (await call('PUT', { ...sweden, enabled: false, revision: 2 })).status,
      200,
    );
    assert.deepEqual(released(), ['1']);
    const again = (await (await call()).json()).markets[0].settings;
    assert.deepEqual(
      [again.enabled, again.locale, again.creditSubject, again.revision],
      [false, 'sv', 'Kreditfaktura {{kreditnotanummer}}', 3],
      'the language follows Shopify',
    );
  } finally {
    h.close();
  }
});

test('each country has its own sender and credit-note text; Danmark keeps its own, and a market without its own sender uses the standard sender', async () => {
  const h = harness();
  try {
    const env = { ...h.env, PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32) };
    const call = (path, method = 'GET', body) =>
      h.request('/api/platform/tier1/shops/shop-a1' + path, {
        user: 'local-a',
        method,
        ...(body ? { body } : {}),
        env,
      });
    // Danmark: the credit-note text is saved with the other settings.
    const loaded = await (await call('/admin/settings')).json();
    assert.match(
      loaded.settings.invoiceEmail.creditSubject,
      /{{kreditnotanummer}}/,
    );
    const saved = await call('/admin/settings', 'POST', {
      revision: loaded.revision,
      settings: {
        ...loaded.settings,
        invoiceEmail: {
          ...loaded.settings.invoiceEmail,
          creditSubject: 'Kreditnota {{kreditnotanummer}}',
          creditBody: 'Hej {{kundenavn}}, {{beløb}}',
        },
      },
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual(
      {
        ...h.sql
          .prepare(
            "SELECT credit_subject,credit_body FROM invoice_settings WHERE company_id='company-a'",
          )
          .get(),
      },
      {
        credit_subject: 'Kreditnota {{kreditnotanummer}}',
        credit_body: 'Hej {{kundenavn}}, {{beløb}}',
      },
    );
    // Sweden: its own sender, stored apart from Danmark's.
    h.sql
      .prepare(
        "INSERT INTO webshop_markets(company_id,webshop_id,market_id,name,countries_json,currency,locale,store_name,invoice_subject,invoice_body,vat_mode,enabled) VALUES('company-a','shop-a1','gid://shopify/Market/2','Sweden','[\"SE\"]','SEK','sv','Sabeln.se','s','b','domestic',1)",
      )
      .run();
    const m = '?marketId=' + encodeURIComponent('gid://shopify/Market/2');
    assert.equal(
      (await (await call('/invoices/sender' + m)).json()).inherited,
      true,
      "without its own sender, Sweden uses the standard sender, never Danmark's domain",
    );
    const put = await call('/invoices/sender' + m, 'PUT', {
      senderName: 'Sabeln.se',
      replyTo: 'info@sabeln.se',
      customFrom: '',
    });
    assert.equal(put.status, 200, await put.clone().text());
    assert.equal(
      (await (await call('/invoices/sender' + m)).json()).inherited,
      false,
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT sender_name FROM market_mail WHERE market_id='gid://shopify/Market/2'",
        )
        .get().sender_name,
      'Sabeln.se',
    );
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM company_mail').get().n,
      0,
      "Danmark's sender is untouched",
    );
    // Sweden's company details and design are its own; Danmark's are unchanged.
    const design = await call('/invoices/settings' + m, 'PUT', {
      name: 'Sablen ApS',
      address: 'Vej 1, 7500 Holstebro',
      cvr: '12345678',
      contact: 'info@sabeln.se',
      design: { layout: 'classic', accent: '#ad8030', footer: 'Tack!' },
      revision: 1,
    });
    assert.equal(design.status, 200, await design.clone().text());
    assert.equal(
      (await (await call('/invoices/settings' + m)).json()).contact,
      'info@sabeln.se',
    );
    assert.notEqual(
      (await (await call('/invoices/settings')).json()).contact,
      'info@sabeln.se',
    );
  } finally {
    h.close();
  }
});

test('one order in one view: invoice and mail, booking in Dinero, refunds with credit notes, scoped to the webshop', async () => {
  const h = harness();
  try {
    const id = 'gid://shopify/Order/2683',
      call = (path, shop = 'shop-a1') =>
        h.request('/api/platform/tier1/shops/' + shop + path, {
          user: 'local-a',
          env: h.env,
        });
    h.sql
      .prepare(
        "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a','shop-a1','orders',?,'2026-10-02T12:03:53Z',?)",
      )
      .run(
        id,
        JSON.stringify({
          id,
          name: '#2683',
          createdAt: '2026-10-02T12:03:53Z',
          displayFinancialStatus: 'PARTIALLY_REFUNDED',
          displayFulfillmentStatus: 'FULFILLED',
          paymentGatewayNames: ['MobilePay Online'],
          currentTotalPriceSet: {
            shopMoney: { amount: '1.95', currencyCode: 'DKK' },
          },
        }),
      );
    h.sql
      .prepare(
        "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency,order_total,net_payment) VALUES('company-a','shop-a1',?,'DK','DKK','5.24','1.95')",
      )
      .run(id);
    h.sql
      .prepare(
        "INSERT INTO platform_invoices(company_id,webshop_id,external_id,id,fingerprint,status,r2_key,issuer_json,source_json) VALUES('company-a','shop-a1',?,'inv-1','f','generated','k','{}',?)",
      )
      .run(
        id,
        JSON.stringify({
          name: '#2683',
          billingAddress: { name: 'Kunde K' },
          currentTotalPriceSet: {
            shopMoney: { amount: '5.24', currencyCode: 'DKK' },
          },
        }),
      );
    const receipt = (
      provider,
      module,
      externalId,
      phase,
      payload,
      destination = 'org-1',
    ) =>
      h.sql
        .prepare(
          "INSERT INTO production_receipts(company_id,webshop_id,provider,module,external_id,destination,phase,version,payload_json) VALUES('company-a','shop-a1',?,?,?,?,?,'v',?)",
        )
        .run(
          provider,
          module,
          externalId,
          destination,
          phase,
          JSON.stringify(payload),
        );
    receipt('shopify', 'orders', id, 'booked', {
      guid: '0f1e2d3c-0000-4000-8000-000000000001',
      voucherNumber: 412,
      voucher: { ExternalReference: 'wtb:shop-a1:sale:2683' },
    });
    receipt(
      'invoice',
      'email',
      'inv-1',
      'accepted',
      { recipient: 'kunde@example.test', from: 'faktura@webshoptoolbox.dk' },
      'customer',
    );
    const refund = {
      id: 'gid://shopify/Refund/1',
      orderId: id,
      orderName: '#2683',
      processedAt: '2026-10-02T12:19:25Z',
      currency: 'DKK',
      gross: 329,
      full: false,
      sequence: 1,
      note: null,
      gateways: [{ gateway: 'mobilepay', name: 'MobilePay', amount: 329 }],
      lines: [],
      problem: null,
    };
    h.sql
      .prepare(
        "INSERT INTO order_refunds(company_id,webshop_id,external_id,order_id,occurred_at,payload_json) VALUES('company-a','shop-a1',?,?,?,?)",
      )
      .run(refund.id, id, refund.processedAt, JSON.stringify(refund));
    h.sql
      .prepare(
        "INSERT INTO platform_credit_notes(company_id,webshop_id,external_id,id,order_id,number,status,r2_key,source_json) VALUES('company-a','shop-a1',?,'cn-1',?,'2683-K1','generated','k2','{}')",
      )
      .run(refund.id, id);
    receipt('shopify', 'order_refunds', refund.id, 'draft', {
      guid: '0f1e2d3c-0000-4000-8000-000000000002',
      voucher: { ExternalReference: 'wtb:shop-a1:orderrefund:1' },
    });
    receipt(
      'invoice',
      'credit_email',
      'cn-1',
      'accepted',
      { recipient: 'kunde@example.test' },
      'customer',
    );
    const r = await call('/orders/detail?externalId=' + encodeURIComponent(id));
    assert.equal(r.status, 200, await r.clone().text());
    const d = await r.json();
    assert.deepEqual(
      [
        d.order.name,
        d.order.amount,
        d.order.realized,
        d.order.customer,
        d.order.paymentProvider,
      ],
      ['#2683', 5.24, 1.95, 'Kunde K', 'MobilePay'],
    );
    assert.deepEqual(
      [d.invoice.status, d.invoice.mail.phase, d.invoice.mail.recipient],
      ['generated', 'accepted', 'kunde@example.test'],
    );
    assert.deepEqual(
      [d.booking.phase, d.booking.voucherNumber, d.booking.reference],
      ['booked', 412, 'wtb:shop-a1:sale:2683'],
    );
    assert.equal(d.refunds.length, 1);
    const [one] = d.refunds;
    assert.deepEqual(
      [
        one.amount,
        one.gateways.join(),
        one.creditNote.number,
        one.creditNote.mail.phase,
        one.booking.phase,
      ],
      [3.29, 'MobilePay', '2683-K1', 'accepted', 'draft'],
    );
    // Another webshop never sees the order; a bad ID is refused.
    assert.equal(
      (
        await call(
          '/orders/detail?externalId=' + encodeURIComponent(id),
          'shop-a2',
        )
      ).status,
      404,
    );
    assert.equal((await call('/orders/detail?externalId=x')).status, 400);
  } finally {
    h.close();
  }
});

test("Swedish invoices use the products' Swedish names from Shopify, and keep the Danish ones when a translation is missing or unavailable", async () => {
  let answer = 'ok';
  const queries = [];
  const fetch = async (url, opt) => {
    const { variables } = JSON.parse(opt.body);
    queries.push(variables);
    if (answer === 'denied')
      return Response.json({
        errors: [
          {
            message: 'Access denied for translatableResourcesByIds field.',
            extensions: { code: 'ACCESS_DENIED' },
          },
        ],
      });
    return Response.json({
      data: {
        translatableResourcesByIds: {
          nodes: [
            {
              resourceId: 'gid://shopify/Product/1',
              translations: [{ key: 'title', value: 'Läderomslag' }],
            },
            { resourceId: 'gid://shopify/Product/2', translations: [] },
          ],
        },
      },
    });
  };
  const { withTranslatedLines, creditLineTitles } = loader({ fetch })(
    'platform/invoice-translations.ts',
  );
  const access = { shop: 'a1.myshopify.com', accessToken: 't' };
  const order = {
    name: '#2695',
    lineItems: {
      nodes: [
        {
          name: 'Lædercover - Sort / M',
          variant: {
            title: 'Sort / M',
            product: { id: 'gid://shopify/Product/1', title: 'Lædercover' },
          },
        },
        {
          name: 'Gravering',
          variant: {
            title: 'Default Title',
            product: { id: 'gid://shopify/Product/2', title: 'Gravering' },
          },
        },
        { name: 'Slettet vare', variant: null },
      ],
    },
  };
  const swedish = await withTranslatedLines(access, order, 'sv');
  assert.deepEqual(
    swedish.lineItems.nodes.map((l) => l.name),
    ['Läderomslag - Sort / M', 'Gravering', 'Slettet vare'],
  );
  assert.equal(queries.at(-1).locale, 'sv');
  assert.deepEqual(queries.at(-1).ids, [
    'gid://shopify/Product/1',
    'gid://shopify/Product/2',
  ]);
  assert.equal(
    order.lineItems.nodes[0].name,
    'Lædercover - Sort / M',
    'the original order is not changed',
  );
  // Without read_translations (or any error) the invoice keeps the Danish names instead of failing.
  answer = 'denied';
  assert.deepEqual(
    (await withTranslatedLines(access, order, 'sv')).lineItems.nodes.map(
      (l) => l.name,
    ),
    ['Lædercover - Sort / M', 'Gravering', 'Slettet vare'],
  );
  // The credit note's lines get the invoice's Swedish names; shipping and unknown lines stay as they are.
  assert.deepEqual(
    creditLineTitles(
      [
        { kind: 'goods', title: 'Lædercover - Sort / M', quantity: 1 },
        { kind: 'goods', title: 'Andet', quantity: 1 },
        { kind: 'shipping', title: 'Fragt', quantity: 1 },
      ],
      swedish.lineItems.nodes,
    ).map((l) => l.title),
    ['Läderomslag - Sort / M', 'Andet', 'Fragt'],
  );
});

test('an order waiting for its market says why: no active market, or paid in another currency than the market uses', async () => {
  const h = harness();
  try {
    h.sql
      .prepare(
        "INSERT INTO webshop_markets(company_id,webshop_id,market_id,name,countries_json,currency,locale,store_name,invoice_subject,invoice_body,vat_mode,enabled) VALUES('company-a','shop-a1','gid://shopify/Market/2','Sverige','[\"SE\"]','SEK','sv','Sabeln.se','s','b','domestic',1)",
      )
      .run();
    const { marketHold } = loader({ jose })('platform/order-markets.ts');
    const held = await marketHold(h.db, 'company-a', 'shop-a1');
    assert.equal(
      held.reason('SE', 'DKK', 'DKK'),
      'Afventer · betalt i DKK, markedet bruger SEK',
    );
    assert.equal(
      held.reason('NO', 'NOK', 'DKK'),
      'Afventer · marked ikke sat op',
    );
    assert.equal(held.reason('SE', 'SEK', 'DKK'), null);
    assert.equal(held.reason('DK', 'DKK', 'DKK'), null);
    assert.equal(held('SE', 'DKK', 'DKK'), true);
  } finally {
    h.close();
  }
});
