// Integrationer → Cloudflare E-mail: one connection per company, approved domains, moving older senders over, and
// Faktura-afsendelse and Anmeldelser choosing an address on an approved domain.
import { test, assert, harness, loader, jose } from './platform-harness.mjs';

const account = 'a'.repeat(32),
  otherAccount = 'b'.repeat(32),
  key = 'ab'.repeat(32);
const plain = (rows) => rows.map((r) => ({ ...r }));

function setup() {
  const calls = [];
  let tokenActive = true,
    zones = true,
    failSend = false,
    duringLookup = null;
  const network = async (url, options = {}) => {
    assert.equal(options.redirect, 'manual');
    calls.push({
      url,
      auth: options.headers?.Authorization,
      body: options.body,
    });
    if (url.endsWith('/tokens/verify'))
      return Response.json({
        success: tokenActive,
        result: tokenActive ? { status: 'active' } : null,
      });
    if (url.includes('/zones?'))
      return zones
        ? Response.json({
            success: true,
            result: [{ id: 'c'.repeat(32) }, { id: 'not-a-zone' }],
          })
        : Response.json({ success: false }, { status: 403 });
    if (url.endsWith('/email/sending/subdomains')) {
      // Lets a test change the saved connection while Cloudflare is being asked (another tab saving).
      duringLookup?.();
      duringLookup = null;
    }
    if (url.endsWith('/email/sending/subdomains'))
      return Response.json({
        success: true,
        result: [
          { name: 'sablen.dk', enabled: true },
          { name: 'Mail.Sablen.dk', enabled: true },
          { name: 'off.sablen.dk', enabled: false },
          { name: 'bad domain', enabled: true },
        ],
      });
    if (url.endsWith('/email/sending/send')) {
      if (failSend) throw Error('timeout');
      const body = JSON.parse(options.body);
      return Response.json({
        success: true,
        result: { delivered: [body.to] },
      });
    }
    throw Error('unexpected ' + url);
  };
  const h = harness(jose, network);
  const env = {
    ...h.env,
    PLATFORM_ENV: 'production',
    PLATFORM_CUSTOMER_EMAIL: 'enabled',
    PLATFORM_CREDENTIALS_KEY: key,
    PLATFORM_MAIL_FROM: 'faktura@webshoptoolbox.dk',
    PLATFORM_MAIL_TEST: {
      send: async () => {
        throw Error('Standard sender must not be used');
      },
    },
  };
  const load = loader({ jose, fetch: network });
  const connection = load('platform/mail-connection.ts'),
    mail = load('platform/mail.ts'),
    { seal } = load('platform/connections.ts');
  const actors = {
    'local-a': { id: 'local-a', email: 'a@example.test', platformAdmin: false },
    'local-reader': {
      id: 'local-reader',
      email: 'reader@example.test',
      platformAdmin: false,
    },
    'local-b': { id: 'local-b', email: 'b@example.test', platformAdmin: false },
  };
  const call = async (
    path,
    method = 'GET',
    body,
    user = 'local-a',
    company = 'company-a',
  ) => {
    try {
      return await connection.handleMailConnection(
        new Request('https://platform.example.test/x', {
          method,
          headers: {
            origin: 'https://platform.example.test',
            'content-type': 'application/json',
          },
          ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }),
        }),
        env,
        actors[user],
        company,
        '/mail/connection' + path,
      );
    } catch (error) {
      return Response.json({ error: error.message }, { status: error.status });
    }
  };
  return {
    h,
    env,
    call,
    calls,
    mail,
    connection,
    seal,
    set: (v) => {
      if ('tokenActive' in v) tokenActive = v.tokenActive;
      if ('zones' in v) zones = v.zones;
      if ('failSend' in v) failSend = v.failSend;
      if ('duringLookup' in v) duringLookup = v.duringLookup;
    },
  };
}
const legacy = async (s, table, from, acct, extra = {}) => {
  const credentials = await s.seal(s.env, ['company-a', 'mail', from, acct], {
    token: 'legacy-token-' + acct.slice(0, 1).repeat(12),
  });
  const verified = extra.verified === false ? null : 'r1';
  if (table === 'company_mail')
    s.h.sql
      .prepare(
        "INSERT INTO company_mail(company_id,sender_name,reply_to,custom_from,account_id,credentials_encrypted,revision,verified_revision) VALUES('company-a','Sablen','',?,?,?,'r1',?)",
      )
      .run(from, acct, credentials, verified);
  else
    s.h.sql
      .prepare(
        "INSERT INTO market_mail(company_id,webshop_id,market_id,sender_name,reply_to,custom_from,account_id,credentials_encrypted,revision,verified_revision) VALUES('company-a','shop-a1',?,'Sabeln','',?,?,?,'r1',?)",
      )
      .run(extra.market, from, acct, credentials, verified);
};

test('approved older senders move to the Cloudflare E-mail connection once, per company', async () => {
  const s = setup();
  try {
    s.h.sql.exec(
      "INSERT INTO webshop_markets(company_id,webshop_id,market_id,name,countries_json,currency,locale,store_name,invoice_subject,invoice_body,vat_mode,enabled) VALUES('company-a','shop-a1','gid://shopify/Market/2','Sverige','[\"SE\"]','SEK','sv','Sabeln','s','b','domestic',1),('company-a','shop-a1','gid://shopify/Market/3','Norge','[\"NO\"]','NOK','da','Sablen NO','s','b','domestic',1)",
    );
    await legacy(s, 'company_mail', 'kontakt@sablen.dk', account);
    await legacy(s, 'market_mail', 'kontakt@sabeln.se', account, {
      market: 'gid://shopify/Market/2',
    });
    // Another account, and a sender that was never approved, are not moved.
    await legacy(s, 'market_mail', 'x@other.test', otherAccount, {
      market: 'gid://shopify/Market/3',
    });
    let info = await (await s.call('')).json();
    assert.equal(info.connected, true);
    assert.equal(info.source, 'migrated');
    assert.equal(info.accountId, account);
    assert.deepEqual(
      info.domains.map((d) => [d.domain, d.source]),
      [
        ['sabeln.se', 'migrated'],
        ['sablen.dk', 'migrated'],
      ],
    );
    assert.doesNotMatch(JSON.stringify(info), /token/i);
    assert.equal(
      s.h.sql
        .prepare(
          "SELECT 1 AS n FROM company_integrations WHERE company_id='company-a' AND integration_id='cloudflare'",
        )
        .get().n,
      1,
    );
    // Older rows are kept; reading again moves nothing twice.
    assert.equal(
      s.h.sql.prepare('SELECT count(*) AS n FROM market_mail').get().n,
      2,
    );
    info = await (await s.call('')).json();
    assert.equal(info.domains.length, 2);
    // A domain can be limited to some webshops: the others neither list it nor send from it.
    const limited = await (await s.call('')).json();
    assert.equal(
      (
        await s.call('/domain', 'PUT', {
          revision: limited.revision,
          domain: 'sablen.dk',
          webshops: ['shop-b1'],
        })
      ).status,
      400,
    );
    const onlyA1 = await (
      await s.call('/domain', 'PUT', {
        revision: limited.revision,
        domain: 'sablen.dk',
        webshops: ['shop-a1'],
      })
    ).json();
    assert.deepEqual(
      onlyA1.domains.find((d) => d.domain === 'sablen.dk').webshops,
      ['shop-a1'],
    );
    assert.deepEqual(
      (await s.mail.currentSender(s.env, 'company-a', { shop: 'shop-a2' }))
        .domains,
      ['sabeln.se'],
    );
    // shop-a2 sends as the company (kontakt@sablen.dk), but not from the limited domain, also not with older credentials.
    assert.equal(
      (await s.mail.currentSender(s.env, 'company-a', { shop: 'shop-a2' }))
        .from,
      'faktura@webshoptoolbox.dk',
    );
    assert.equal(
      (await s.mail.currentSender(s.env, 'company-a', { shop: 'shop-a1' }))
        .from,
      'kontakt@sablen.dk',
    );
    await assert.rejects(
      s.mail.deliverMail(
        s.env,
        'company-a',
        { shop: 'shop-a2' },
        {
          to: 'kunde@example.test',
          subject: 'Hej',
          html: '<p>x</p>',
          text: 'x',
        },
        { from: 'hej@sablen.dk' },
      ),
      /ikke på et godkendt domæne/,
    );
    // A webshop's own older sender on the limited domain is neither approved nor testable there.
    const wsCredentials = await s.seal(
      s.env,
      ['company-a', 'mail', 'shop@sablen.dk', account],
      { token: 'legacy-token-ssssssssssss' },
    );
    s.h.sql.exec(
      "INSERT INTO webshop_markets(company_id,webshop_id,market_id,name,countries_json,currency,locale,store_name,invoice_subject,invoice_body,vat_mode,enabled) VALUES('company-a','shop-a2','gid://shopify/Market/9','Norge','[\"NO\"]','NOK','da','A2 NO','s','b','domestic',1)",
    );
    s.h.sql
      .prepare(
        "INSERT INTO market_mail(company_id,webshop_id,market_id,sender_name,reply_to,custom_from,account_id,credentials_encrypted,revision,verified_revision) VALUES('company-a','shop-a2','gid://shopify/Market/9','X','','shop@sablen.dk',?,?,'r9','r9')",
      )
      .run(account, wsCredentials);
    const marketScope = { shop: 'shop-a2', market: 'gid://shopify/Market/9' };
    assert.equal(
      (await s.mail.currentSender(s.env, 'company-a', marketScope)).from,
      'faktura@webshoptoolbox.dk',
    );
    const actorA = {
      id: 'local-a',
      email: 'a@example.test',
      platformAdmin: false,
    };
    const mailCall = (method, action, body) =>
      s.mail
        .handleMail(
          new Request('https://platform.example.test/sender', {
            method,
            headers: {
              origin: 'https://platform.example.test',
              'content-type': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
          { ...s.env, PLATFORM_MAIL_TEST_RECIPIENTS: 'a@example.test' },
          actorA,
          'company-a',
          action,
          undefined,
          marketScope,
        )
        .then((r) => r.json())
        .catch((e) => ({ error: e.message }));
    assert.equal((await mailCall('GET')).status, 'pending');
    const sends = s.calls.length;
    assert.match(
      (
        await mailCall('POST', 'test', {
          requestId: crypto.randomUUID(),
          mode: 'custom',
        })
      ).error,
      /sablen\.dk er ikke godkendt/,
    );
    assert.equal(s.calls.length, sends);
    s.h.sql.exec("DELETE FROM market_mail WHERE webshop_id='shop-a2'");
    s.h.sql.exec("DELETE FROM webshop_markets WHERE webshop_id='shop-a2'");
    await s.call('/domain', 'PUT', {
      revision: limited.revision,
      domain: 'sablen.dk',
      webshops: [],
    });
    // Removing a moved domain also stops the older sender it came from.
    const before = await s.mail.currentSender(s.env, 'company-a', undefined);
    assert.equal(before.from, 'kontakt@sablen.dk');
    const listed = await (await s.call('')).json();
    await s.call('/domain', 'DELETE', {
      revision: listed.revision,
      domain: 'sablen.dk',
    });
    const after = await s.mail.currentSender(s.env, 'company-a', undefined);
    assert.deepEqual(
      [after.from, after.domains],
      ['faktura@webshoptoolbox.dk', ['sabeln.se']],
    );
    // Company B sees nothing of company A.
    assert.equal(
      (
        await (
          await s.call('', 'GET', undefined, 'local-b', 'company-b')
        ).json()
      ).connected,
      false,
    );
    assert.equal((await s.call('', 'GET', undefined, 'local-b')).status, 403);
    // Mails from the moved domains go out with the connection's token, also from another address on the domain.
    const sent = await s.mail.deliverMail(
      s.env,
      'company-a',
      { shop: 'shop-a1', market: 'gid://shopify/Market/2' },
      { to: 'kunde@example.test', subject: 'Hej', html: '<p>x</p>', text: 'x' },
      { from: 'hej@sabeln.se', name: 'Sabeln' },
    );
    assert.equal(sent.from, 'hej@sabeln.se');
    const last = s.calls.at(-1);
    assert.equal(
      last.url,
      `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`,
    );
    assert.equal(last.auth, 'Bearer legacy-token-aaaaaaaaaaaa');
    assert.equal(JSON.parse(last.body).from.name, 'Sabeln');
    await assert.rejects(
      s.mail.deliverMail(
        s.env,
        'company-a',
        undefined,
        {
          to: 'kunde@example.test',
          subject: 'Hej',
          html: '<p>x</p>',
          text: 'x',
        },
        { from: 'hej@unknown.test' },
      ),
      /ikke på et godkendt domæne/,
    );
  } finally {
    s.h.close();
  }
});

test('a connection is saved with a checked token, discovers domains and approves others by a test mail', async () => {
  const s = setup();
  try {
    const body = {
      accountId: account,
      apiToken: 'cf-token-1234567890abcdef',
      revision: null,
    };
    assert.equal((await s.call('', 'PUT', body, 'local-reader')).status, 403);
    assert.equal(
      (await s.call('', 'PUT', { ...body, accountId: 'nope' })).status,
      400,
    );
    s.set({ tokenActive: false });
    let response = await s.call('', 'PUT', body);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /godkendte ikke tokenet/);
    s.set({ tokenActive: true });
    response = await s.call('', 'PUT', body);
    assert.equal(response.status, 200, await response.clone().text());
    let info = await response.json();
    assert.equal(info.discovery, true);
    assert.deepEqual(
      info.domains.map((d) => [d.domain, d.source]),
      [
        ['mail.sablen.dk', 'cloudflare'],
        ['sablen.dk', 'cloudflare'],
      ],
    );
    const saved = s.h.sql.prepare('SELECT * FROM mail_connections').get();
    assert.doesNotMatch(saved.credentials_encrypted, /cf-token/);
    // A stale tab cannot overwrite it.
    assert.equal((await s.call('', 'PUT', body)).status, 409);
    // A token without zone access: domains are approved by a test mail from them.
    s.set({ zones: false });
    response = await s.call('/refresh', 'POST', { revision: info.revision });
    info = await response.json();
    assert.equal(info.discovery, false);
    const requestId = crypto.randomUUID();
    response = await s.call('/test', 'POST', {
      revision: info.revision,
      requestId,
      from: 'kontakt@sabeln.se',
    });
    info = await response.json();
    assert.equal(info.status, 'accepted');
    assert.equal(info.recipient, 'a@example.test');
    assert.ok(
      info.domains.some((d) => d.domain === 'sabeln.se' && d.source === 'test'),
    );
    assert.equal(s.calls.at(-1).auth, 'Bearer cf-token-1234567890abcdef');
    // Same request id: no second mail. A new one within a minute is held back.
    const before = s.calls.length;
    assert.equal(
      (
        await (
          await s.call('/test', 'POST', {
            revision: info.revision,
            requestId,
            from: 'kontakt@sabeln.se',
          })
        ).json()
      ).status,
      'accepted',
    );
    assert.equal(s.calls.length, before);
    assert.equal(
      (
        await s.call('/test', 'POST', {
          revision: info.revision,
          requestId: crypto.randomUUID(),
          from: 'x@new.test',
        })
      ).status,
      429,
    );
    // An unconfirmed test approves nothing and is not resent.
    s.h.sql.exec('UPDATE mail_test_deliveries SET created_at=0');
    s.set({ failSend: true });
    info = await (
      await s.call('/test', 'POST', {
        revision: info.revision,
        requestId: crypto.randomUUID(),
        from: 'x@new.test',
      })
    ).json();
    assert.equal(info.status, 'uncertain');
    assert.ok(!info.domains.some((d) => d.domain === 'new.test'));
    // A domain can be removed again.
    info = await (
      await s.call('/domain', 'DELETE', {
        revision: info.revision,
        domain: 'mail.sablen.dk',
      })
    ).json();
    assert.ok(!info.domains.some((d) => d.domain === 'mail.sablen.dk'));
    // A lookup that finishes after another tab saved a new connection adds nothing to it.
    s.set({
      zones: true,
      duringLookup: () =>
        s.h.sql.exec(
          "UPDATE mail_connections SET revision='other-tab' WHERE company_id='company-a'",
        ),
    });
    s.h.sql.exec("DELETE FROM mail_domains WHERE domain='sablen.dk'");
    await s.call('/refresh', 'POST', { revision: info.revision });
    assert.equal(
      s.h.sql
        .prepare(
          "SELECT count(*) AS n FROM mail_domains WHERE domain='sablen.dk'",
        )
        .get().n,
      0,
    );
    s.h.sql.exec(
      `UPDATE mail_connections SET revision='${info.revision}' WHERE company_id='company-a'`,
    );
    // A save racing another tab is refused and adds nothing.
    s.set({
      duringLookup: () =>
        s.h.sql.exec(
          "UPDATE mail_connections SET revision='other-tab' WHERE company_id='company-a'",
        ),
    });
    const raced = await s.call('', 'PUT', {
      ...body,
      accountId: otherAccount,
      revision: info.revision,
    });
    assert.equal(raced.status, 409);
    assert.equal(
      s.h.sql.prepare('SELECT account_id FROM mail_connections').get()
        .account_id,
      account,
    );
    s.h.sql.exec(
      `UPDATE mail_connections SET revision='${info.revision}' WHERE company_id='company-a'`,
    );
    // Saving another account drops the domains approved on the old one.
    s.set({ zones: false, failSend: false });
    info = await (
      await s.call('', 'PUT', {
        ...body,
        accountId: otherAccount,
        revision: info.revision,
      })
    ).json();
    assert.deepEqual(info.domains, []);
  } finally {
    s.h.close();
  }
});

test('Faktura-afsendelse picks an address on an approved domain, and removing the connection stops own senders', async () => {
  const s = setup();
  try {
    await legacy(s, 'company_mail', 'kontakt@sablen.dk', account);
    const actor = {
      id: 'local-a',
      email: 'a@example.test',
      platformAdmin: false,
    };
    const sender = async (body) => {
      try {
        return await (
          await s.mail.handleMail(
            new Request('https://platform.example.test/sender', {
              method: body ? 'PUT' : 'GET',
              headers: {
                origin: 'https://platform.example.test',
                'content-type': 'application/json',
              },
              ...(body ? { body: JSON.stringify(body) } : {}),
            }),
            s.env,
            actor,
            'company-a',
          )
        ).json();
      } catch (error) {
        return { error: error.message };
      }
    };
    let info = await sender();
    assert.equal(info.connected, true);
    assert.deepEqual(info.domains, ['sablen.dk']);
    assert.equal(info.status, 'verified');
    // Another address on the approved domain, no account or token needed.
    info = await sender({
      senderName: 'Sablen',
      replyTo: '',
      customFrom: 'faktura@sablen.dk',
    });
    assert.equal(info.status, 'verified');
    assert.equal(info.effectiveFrom, 'faktura@sablen.dk');
    const row = s.h.sql.prepare('SELECT * FROM company_mail').get();
    assert.equal(row.credentials_encrypted, null);
    assert.equal(row.verified_revision, row.revision);
    assert.match(
      (
        await sender({
          senderName: 'Sablen',
          replyTo: '',
          customFrom: 'faktura@unknown.test',
        })
      ).error,
      /unknown\.test er ikke godkendt/,
    );
    const current = await s.mail.currentSender(s.env, 'company-a', undefined);
    assert.deepEqual(
      [current.from, current.domains],
      ['faktura@sablen.dk', ['sablen.dk']],
    );
    // Removing the connection: own senders fall back to the standard sender and nothing is moved back.
    const revision = (await (await s.call('')).json()).revision;
    assert.equal(
      (await s.call('', 'DELETE', { revision }, 'local-reader')).status,
      403,
    );
    const removed = await (await s.call('', 'DELETE', { revision })).json();
    assert.equal(removed.connected, false);
    assert.equal(
      s.h.sql
        .prepare(
          'SELECT count(*) AS n FROM company_mail WHERE credentials_encrypted IS NOT NULL',
        )
        .get().n,
      0,
    );
    info = await sender();
    assert.equal(info.connected, false);
    assert.equal(info.status, 'pending');
    assert.equal(info.effectiveFrom, 'faktura@webshoptoolbox.dk');
    assert.deepEqual(
      plain(s.h.sql.prepare('SELECT * FROM mail_domains').all()),
      [],
    );
  } finally {
    s.h.close();
  }
});

test('the integration is listed, shown as connected and cannot be deselected while connected', async () => {
  const h = harness();
  try {
    const shop = (path, options = {}) =>
      h.request('/api/platform/tier1/shops/shop-a1' + path, {
        user: 'local-a',
        ...options,
      });
    let r = await shop('/integrations/selection', {
      method: 'POST',
      body: { provider: 'cloudflare', action: 'add' },
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.ok((await r.json()).selected.includes('cloudflare'));
    // Locally the token is not sent to Cloudflare; the portal can still be used end to end.
    h.env.PLATFORM_CREDENTIALS_KEY = key;
    r = await shop('/mail/connection', {
      method: 'PUT',
      body: {
        accountId: account,
        apiToken: 'cf-token-1234567890abcdef',
        revision: null,
      },
      env: { PLATFORM_CREDENTIALS_KEY: key },
    });
    assert.equal(r.status, 200, await r.clone().text());
    const info = await r.json();
    r = await shop('/mail/connection/test', {
      method: 'POST',
      body: {
        revision: info.revision,
        requestId: crypto.randomUUID(),
        from: 'kontakt@sablen.dk',
      },
      env: { PLATFORM_CREDENTIALS_KEY: key },
    });
    const tested = await r.json();
    assert.equal(tested.status, 'preview');
    assert.deepEqual(
      tested.domains.map((d) => d.domain),
      ['sablen.dk'],
    );
    r = await shop('/integrations/selection', {
      method: 'POST',
      body: { provider: 'cloudflare', action: 'remove' },
    });
    assert.equal(r.status, 409);
    r = await shop('/integrations/selection');
    assert.ok((await r.json()).connected.includes('cloudflare'));
    // Other companies and readers cannot reach it.
    assert.equal(
      (
        await (
          await h.request('/api/platform/tier1/shops/none/mail/connection', {
            user: 'local-b',
          })
        ).json()
      ).connected,
      false,
    );
    assert.equal(
      (
        await shop('/mail/connection', {
          method: 'PUT',
          user: 'local-reader',
          body: {
            accountId: account,
            apiToken: 'cf-token-1234567890abcdef',
            revision: info.revision,
          },
        })
      ).status,
      403,
    );
  } finally {
    h.close();
  }
});
