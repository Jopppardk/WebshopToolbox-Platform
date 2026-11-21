// Trustpilot-invitationer (Tools → Anmeldelser): template rendering, settings, images, test mail and the scheduled send.
import { test, assert, harness, loader, jose } from './platform-harness.mjs';

const mail = loader()('platform/tier1/src/lib/review-mail.ts');
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

test('invitation mails sanitize editor HTML, escape order data and link each star to Trustpilot', () => {
  assert.equal(
    mail.sanitizeRich(
      '<div>Hej <b onclick="x()">der</b></div><div><script>bad()</script><a href="javascript:alert(1)">x</a> <a href="https://dk.trustpilot.com/evaluate/a.dk" style="color:red">link</a> & <span>mere</span></div><img src=x onerror=y>',
    ),
    'Hej <b>der</b><br>bad()x <a href="https://dk.trustpilot.com/evaluate/a.dk">link</a> &amp; mere',
  );
  assert.equal(
    mail.sanitizeRich('<b><i>uafsluttet'),
    '<b><i>uafsluttet</i></b>',
  );
  assert.equal(
    mail.sanitizeRich('<a href="{{trustpilot}}">anmeld</a>'),
    '<a href="{{trustpilot}}">anmeld</a>',
  );
  const template = mail.defaultTemplate('sv', 'https://www.shop.se/');
  assert.equal(
    template.trustpilotUrl,
    'https://se.trustpilot.com/evaluate/shop.se',
  );
  assert.equal(template.delayDays, 7);
  const out = mail.renderReviewMail(
    template,
    {
      firstName: '<script>Ann</script>',
      orderName: '#1001',
      store: 'Sabel & Co',
    },
    'sv',
  );
  assert.equal(out.subject, 'Hur var din upplevelse hos Sabel & Co?');
  assert.match(out.html, /<html lang="sv">/);
  assert.match(out.html, /&lt;script&gt;Ann&lt;\/script&gt;/);
  assert.doesNotMatch(out.html, /<script>/);
  assert.match(out.html, /Sabel &amp; Co/);
  for (const n of [1, 2, 3, 4, 5])
    assert.match(
      out.html,
      new RegExp(
        `href="https://se\\.trustpilot\\.com/evaluate/shop\\.se\\?stars=${n}"`,
      ),
    );
  assert.match(
    out.html,
    /href="https:\/\/se\.trustpilot\.com\/evaluate\/shop\.se" target/,
  );
  assert.match(
    out.text,
    /Skriv ett omdöme: https:\/\/se\.trustpilot\.com\/evaluate\/shop\.se/,
  );
  assert.doesNotMatch(out.text, /<b>|\{\{/);
  // Without a first name the greeting leaves it out instead of showing the placeholder.
  const nameless = mail.renderReviewMail(
    mail.defaultTemplate('da', 'a.dk'),
    { firstName: '', orderName: '#7', store: 'A' },
    'da',
  );
  assert.match(nameless.html, /Hvordan var din oplevelse\?/);
  assert.doesNotMatch(nameless.html, /fornavn/);
  // Saving checks the template.
  // A text link to {{trustpilot}} goes to the language's Trustpilot page in both the HTML and the text.
  const linked = mail.renderReviewMail(
    {
      ...template,
      blocks: [
        {
          id: 't',
          type: 'text',
          html: '<a href="{{trustpilot}}">Anmeld</a>',
          align: 'center',
          color: '#000000',
          size: 16,
        },
      ],
    },
    { firstName: 'A', orderName: '#1', store: 'S' },
    'sv',
  );
  assert.match(
    linked.html,
    /<a href="https:\/\/se\.trustpilot\.com\/evaluate\/shop\.se">Anmeld<\/a>/,
  );
  assert.equal(
    linked.text,
    'Anmeld (https://se.trustpilot.com/evaluate/shop.se)',
  );
  assert.throws(
    () => mail.normalizeTemplate({ ...template, fromAddress: 'x' }, 'sv'),
    /afsenderadresse/,
  );
  assert.throws(
    () => mail.normalizeTemplate({ ...template, subject: ' ' }, 'sv'),
    /emnelinjen/,
  );
  assert.throws(
    () =>
      mail.normalizeTemplate(
        { ...template, trustpilotUrl: 'javascript:x' },
        'sv',
      ),
    /Trustpilot-link/,
  );
  const clean = mail.normalizeTemplate(
    {
      ...template,
      blocks: [
        { id: 'a', type: 'image', src: 'javascript:x', width: 500, align: 'x' },
        {
          id: 'a',
          type: 'button',
          text: 'Go',
          href: 'data:text/html,x',
          background: 'red',
        },
      ],
    },
    'sv',
  );
  assert.deepEqual(
    clean.blocks.map((b) => [b.type, b.src ?? b.href, b.width ?? b.background]),
    [
      ['image', '', 100],
      ['button', '{{trustpilot}}', '#00b67a'],
    ],
  );
  assert.notEqual(clean.blocks[0].id, clean.blocks[1].id);
});

test('invitation settings, images and test mail are per webshop and admin only', async () => {
  const h = harness(),
    objects = new Map();
  const env = {
    PLATFORM_DOCUMENTS: {
      put: async (k, v) => objects.set(k, v),
      get: async (k) => (objects.has(k) ? { body: objects.get(k) } : null),
    },
  };
  const call = (
    path = '',
    method = 'GET',
    body,
    user = 'local-a',
    shop = 'shop-a1',
    extra = {},
  ) =>
    h.request('/api/platform/tier1/shops/' + shop + '/reviews' + path, {
      method,
      body,
      user,
      env,
      ...extra,
    });
  try {
    let response = await call();
    assert.equal(response.status, 200, await response.clone().text());
    let info = await response.json();
    assert.equal(info.revision, 0);
    assert.equal(info.settings.enabled, false);
    assert.equal(
      info.settings.templates.da.trustpilotUrl,
      'https://dk.trustpilot.com/evaluate/a1.example.test',
    );
    assert.equal(info.senders.da.from, 'faktura@webshoptoolbox.dk');
    assert.equal(info.customerMail, false);
    assert.equal((await call('', 'GET', undefined, 'local-b')).status, 404);
    const settings = structuredClone(info.settings);
    settings.enabled = true;
    settings.templates.da.subject = 'Anmeld {{butik}}';
    assert.equal(
      (await call('', 'PUT', { settings, revision: 0 }, 'local-reader')).status,
      403,
    );
    response = await call('', 'PUT', { settings, revision: 0 });
    assert.equal(response.status, 200, await response.clone().text());
    info = await response.json();
    assert.equal(info.revision, 1);
    assert.ok(info.startAt);
    assert.equal(info.settings.templates.da.subject, 'Anmeld {{butik}}');
    assert.equal(
      (await call('', 'PUT', { settings, revision: 0 })).status,
      409,
    );
    // An own sender address needs a verified own sender on its domain.
    const withSender = structuredClone(info.settings);
    withSender.templates.da.fromAddress = 'kontakt@a1.example.test';
    withSender.templates.da.fromName = 'Sablen';
    response = await call('', 'PUT', { settings: withSender, revision: 1 });
    assert.equal(response.status, 400);
    assert.match(
      (await response.json()).error,
      /a1\.example\.test er ikke godkendt til afsendelse/,
    );
    h.sql
      .prepare(
        "INSERT INTO company_mail(company_id,sender_name,reply_to,custom_from,account_id,credentials_encrypted,revision,verified_revision) VALUES('company-a','A','','faktura@a1.example.test',?,'sealed','r1','r1')",
      )
      .run('0'.repeat(32));
    assert.deepEqual((await (await call()).json()).senders.da.domains, [
      'a1.example.test',
    ]);
    withSender.templates.sv.fromAddress = 'kontakt@other.test';
    assert.equal(
      (await call('', 'PUT', { settings: withSender, revision: 1 })).status,
      400,
    );
    withSender.templates.sv.fromAddress = '';
    response = await call('', 'PUT', { settings: withSender, revision: 1 });
    assert.equal(response.status, 200, await response.clone().text());
    info = await response.json();
    assert.equal(
      info.settings.templates.da.fromAddress,
      'kontakt@a1.example.test',
    );
    assert.equal(info.revision, 2);
    h.sql.exec('DELETE FROM company_mail');
    info = await (
      await call('', 'PUT', {
        settings: {
          ...info.settings,
          templates: {
            ...info.settings.templates,
            da: { ...info.settings.templates.da, fromAddress: '' },
          },
        },
        revision: 2,
      })
    ).json();
    // Saving again keeps the start; switching off and on starts again from then.
    const start = info.startAt;
    info = await (await call('', 'PUT', { settings, revision: 3 })).json();
    assert.equal(info.startAt, start);
    // The other webshop is untouched.
    assert.equal(
      (await (await call('', 'GET', undefined, 'local-a', 'shop-a2')).json())
        .revision,
      0,
    );

    // Images: checked type and content, stored under the webshop, public by a random id.
    const upload = (bytes, type) =>
      call('/images', 'POST', undefined, 'local-a', 'shop-a1', {
        rawBody: bytes,
        headers: { 'content-type': type, origin: 'http://127.0.0.1:8790' },
      });
    assert.equal(
      (await upload(new Uint8Array([1, 2, 3]), 'image/png')).status,
      415,
    );
    assert.equal((await upload(png, 'text/html')).status, 415);
    response = await upload(png, 'image/png');
    assert.equal(response.status, 201, await response.clone().text());
    const { url } = await response.json();
    assert.match(
      url,
      /^http:\/\/127\.0\.0\.1:8790\/mail-images\/[a-f0-9]{32}$/,
    );
    assert.ok(
      [...objects.keys()][0].startsWith(
        'companies/company-a/webshops/shop-a1/mail-images/',
      ),
    );
    const image = await h.request(new URL(url).pathname, { auth: false, env });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.match(image.headers.get('cache-control'), /public/);
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(
      (await h.request('/mail-images/' + 'f'.repeat(32), { auth: false, env }))
        .status,
      404,
    );

    // Test mail: the saved template with sample data, locally only shown, then a one-minute pause.
    response = await call('/test', 'POST', {
      locale: 'sv',
      requestId: crypto.randomUUID(),
      recipient: 'kollega@example.test',
    });
    assert.equal(response.status, 200, await response.clone().text());
    const preview = await response.json();
    assert.equal(preview.status, 'preview');
    assert.equal(preview.recipient, 'kollega@example.test');
    assert.equal(
      preview.preview.subject,
      '[TEST] Hur var din upplevelse hos Webshop A1?',
    );
    assert.match(preview.preview.html, /Anna/);
    assert.equal(
      (
        await call('/test', 'POST', {
          locale: 'da',
          requestId: crypto.randomUUID(),
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await call('/test', 'POST', {
          locale: 'no',
          requestId: crypto.randomUUID(),
        })
      ).status,
      400,
    );
  } finally {
    h.close();
  }
});

test('scheduled invitations mail each shipped order once, in the customer language, after its delay', async () => {
  const live = new Map(),
    sent = [],
    cloudflare = [];
  let failMail = false;
  const network = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url.endsWith('/oauth/access_token'))
      return Response.json({ access_token: 'synthetic' });
    const body = JSON.parse(options.body);
    if (url.startsWith('https://api.cloudflare.com/')) {
      cloudflare.push(body);
      return Response.json({ success: true, result: { delivered: [body.to] } });
    }
    assert.match(body.query, /^query ReviewOrder/);
    return Response.json({
      data: { order: live.get(body.variables.id) ?? null },
    });
  };
  const h = harness(jose, network);
  const env = {
    ...h.env,
    PLATFORM_ENV: 'production',
    PLATFORM_CUSTOMER_EMAIL: 'enabled',
    PLATFORM_CREDENTIALS_KEY: 'ab'.repeat(32),
    PLATFORM_MAIL_FROM: 'faktura@webshoptoolbox.dk',
    PLATFORM_MAIL_TEST: {
      send: async (message) => {
        if (failMail) throw Error('synthetic failure');
        sent.push(message);
        return { messageId: 'm' + sent.length };
      },
    },
  };
  const load = loader({ jose, fetch: network });
  const { sendReviewInvitations, invitationQueue } = load(
    'platform/review-invitations.ts',
  );
  const { seal } = load('platform/connections.ts');
  const { defaultSettings } = load('platform/tier1/src/lib/review-mail.ts');
  try {
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
            env,
            ['company-a', shop, 'shopify', shop + '.myshopify.com'],
            {
              clientId: 'c',
              clientSecret: 's',
            },
          ),
        );
    const days = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const start = days(30);
    h.sql
      .prepare(
        'INSERT INTO review_invitation_settings(company_id,webshop_id,enabled,start_at,templates_json) VALUES(?,?,1,?,?)',
      )
      .run(
        'company-a',
        'shop-a1',
        start,
        JSON.stringify(defaultSettings('a1.example.test').templates),
      );
    const order = (shop, n, country, shipped, extra = {}) => {
      const id = 'gid://shopify/Order/' + n;
      h.sql
        .prepare(
          "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a',?,'orders',?,?,?)",
        )
        .run(
          shop,
          id,
          days(40),
          JSON.stringify({
            id,
            name: '#' + n,
            test: false,
            cancelledAt: null,
            displayFulfillmentStatus: 'FULFILLED',
            fulfillments: [{ createdAt: shipped, status: 'SUCCESS' }],
            currentTotalPriceSet: {
              shopMoney: { amount: '100.00', currencyCode: 'DKK' },
            },
            ...extra,
          }),
        );
      if (country !== undefined)
        h.sql
          .prepare(
            "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) VALUES('company-a',?,?,?,?)",
          )
          .run(shop, id, country, country === 'SE' ? 'SEK' : 'DKK');
      live.set(id, {
        id,
        name: '#' + n,
        email: 'kunde' + n + '@example.test',
        cancelledAt: null,
        displayFulfillmentStatus: 'FULFILLED',
        customer: { firstName: 'Kunde' + n },
        shippingAddress: null,
        billingAddress: null,
      });
      return id;
    };
    order('shop-a1', 1, 'DK', days(6)); // due: 5 days for Danish
    order('shop-a1', 2, 'SE', days(6)); // not yet: 7 days for Swedish
    order('shop-a1', 3, 'SE', days(8));
    order('shop-a1', 4, 'DK', days(35)); // shipped before the start
    order('shop-a1', 5, 'DK', days(9), { cancelledAt: days(8) });
    order('shop-a1', 6, undefined, days(9)); // market not known yet: waits
    order('shop-a1', 7, 'NO', days(9)); // no language for Norway
    order('shop-a1', 8, 'DK', days(9), {
      currentTotalPriceSet: { shopMoney: { amount: '0.00' } },
    });
    order('shop-a2', 1, 'DK', days(9)); // same Shopify ID in the other webshop, which is not switched on
    const noEmail = order('shop-a1', 9, 'DK', days(9));
    live.get(noEmail).email = null;

    const queue = async () => {
      const row = h.sql
        .prepare(
          "SELECT enabled,start_at,templates_json FROM review_invitation_settings WHERE company_id='company-a' AND webshop_id='shop-a1'",
        )
        .get();
      const { orders, ...counts } = await invitationQueue(
        env,
        'company-a',
        'shop-a1',
        row,
        { enabled: true, templates: JSON.parse(row.templates_json) },
      );
      assert.equal(orders.length, counts.queued);
      return counts;
    };
    // In the queue: #1, #2 (Swedish, not yet), #3, #6 (waits for its market) and #9; cancelled, refunded, Norwegian
    // and shipped-before-start orders are not.
    assert.deepEqual(await queue(), {
      queued: 5,
      ready: 3,
      queueCapped: false,
    });
    const owns = async () => {};
    assert.deepEqual(
      await sendReviewInvitations(env, 'company-a', 'shop-a1', owns),
      { sent: 2 },
    );
    assert.deepEqual(await queue(), {
      queued: 2,
      ready: 0,
      queueCapped: false,
    });
    assert.deepEqual(
      sent.map((m) => [m.to, m.subject, m.from.email]),
      [
        [
          'kunde3@example.test',
          'Hur var din upplevelse hos Webshop A1?',
          'faktura@webshoptoolbox.dk',
        ],
        [
          'kunde1@example.test',
          'Hvordan var din oplevelse hos Webshop A1?',
          'faktura@webshoptoolbox.dk',
        ],
      ],
    );
    const byTo = Object.fromEntries(sent.map((m) => [m.to, m]));
    assert.match(
      byTo['kunde1@example.test'].html,
      /lang="da"[\s\S]*Kunde1[\s\S]*#1/,
    );
    assert.match(
      byTo['kunde3@example.test'].html,
      /lang="sv"[\s\S]*se\.trustpilot\.com/,
    );
    assert.match(
      byTo['kunde1@example.test'].text,
      /dk\.trustpilot\.com\/evaluate\/a1\.example\.test/,
    );
    const rows = Object.fromEntries(
      h.sql
        .prepare(
          'SELECT webshop_id,external_id,status,locale,reason FROM review_invitations ORDER BY external_id',
        )
        .all()
        .map((r) => [
          r.webshop_id + ' ' + r.external_id.split('/').pop(),
          [r.status, r.locale, r.reason],
        ]),
    );
    assert.deepEqual(rows['shop-a1 1'].slice(0, 2), ['sent', 'da']);
    assert.deepEqual(rows['shop-a1 3'].slice(0, 2), ['sent', 'sv']);
    assert.equal(rows['shop-a1 7'][0], 'skipped');
    assert.equal(rows['shop-a1 8'][2], 'Ordren er refunderet.');
    assert.equal(rows['shop-a1 9'][2], 'Ordren har ingen gyldig mailadresse.');
    for (const waiting of [
      'shop-a1 2',
      'shop-a1 4',
      'shop-a1 5',
      'shop-a1 6',
      'shop-a2 1',
    ])
      assert.equal(rows[waiting], undefined, waiting);

    // A second run mails nobody again; an unconfirmed send is marked and never repeated.
    assert.deepEqual(
      await sendReviewInvitations(env, 'company-a', 'shop-a1', owns),
      { sent: 0 },
    );
    order('shop-a1', 10, 'DK', days(6));
    failMail = true;
    await assert.rejects(
      sendReviewInvitations(env, 'company-a', 'shop-a1', owns),
      /ikke bekræftet/,
    );
    failMail = false;
    assert.deepEqual(
      await sendReviewInvitations(env, 'company-a', 'shop-a1', owns),
      { sent: 0 },
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT status FROM review_invitations WHERE external_id='gid://shopify/Order/10'",
        )
        .get().status,
      'uncertain',
    );
    assert.equal(sent.length, 2);
    // Outside production with customer mail on, nothing is sent at all.
    order('shop-a1', 11, 'DK', days(6));
    assert.deepEqual(
      await sendReviewInvitations(
        { ...env, PLATFORM_CUSTOMER_EMAIL: 'blocked' },
        'company-a',
        'shop-a1',
        owns,
      ),
      { sent: 0 },
    );
    assert.equal(sent.length, 2);
    // Fully refunded without a cancellation: no invitation.
    order('shop-a1', 12, 'DK', days(6), { displayFinancialStatus: 'REFUNDED' });
    // An own address on the verified domain of the sender, with its own name.
    h.sql
      .prepare(
        "INSERT INTO company_mail(company_id,sender_name,reply_to,custom_from,account_id,credentials_encrypted,revision,verified_revision) VALUES('company-a','A','',?,?,?,'r1','r1')",
      )
      .run(
        'faktura@a1.example.test',
        'a'.repeat(32),
        await seal(
          env,
          ['company-a', 'mail', 'faktura@a1.example.test', 'a'.repeat(32)],
          { token: 'synthetic-token-1234567890' },
        ),
      );
    const templates = defaultSettings('a1.example.test').templates;
    templates.da.fromAddress = 'kontakt@a1.example.test';
    templates.da.fromName = 'Sablen';
    h.sql
      .prepare('UPDATE review_invitation_settings SET templates_json=?')
      .run(JSON.stringify(templates));
    order('shop-a1', 13, 'DK', days(6));
    assert.deepEqual(
      await sendReviewInvitations(env, 'company-a', 'shop-a1', owns),
      { sent: 2 },
    );
    assert.deepEqual(
      cloudflare.map((m) => [m.to, m.from.address, m.from.name]),
      [
        ['kunde11@example.test', 'kontakt@a1.example.test', 'Sablen'],
        ['kunde13@example.test', 'kontakt@a1.example.test', 'Sablen'],
      ],
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT reason FROM review_invitations WHERE external_id='gid://shopify/Order/12'",
        )
        .get().reason,
      'Ordren er refunderet.',
    );
    // The domain is no longer verified: orders wait unclaimed, and the run says why.
    h.sql.exec('DELETE FROM mail_domains');
    h.sql.exec('UPDATE company_mail SET verified_revision=NULL');
    order('shop-a1', 14, 'DK', days(6));
    await assert.rejects(
      sendReviewInvitations(env, 'company-a', 'shop-a1', owns),
      /kontakt@a1\.example\.test er ikke længere på et godkendt domæne/,
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT 1 FROM review_invitations WHERE external_id='gid://shopify/Order/14'",
        )
        .get(),
      undefined,
    );
  } finally {
    h.close();
  }
});

test('the page lists the queued orders, and an order can be excluded from the queue and put back', async () => {
  const h = harness();
  const call = (
    path,
    method = 'GET',
    body,
    user = 'local-a',
    shop = 'shop-a1',
  ) =>
    h.request('/api/platform/tier1/shops/' + shop + '/reviews' + path, {
      method,
      body,
      user,
    });
  try {
    const days = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const { defaultSettings } = loader()(
      'platform/tier1/src/lib/review-mail.ts',
    );
    for (const shop of ['shop-a1', 'shop-a2'])
      h.sql
        .prepare(
          'INSERT INTO review_invitation_settings(company_id,webshop_id,enabled,start_at,templates_json) VALUES(?,?,1,?,?)',
        )
        .run(
          'company-a',
          shop,
          days(30),
          JSON.stringify(defaultSettings('a.example.test').templates),
        );
    const order = (shop, n, country, shipped) => {
      const id = 'gid://shopify/Order/' + n;
      h.sql
        .prepare(
          "INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES('company-a',?,'orders',?,?,?)",
        )
        .run(
          shop,
          id,
          days(40),
          JSON.stringify({
            id,
            name: '#' + n,
            test: false,
            cancelledAt: null,
            displayFulfillmentStatus: 'FULFILLED',
            fulfillments: [{ createdAt: shipped, status: 'SUCCESS' }],
            currentTotalPriceSet: { shopMoney: { amount: '100.00' } },
          }),
        );
      if (country)
        h.sql
          .prepare(
            "INSERT INTO order_markets(company_id,webshop_id,external_id,country,currency) VALUES('company-a',?,?,?,'DKK')",
          )
          .run(shop, id, country);
      return id;
    };
    const first = order('shop-a1', 1, 'DK', days(6)); // ready
    order('shop-a1', 2, 'DK', days(2)); // in 3 days
    order('shop-a1', 3, undefined, days(9)); // waits for its market
    order('shop-a2', 1, 'DK', days(6)); // same Shopify ID in the other webshop
    let response = await call('');
    assert.equal(response.status, 200, await response.clone().text());
    let info = await response.json();
    assert.deepEqual(
      info.queue.map((o) => [o.orderName, o.locale, o.ready, o.waitsForMarket]),
      [
        ['#3', 'da', false, true],
        ['#1', 'da', true, false],
        ['#2', 'da', false, false],
      ],
    );
    assert.equal(info.counts.queued, 3);
    assert.equal(
      Date.parse(info.queue[2].dueAt) - Date.parse(info.queue[2].shippedAt),
      5 * 86400000,
    );

    // Readers and other companies cannot exclude; unknown and malformed orders are refused.
    assert.equal(
      (await call('/exclude', 'POST', { orderId: first }, 'local-reader'))
        .status,
      403,
    );
    assert.equal(
      (await call('/exclude', 'POST', { orderId: first }, 'local-b')).status,
      404,
    );
    assert.equal(
      (await call('/exclude', 'POST', { orderId: 'gid://shopify/Order/99' }))
        .status,
      404,
    );
    assert.equal(
      (await call('/exclude', 'POST', { orderId: "1' OR 1=1" })).status,
      400,
    );
    response = await call('/exclude', 'POST', { orderId: first });
    assert.equal(response.status, 200, await response.clone().text());
    info = await response.json();
    assert.deepEqual(
      info.queue.map((o) => o.orderName),
      ['#3', '#2'],
    );
    assert.equal(info.counts.ready, 0);
    assert.deepEqual(
      info.log.map((r) => [r.orderName, r.status, r.excluded]),
      [['#1', 'skipped', true]],
    );
    // Only this webshop's order: the same ID in the other webshop stays in its queue.
    assert.deepEqual(
      (
        await (await call('', 'GET', undefined, 'local-a', 'shop-a2')).json()
      ).queue.map((o) => o.orderName),
      ['#1'],
    );
    assert.equal(
      (await call('/exclude', 'POST', { orderId: first })).status,
      409,
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT count(*) n FROM audit_events WHERE action='reviews.order.excluded'",
        )
        .get().n,
      1,
    );

    // Put back: in the queue again. An order skipped or sent by the run cannot be put back.
    response = await call('/include', 'POST', { orderId: first });
    assert.equal(response.status, 200, await response.clone().text());
    info = await response.json();
    assert.equal(info.counts.queued, 3);
    assert.equal(info.log.length, 0);
    assert.equal(
      (await call('/include', 'POST', { orderId: first })).status,
      409,
    );
    h.sql
      .prepare(
        "INSERT INTO review_invitations(company_id,webshop_id,external_id,order_name,status) VALUES('company-a','shop-a1',?,'#1','sent')",
      )
      .run(first);
    assert.equal(
      (await call('/include', 'POST', { orderId: first })).status,
      409,
    );
    assert.equal(
      (await call('/exclude', 'POST', { orderId: first })).status,
      409,
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT status FROM review_invitations WHERE webshop_id='shop-a1' AND external_id=?",
        )
        .get(first).status,
      'sent',
    );
  } finally {
    h.close();
  }
});
