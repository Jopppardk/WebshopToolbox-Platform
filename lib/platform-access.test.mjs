// Identity, tenant isolation, Tier 0 administration, invitations, customer login, support and runtime safety.
import {
  test,
  assert,
  readFileSync,
  readdirSync,
  DatabaseSync,
  jose,
  pdfLib,
  loader,
  validateConfig,
  root,
  read,
  token,
  harness,
  startSupport,
  customerEnv,
  customerRequest,
  customerStart,
  customerVerify,
} from './platform-harness.mjs';

test('public signup atomically creates an inactive company administrator; verified activation starts a single trial', async () => {
  const h = harness();
  try {
    const env = {
      PLATFORM_SIGNUP: 'enabled',
      PLATFORM_CUSTOMER_LOGIN: 'enabled',
      PLATFORM_LOGIN_SECRET: 'ab'.repeat(32),
    };
    const body = {
      name: 'New Owner',
      company: 'New Shop',
      email: 'signup@example.test',
      cvr: '12345678',
      accept: true,
    };
    const send = (extra) =>
      h.request('/auth/signup', {
        auth: false,
        method: 'POST',
        env,
        body: { ...body, ...extra },
      });
    const before = h.sql.prepare('SELECT count(*) n FROM companies').get().n;
    const r = await send({ role: 'platformAdmin', companyId: 'company-a' });
    assert.equal(r.status, 202, await r.clone().text());
    const link = (await r.json()).previewLink,
      invitation = new URL(link).searchParams.get('invitation');
    const user = h.sql
      .prepare('SELECT * FROM users WHERE email=?')
      .get(body.email);
    assert.equal(user.status, 'inactive');
    assert.notEqual(user.company_id, 'company-a');
    assert.equal(
      h.sql
        .prepare('SELECT role FROM company_memberships WHERE user_id=?')
        .get(user.id).role,
      'admin',
    );
    assert.equal(
      h.sql
        .prepare('SELECT * FROM platform_admins WHERE user_id=?')
        .get(user.id),
      undefined,
    );
    assert.equal(
      h.sql
        .prepare('SELECT trial_started_at FROM public_signups WHERE user_id=?')
        .get(user.id).trial_started_at,
      null,
    );
    assert.equal((await send({})).status, 202);
    assert.equal((await send({ email: 'different@example.test' })).status, 202);
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM companies').get().n,
      before + 1,
    );
    const start = await customerStart(h, body.email, { invitation });
    const verified = await customerVerify(h, start, { name: body.name });
    assert.equal(verified.status, 200, await verified.clone().text());
    const session = verified.headers
      .getSetCookie()
      .find((c) => c.startsWith('__Host-toolbox_session='))
      .split(';')[0];
    const trial = h.sql
      .prepare('SELECT * FROM public_signups WHERE user_id=?')
      .get(user.id);
    assert.ok(trial.trial_started_at);
    assert.ok(trial.trial_ends_at >= trial.trial_started_at + 89 * 86400);
    assert.equal(trial.trial_ends_at - trial.contact_due_at, 14 * 86400);
    assert.equal(
      (
        await customerRequest(h, '/api/platform/companies/company-a/members', {
          headers: { cookie: session },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await customerRequest(h, '/api/platform/settings/welcome', {
          headers: { cookie: session },
        })
      ).status,
      403,
    );
    assert.equal(
      (await customerVerify(h, start, { name: body.name })).status,
      401,
    );
    assert.equal(
      h.sql
        .prepare('SELECT trial_started_at FROM public_signups WHERE user_id=?')
        .get(user.id).trial_started_at,
      trial.trial_started_at,
    );
    h.sql
      .prepare('UPDATE public_signups SET trial_ends_at=1 WHERE user_id=?')
      .run(user.id);
    assert.equal(
      (
        await customerRequest(h, '/api/platform/me', {
          headers: { cookie: session },
        })
      ).status,
      403,
    );
  } finally {
    h.close();
  }
});
test('signup validates consent/origin, bounds abuse and rolls back partial creation', async () => {
  const h = harness();
  try {
    const env = {
      PLATFORM_SIGNUP: 'enabled',
      PLATFORM_CUSTOMER_LOGIN: 'enabled',
      PLATFORM_LOGIN_SECRET: 'ab'.repeat(32),
    };
    const body = {
      name: 'New Owner',
      company: 'New Shop',
      email: 'signup@example.test',
      cvr: '12345678',
      accept: true,
    };
    const opts = { auth: false, method: 'POST', env, body };
    assert.equal(
      (
        await h.request('/auth/signup', {
          ...opts,
          csrfOrigin: 'https://attacker.test',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request('/auth/signup', {
          ...opts,
          body: { ...body, accept: false },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.request('/auth/signup', {
          ...opts,
          body: { ...body, website: 'spam' },
        })
      ).status,
      400,
    );
    const before = h.sql.prepare('SELECT count(*) n FROM companies').get().n;
    h.sql.exec(
      "CREATE TRIGGER fail_signup BEFORE INSERT ON public_signups BEGIN SELECT RAISE(ABORT,'fixture fail'); END",
    );
    assert.equal((await h.request('/auth/signup', opts)).status, 500);
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM companies').get().n,
      before,
    );
    assert.equal(
      h.sql.prepare('SELECT * FROM users WHERE email=?').get(body.email),
      undefined,
    );
    h.sql.exec('DROP TRIGGER fail_signup');
    for (let n = 0; n < 6; n++)
      await h.request('/auth/signup', {
        ...opts,
        body: {
          ...body,
          email: `signup${n}@example.test`,
          cvr: String(12345670 + n),
        },
      });
    assert.equal((await h.request('/auth/signup', opts)).status, 429);
  } finally {
    h.close();
  }
});
test('welcome template uses revision checks, rejects missing link and restricts customer access', async () => {
  const h = harness();
  try {
    const path = '/api/platform/settings/welcome',
      original = await (await h.request(path)).json();
    assert.equal((await h.request(path, { user: 'local-a' })).status, 403);
    assert.equal(
      (
        await h.request(path, {
          method: 'PUT',
          body: { ...original, body: 'Missing invitation link' },
        })
      ).status,
      400,
    );
    const change = {
      ...original,
      subject: 'Hej {{name}}',
      body: 'Din virksomhed {{company}} er oprettet. {{link}}',
    };
    assert.equal(
      (await h.request(path, { method: 'PUT', body: change })).status,
      200,
    );
    assert.equal(
      (await h.request(path, { method: 'PUT', body: change })).status,
      409,
    );
    assert.equal(
      (await (await h.request(path)).json()).version,
      original.version + 1,
    );
  } finally {
    h.close();
  }
});
test('uncertain signup mail is not retried by a repeat submission and contains configured welcome content', async () => {
  const h = harness();
  try {
    const sent = [],
      env = {
        PLATFORM_ENV: 'remote-test',
        PLATFORM_AUTH: 'cloudflare-access',
        PLATFORM_SIGNUP: 'enabled',
        PLATFORM_CUSTOMER_LOGIN: 'enabled',
        PLATFORM_LOGIN_SECRET: 'ab'.repeat(32),
        PLATFORM_INVITATION_FROM: 'no-reply@webshoptoolbox.dk',
        PLATFORM_INVITATION_RECIPIENTS: 'signup@example.test',
        PLATFORM_INVITATIONS: {
          send: async (m) => {
            sent.push(m);
            throw Error('uncertain');
          },
        },
      };
    const opts = {
      auth: false,
      origin: 'https://dev.webshoptoolbox.dk',
      method: 'POST',
      env,
      headers: { 'cf-connecting-ip': '192.0.2.1' },
      body: {
        name: 'Owner',
        company: 'My Shop',
        email: 'signup@example.test',
        cvr: '12345678',
        accept: true,
      },
    };
    assert.equal((await h.request('/auth/signup', opts)).status, 202);
    assert.equal((await h.request('/auth/signup', opts)).status, 202);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /3 måneders gratis abonnement/);
    assert.match(
      sent[0].text,
      /https:\/\/dev.webshoptoolbox.dk\/onboarding\?invitation=[a-f0-9]{64}/,
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT delivery FROM invitations i JOIN users u ON u.id=i.user_id WHERE u.email='signup@example.test'",
        )
        .get().delivery,
      'uncertain',
    );
  } finally {
    h.close();
  }
});
test('platform requires signed identity; email headers and local auth on remote host give no access', async () => {
  const h = harness();
  try {
    for (const path of [
      '/',
      '/admin.js',
      '/api/platform/companies',
      '/api/sales/transfer',
    ])
      assert.equal(
        (
          await h.request(path, {
            auth: false,
            headers: { 'cf-access-authenticated-user-email': 'rene@sablen.dk' },
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await h.request('/api/platform/me', {
          origin: 'https://attacker.example',
        })
      ).status,
      401,
    );
    assert.equal((await h.request('/healthz', { auth: false })).status, 200);
  } finally {
    h.close();
  }
});
test('platform rejects wrong signature, issuer, audience, expiry and disabled identities', async () => {
  const h = harness();
  try {
    for (const options of [
      { secret: 'wrong-signature-secret-at-least-32-chars' },
      { issuer: 'urn:wrong' },
      { audience: 'wrong' },
      { exp: '-1h' },
    ])
      assert.equal(
        (
          await h.request('/api/platform/me', {
            token: await token('local-admin', options),
          })
        ).status,
        401,
      );
    h.sql.exec("UPDATE users SET status='inactive' WHERE id='local-reader'");
    assert.equal(
      (await h.request('/api/platform/me', { user: 'local-reader' })).status,
      403,
    );
  } finally {
    h.close();
  }
});
test('platform company lists and identical external IDs are isolated across A/B', async () => {
  const h = harness();
  try {
    for (const [user, company, shop, record] of [
      ['local-a', 'company-a', 'shop-a1', 'record-a'],
      ['local-b', 'company-b', 'shop-b1', 'record-b'],
    ]) {
      const list = await (
        await h.request('/api/platform/companies', { user })
      ).json();
      assert.deepEqual(
        list.companies.map((c) => c.id),
        [company],
      );
      const records = await (
        await h.request(
          `/api/platform/companies/${company}/webshops/${shop}/records`,
          { user },
        )
      ).json();
      assert.equal(records.records.length, 1);
      assert.equal(records.records[0].external_id, '123');
      assert.equal(records.records[0].id, record);
    }
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-b/webshops/shop-b1/records',
          { user: 'local-a' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-a/webshops/shop-b1/records',
          { user: 'local-a' },
        )
      ).status,
      404,
    );
  } finally {
    h.close();
  }
});
test('reader sees only assigned webshop and cannot create, list members, read audit or elevate role', async () => {
  const h = harness();
  try {
    const list = await (
      await h.request('/api/platform/companies/company-a/webshops', {
        user: 'local-reader',
      })
    ).json();
    assert.deepEqual(
      list.webshops.map((x) => x.id),
      ['shop-a1'],
    );
    for (const suffix of ['members', 'audit'])
      assert.equal(
        (
          await h.request(`/api/platform/companies/company-a/${suffix}`, {
            user: 'local-reader',
          })
        ).status,
        403,
      );
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-a/webshops/shop-a2/records',
          { user: 'local-reader' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/webshops', {
          user: 'local-reader',
          method: 'POST',
          body: { name: 'Forged', domain: 'forged.test' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/settings/admins', {
          user: 'local-reader',
        })
      ).status,
      403,
    );
  } finally {
    h.close();
  }
});
test('Tier 0 creates company and invites owner; Tier 1 manages webshop with atomic audit', async () => {
  const h = harness();
  try {
    const created = await h.request('/api/platform/companies', {
      method: 'POST',
      body: { name: 'Ny virksomhed' },
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal(
      (
        await h.provision(`/api/platform/companies/${id}/users`, {
          method: 'POST',
          body: {
            email: 'owner@example.test',
            issuer: 'urn:webshop-toolbox:local-test',
            subject: 'new-owner',
            role: 'admin',
          },
        })
      ).status,
      201,
    );
    const before = h.sql
      .prepare('SELECT count(*) n FROM audit_events WHERE company_id=?')
      .get(id).n;
    const shop = await h.request(`/api/platform/companies/${id}/webshops`, {
      user: 'new-owner',
      method: 'POST',
      body: { name: 'Ny shop', domain: 'new.example.test' },
    });
    assert.equal(shop.status, 201);
    const sid = (await shop.json()).id;
    assert.equal(
      (
        await h.request(`/api/platform/companies/${id}/webshops/${sid}`, {
          user: 'new-owner',
          method: 'PATCH',
          body: {
            name: 'Rettet',
            domain: 'new.example.test',
            status: 'inactive',
          },
        })
      ).status,
      200,
    );
    assert.equal(
      h.sql.prepare('SELECT status FROM webshops WHERE id=?').get(sid).status,
      'inactive',
    );
    assert.equal(
      h.sql
        .prepare('SELECT count(*) n FROM audit_events WHERE company_id=?')
        .get(id).n,
      before + 2,
    );
  } finally {
    h.close();
  }
});
test('admin changes user membership and grants; revocation is effective on next request', async () => {
  const h = harness();
  try {
    const u = await h.provision('/api/platform/companies/company-a/users', {
      method: 'POST',
      body: {
        email: 'new@example.test',
        issuer: 'urn:webshop-toolbox:local-test',
        subject: 'new-subject',
        role: 'member',
      },
    });
    assert.equal(u.status, 201);
    const id = (await u.json()).id;
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/members', {
          method: 'POST',
          body: { userId: id, role: 'member' },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-a/webshops/shop-a2/grants',
          {
            user: 'local-a',
            method: 'POST',
            body: { userId: id, role: 'reader' },
          },
        )
      ).status,
      200,
    );
    const auth = await token('new-subject');
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-a/webshops/shop-a2/records',
          { token: auth },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-a/webshops/shop-a2/grants',
          { user: 'local-a', method: 'DELETE', body: { userId: id } },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-a/webshops/shop-a2/records',
          { token: auth },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/members', {
          method: 'DELETE',
          body: { userId: id },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/webshops', {
          token: auth,
        })
      ).status,
      403,
    );
  } finally {
    h.close();
  }
});
test('company administrator cannot access another company, access portal settings', async () => {
  const h = harness();
  try {
    for (const [path, body] of [
      ['/companies', { name: 'x' }],
      [
        '/settings/admins',
        { email: 'x@example.test', issuer: 'urn:x', subject: 'x' },
      ],
      [
        '/companies/company-b/webshops',
        { name: 'x', domain: 'x.example.test' },
      ],
    ])
      assert.equal(
        (
          await h.request('/api/platform' + path, {
            user: 'local-a',
            method: 'POST',
            body,
          })
        ).status,
        403,
      );
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-a/webshops/shop-a1/grants',
          {
            user: 'local-a',
            method: 'POST',
            body: { userId: 'local-b', role: 'reader' },
          },
        )
      ).status,
      400,
    );
  } finally {
    h.close();
  }
});
test('composite foreign keys reject company/webshop and member mismatches', () => {
  const h = harness();
  try {
    assert.throws(
      () =>
        h.sql.exec(
          "INSERT INTO webshop_memberships VALUES('company-a','shop-b1','local-reader','reader')",
        ),
      /FOREIGN KEY/,
    );
    assert.throws(
      () =>
        h.sql.exec(
          "INSERT INTO webshop_memberships VALUES('company-a','shop-a1','local-b','reader')",
        ),
      /FOREIGN KEY/,
    );
    assert.throws(
      () =>
        h.sql.exec(
          "INSERT INTO source_records VALUES('bad','company-a','shop-b1','fixture','123','order')",
        ),
      /FOREIGN KEY/,
    );
    assert.throws(
      () =>
        h.sql.exec(
          "INSERT INTO source_records VALUES('dup','company-a','shop-a1','fixture','123','order')",
        ),
      /UNIQUE/,
    );
  } finally {
    h.close();
  }
});
test('inactive company/shop blocks members; company admin can find and reactivate own shop', async () => {
  const h = harness();
  try {
    h.sql.exec("UPDATE webshops SET status='inactive' WHERE id='shop-a1'");
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-a/webshops/shop-a1/records',
          { user: 'local-reader' },
        )
      ).status,
      403,
    );
    const list = await (
      await h.request('/api/platform/companies/company-a/webshops', {
        user: 'local-a',
      })
    ).json();
    assert.ok(list.webshops.find((x) => x.id === 'shop-a1'));
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/webshops/shop-a1', {
          user: 'local-a',
          method: 'PATCH',
          body: { name: 'A1', domain: 'a1.example.test', status: 'active' },
        })
      ).status,
      200,
    );
    h.sql.exec("UPDATE companies SET status='inactive' WHERE id='company-a'");
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/webshops', {
          user: 'local-a',
        })
      ).status,
      403,
    );
  } finally {
    h.close();
  }
});
test('CSRF, invalid roles, duplicate domains and self-deactivation are rejected', async () => {
  const h = harness();
  try {
    assert.equal(
      (
        await h.request('/api/platform/companies', {
          method: 'POST',
          body: { name: 'x' },
          csrfOrigin: 'https://evil.test',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/webshops', {
          method: 'POST',
          user: 'local-a',
          body: { name: 'x', domain: 'a1.example.test' },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/members', {
          method: 'POST',
          body: { userId: 'local-reader', role: 'superadmin' },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.request('/api/platform/settings/admins/local-admin', {
          method: 'PATCH',
          body: { status: 'inactive' },
        })
      ).status,
      409,
    );
  } finally {
    h.close();
  }
});
test('an audit failure rolls back the administrative mutation', async () => {
  const h = harness();
  try {
    h.sql.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END",
    );
    assert.equal(
      (
        await h.request('/api/platform/companies', {
          method: 'POST',
          body: { name: 'Must rollback' },
        })
      ).status,
      500,
    );
    assert.equal(
      h.sql
        .prepare("SELECT count(*) n FROM companies WHERE name='Must rollback'")
        .get().n,
      0,
    );
  } finally {
    h.close();
  }
});
test('all legacy import/write/mail/document routes are absent even for administrator', async () => {
  const h = harness();
  try {
    for (const path of [
      '/api/sales/transfer',
      '/api/refunds/transfer',
      '/api/payouts/transfer',
      '/api/bookkeeping/manual',
      '/api/emballage/reporting',
      '/api/invoices/email',
      '/api/invoices/email-test',
      '/api/flatpay/draft',
      '/api/shopify/inventory',
      '/api/documents',
      '/api/viabill/connection',
    ])
      for (const method of ['GET', 'POST'])
        assert.equal(
          (
            await h.request(path, {
              method,
              body: method === 'POST' ? {} : undefined,
            })
          ).status,
          404,
        );
    assert.deepEqual(await h.worker.scheduled({}, h.env), {
      status: 'disabled',
      reason: 'Ingen integrationsjobs i administrationens testmiljø.',
    });
  } finally {
    h.close();
  }
});
test('runtime refuses unsafe switches, legacy bindings and local authentication in remote mode', async () => {
  const h = harness();
  try {
    for (const env of [
      { PLATFORM_EXTERNAL_WRITES: 'true' },
      { PLATFORM_CUSTOMER_EMAIL: 'enabled' },
      { PLATFORM_ENV: 'production' },
      { DB: {} },
      { INVOICE_EMAIL: {} },
      { DINERO_API_KEY: 'synthetic' },
      { PLATFORM_ENV: 'remote-test' },
    ])
      assert.equal((await h.request('/healthz', { env })).status, 503);
    const safety = loader()('platform/safety.ts');
    assert.throws(() => safety.externalWrite('book'), /blokeret/);
    assert.throws(() => safety.customerEmail(), /blokeret/);
  } finally {
    h.close();
  }
});
test('remote Access validates real RSA signature and claims; local bearer/email spoof never bypasses it', async () => {
  const keys = await jose.generateKeyPair('RS256');
  const h = harness({ ...jose, createRemoteJWKSet: () => keys.publicKey });
  try {
    const issuer = 'https://test-team.cloudflareaccess.com',
      env = {
        PLATFORM_ENV: 'remote-test',
        PLATFORM_AUTH: 'cloudflare-access',
        PLATFORM_ACCESS_ISSUER: issuer,
        PLATFORM_ACCESS_AUD: 'fixture-aud',
      };
    h.sql
      .prepare(
        'UPDATE users SET identity_issuer=?,identity_subject=? WHERE id=?',
      )
      .run(issuer, 'verified-subject', 'local-admin');
    const jwt = await new jose.SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(issuer)
      .setSubject('verified-subject')
      .setAudience('fixture-aud')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(keys.privateKey);
    assert.equal(
      (
        await h.request('/api/platform/me', {
          env,
          headers: { 'cf-access-jwt-assertion': jwt },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request('/api/platform/me', {
          env,
          headers: {
            'cf-access-authenticated-user-email': 'admin@example.test',
          },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.request('/api/platform/me', {
          env: { ...env, PLATFORM_ACCESS_AUD: 'wrong' },
          headers: { 'cf-access-jwt-assertion': jwt },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.request('/api/platform/me', {
          env: { ...env, PLATFORM_ACCESS_AUD: '' },
        })
      ).status,
      503,
    );
  } finally {
    h.close();
  }
});
test('test config rejects production bindings, alternate entrypoints, services, cron and public static bypass', () => {
  const local = JSON.parse(read('wrangler.platform-local.json'));
  validateConfig(local);
  for (const change of [
    { name: 'sablen-integrationshub' },
    { main: 'worker-entry.ts' },
    { services: [] },
    { triggers: { crons: ['* * * * *'] } },
    { assets: { ...local.assets, run_worker_first: false } },
    {
      d1_databases: [
        {
          ...local.d1_databases[0],
          database_id: '154e8b5d-7f6c-42d7-b751-1defa0dd2549',
        },
      ],
    },
    { vars: { ...local.vars, PLATFORM_EXTERNAL_WRITES: 'true' } },
  ])
    assert.throws(() => validateConfig({ ...local, ...change }));
  const remote = JSON.parse(read('wrangler.platform-test.json'));
  validateConfig(remote, true);
  for (const pattern of [
    'portal.webshoptoolbox.dk',
    'webshoptoolbox.dk',
    '*.webshoptoolbox.dk',
    'integration.sablen.dk',
  ])
    assert.throws(() =>
      validateConfig(
        { ...remote, routes: [{ pattern, custom_domain: true }] },
        true,
      ),
    );

  assert.throws(() =>
    validateConfig(
      { ...remote, vars: { ...remote.vars, PLATFORM_AUTH: 'local-jwt' } },
      true,
    ),
  );
});
test('platform runtime imports no legacy code; only invitations, login codes, mail tests, invoice mail and operations alerts can send email', () => {
  for (const file of readdirSync(new URL('platform/', root)).filter((f) =>
    f.endsWith('.ts'),
  )) {
    const source = read('platform/' + file);
    for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g))
      assert.ok(
        [
          'jose',
          'pdf-lib',
          './tier1/src/lib/admin-settings',
          './tier1/src/lib/history-policy',
          './tier1/src/lib/order-period',
          './tier1/src/lib/booking-status',
          './tier1/src/lib/payout-status',
          './tier1/src/lib/sync-schedule',
          './tier1/src/lib/diagnostics',
          './tier1/src/lib/feed-name',
          './tier1/src/lib/performance',
          './tier1/src/lib/shipments',
          './tier1/src/lib/inventory',
          './tier1/src/lib/format',
          './tier1/src/lib/dashboard-finance',
        ].includes(match[1]) ||
          /^\.\/(signup|auth|admin|safety|types|invitations|catalog|support|connections|mail|invoices|invoice-pdf|invoice-design|invoice-source|order-check|customer-auth|tickets|invoice-line-order|operations|accounting|dinero-read|sales-preview|packaging|packaging-calculations|payout-calculations|payout-source|payout-pdf|money|documents|payments|flatpay-read|viabill-read|pensopay-read|shopify-metafields|flatpay-payout|packaging-source|stocktake|inventory-source|inventory-calculations|record-history|finance-source|finance-calculations|performance-source|performance-calculations|shipments-source|tier1-api|tier1-settings|tier1-connections|tier1-history|booking-onboarding|production-receipts|production-sales|production-booking|production-policy|production-proposals|production-emballage|production-stocktake|production-jobs|flatpay-report|dinero-write|tier1-data|flatpay-refunds|emballage-read|tier1-emballage|feeds|feed-source|feed-format|demo|demo-reset|packaging-products|order-markets|order-refunds|credit-notes|shipmondo|public-tracking|markets|invoice-profiles|order-detail|shipmondo-labels|tier1-data-shared|tier1-orders|tier1-order-refunds|tier1-documents|tier1-provider-records|run-cleanup|invoice-check|dinero-sale|refund-voucher|flatpay-draft|invoice-totals|ops-monitor|error-log|attention|invoice-translations|dashboard-shop)$/.test(
            match[1],
          ),
        `${file}: ${match[1]}`,
      );
    if (
      ![
        'public-tracking.ts',
        'shipmondo.ts',
        'shipmondo-labels.ts',
        'production-stocktake.ts',
        'mail.ts',
        'invoice-source.ts',
        'dinero-write.ts',
        'dinero-read.ts',
        'payout-source.ts',
        'flatpay-read.ts',
        'viabill-read.ts',
        'pensopay-read.ts',
        'shopify-metafields.ts',
        'packaging-products.ts',
        'finance-source.ts',
        'performance-source.ts',
        'emballage-read.ts',
      ].includes(file)
    )
      assert.doesNotMatch(source, /(?<!ASSETS\.)\bfetch\s*\((?!request:)/);
    if (
      ![
        'signup.ts',
        'invitations.ts',
        'mail.ts',
        'customer-auth.ts',
        'ops-monitor.ts',
      ].includes(file)
    )
      assert.doesNotMatch(source, /\.send\s*\(/);
  }
});
test('every current legacy API route is absent from the platform entrypoint', async () => {
  const h = harness();
  try {
    const jwt = await token();
    // The old Sablen routes (frozen in lib/legacy-routes.json when the old code was removed) must never answer here.
    for (const route of JSON.parse(read('lib/legacy-routes.json'))) {
      const [method, path] = route.split(' ');
      assert.equal(
        (
          await h.request(path, {
            token: jwt,
            method,
            body: method === 'GET' ? undefined : {},
          })
        ).status,
        404,
        route,
      );
    }
  } finally {
    h.close();
  }
});
test('local login sets a verified HttpOnly cookie and cannot run remotely', async () => {
  const h = harness();
  try {
    const jwt = await token();
    const response = await h.worker.fetch(
      new Request('http://127.0.0.1:8790/local-login', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:8790' },
        body: new URLSearchParams({ token: jwt }),
      }),
      h.env,
    );
    assert.equal(response.status, 303);
    assert.match(
      response.headers.get('set-cookie'),
      /HttpOnly; SameSite=Strict/,
    );
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(
      (
        await h.request('/api/platform/me', {
          auth: false,
          headers: { cookie: `platform_local=${jwt}` },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request('/local-login', {
          env: {
            PLATFORM_ENV: 'remote-test',
            PLATFORM_AUTH: 'cloudflare-access',
          },
        })
      ).status,
      503,
    );
  } finally {
    h.close();
  }
});

test('company ownership separates users from portal administrators', async () => {
  const h = harness();
  try {
    const res = await h.provision('/api/platform/companies/company-a/users', {
      user: 'local-a',
      method: 'POST',
      body: {
        email: 'owned@example.test',
        issuer: 'urn:webshop-toolbox:local-test',
        subject: 'owned',
        role: 'member',
      },
    });
    assert.equal(res.status, 201);
    const { id } = await res.json();
    assert.equal(
      h.sql.prepare('SELECT company_id FROM users WHERE id=?').get(id)
        .company_id,
      'company-a',
    );
    for (const [path, user, expected] of [
      [`/companies/company-b/users/${id}`, 'local-b', 404],
      [`/companies/company-a/users/${id}`, 'local-reader', 403],
      [`/settings/admins/${id}`, 'local-admin', 404],
    ])
      assert.equal(
        (
          await h.request('/api/platform' + path, {
            user,
            method: 'PATCH',
            body: { status: 'inactive' },
          })
        ).status,
        expected,
      );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-b/members', {
          method: 'POST',
          body: { userId: id, role: 'member' },
        })
      ).status,
      400,
    );
    assert.throws(
      () => h.sql.prepare('INSERT INTO platform_admins VALUES(?)').run(id),
      /Company users/,
    );
    assert.throws(
      () =>
        h.sql
          .prepare(
            "INSERT INTO company_memberships VALUES('company-b',?,'member')",
          )
          .run(id),
      /owner|UNIQUE/,
    );
    assert.throws(
      () =>
        h.sql
          .prepare("UPDATE users SET company_id='company-b' WHERE id=?")
          .run(id),
      /cannot change/,
    );
    assert.equal(
      (
        await h.request(`/api/platform/companies/company-a/users/${id}`, {
          user: 'local-a',
          method: 'PATCH',
          body: { status: 'inactive' },
        })
      ).status,
      200,
    );
    assert.equal(
      (await h.request('/api/platform/me', { user: 'owned' })).status,
      403,
    );
    assert.equal((await h.request('/api/platform/users')).status, 404);
    assert.deepEqual(
      (
        await (await h.request('/api/platform/settings/admins')).json()
      ).users.map((u) => u.id),
      ['local-admin'],
    );
    const pa = await h.provision('/api/platform/settings/admins', {
      method: 'POST',
      body: {
        email: 'portal@example.test',
        issuer: 'urn:webshop-toolbox:local-test',
        subject: 'portal-new',
      },
    });
    assert.equal(pa.status, 201);
    const aid = (await pa.json()).id;
    assert.equal(
      (
        await (
          await h.request('/api/platform/me', { user: 'portal-new' })
        ).json()
      ).user.platformAdmin,
      true,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/members', {
          method: 'POST',
          body: { userId: aid, role: 'admin' },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.request(`/api/platform/settings/admins/${aid}`, {
          method: 'PATCH',
          body: { status: 'inactive' },
        })
      ).status,
      200,
    );
    assert.equal(
      (await h.request('/api/platform/me', { user: 'portal-new' })).status,
      403,
    );
  } finally {
    h.close();
  }
});
test('ownership migration rejects ambiguous memberships and preserves valid ownership', () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec(read('platform/migrations/0001_admin.sql'));
    sql.exec(
      "INSERT INTO companies(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','urn:test','u','u@example.test','active'); INSERT INTO company_memberships VALUES('a','u','member'),('b','u','member');",
    );
    assert.throws(
      () => sql.exec(read('platform/migrations/0002_company_users.sql')),
      /UNIQUE/,
    );
    sql.exec("DELETE FROM company_memberships WHERE company_id='b'");
    sql.exec(read('platform/migrations/0002_company_users.sql'));
    assert.equal(
      sql.prepare("SELECT company_id FROM users WHERE id='u'").get().company_id,
      'a',
    );
  } finally {
    sql.close();
  }
});

test('invitation requires matching verified email, profile, fresh token and single use', async () => {
  const h = harness();
  try {
    const response = await h.request(
      '/api/platform/companies/company-a/users',
      {
        method: 'POST',
        body: { email: 'INVITED@example.test', role: 'member' },
      },
    );
    assert.equal(response.status, 201);
    const result = await response.json();
    const invitation = result.previewLink.split('invitation=')[1];
    const accept = (jwt, code = invitation, name = 'Invited User') =>
      h.request('/api/platform/onboarding', {
        token: jwt,
        method: 'POST',
        body: { token: code, name },
      });
    assert.equal(
      (await accept(await token('invited', { email: 'other@example.test' })))
        .status,
      403,
    );
    assert.equal((await accept(await token('invited'))).status, 400);
    const jwt = await token('invited', { email: 'invited@example.test' });
    assert.equal((await accept(jwt, invitation, '')).status, 400);
    assert.equal(
      (
        await h.request(
          `/api/platform/companies/company-a/users/${result.id}`,
          { method: 'PATCH', body: { status: 'active' } },
        )
      ).status,
      409,
    );
    assert.equal((await accept(jwt)).status, 200);
    assert.equal((await accept(jwt)).status, 403);
    assert.equal(
      (await (await h.request('/api/platform/me', { token: jwt })).json()).user
        .fullName,
      'Invited User',
    );
    assert.equal(
      h.sql
        .prepare('SELECT count(*) n FROM invitations WHERE token_hash=?')
        .get(invitation).n,
      0,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-b/users', {
          method: 'POST',
          body: { email: 'invited@example.test' },
        })
      ).status,
      409,
    );
  } finally {
    h.close();
  }
});
test('expired and revoked invitations are rejected; renewal invalidates old token', async () => {
  const h = harness();
  try {
    const first = await (
      await h.request('/api/platform/companies/company-a/users', {
        method: 'POST',
        body: { email: 'renew@example.test' },
      })
    ).json();
    const jwt = await token('renew', { email: 'renew@example.test' });
    const accept = (link) =>
      h.request('/api/platform/onboarding', {
        token: jwt,
        method: 'POST',
        body: { token: link.split('invitation=')[1], name: 'Renew User' },
      });
    h.sql
      .prepare('UPDATE invitations SET expires_at=0 WHERE user_id=?')
      .run(first.id);
    assert.equal((await accept(first.previewLink)).status, 403);
    const path = `/api/platform/companies/company-a/users/${first.id}/invitation`;
    assert.equal(
      (await h.request(path, { user: 'local-b', method: 'POST', body: {} }))
        .status,
      403,
    );
    const fresh = await (
      await h.request(path, { method: 'POST', body: {} })
    ).json();
    assert.equal((await accept(first.previewLink)).status, 403);
    assert.equal(
      (await h.request(path, { method: 'DELETE', body: {} })).status,
      200,
    );
    assert.equal((await accept(fresh.previewLink)).status, 403);
  } finally {
    h.close();
  }
});
test('first invite is company admin and last active admin is protected', async () => {
  const h = harness();
  try {
    const c = await (
      await h.request('/api/platform/companies', {
        method: 'POST',
        body: { name: 'Fresh' },
      })
    ).json();
    const first = await h.provision(`/api/platform/companies/${c.id}/users`, {
      method: 'POST',
      body: { email: 'first@example.test', subject: 'first', role: 'member' },
    });
    assert.equal(first.status, 201);
    const id = (await first.json()).id;
    assert.equal(
      h.sql
        .prepare('SELECT role FROM company_memberships WHERE user_id=?')
        .get(id).role,
      'admin',
    );
    for (const [path, method, body] of [
      [`/companies/${c.id}/users/${id}`, 'PATCH', { status: 'inactive' }],
      [`/companies/${c.id}/members`, 'POST', { userId: id, role: 'member' }],
      [`/companies/${c.id}/members`, 'DELETE', { userId: id }],
    ])
      assert.equal(
        (await h.request('/api/platform' + path, { method, body })).status,
        409,
      );
    const jwt = await token('first', { email: 'first@example.test' });
    const next = await h.request(`/api/platform/companies/${c.id}/users`, {
      token: jwt,
      method: 'POST',
      body: { email: 'next@example.test', role: 'admin' },
    });
    assert.equal(next.status, 201);
    // An unaccepted administrator invitation cannot replace the last active administrator.
    assert.equal(
      (
        await h.request(`/api/platform/companies/${c.id}/users/${id}`, {
          method: 'PATCH',
          body: { status: 'inactive' },
        })
      ).status,
      409,
    );
  } finally {
    h.close();
  }
});
test('profile gate and restricted invitation delivery never enable customer mail', async () => {
  const h = harness();
  try {
    h.sql.exec("UPDATE users SET full_name=NULL WHERE id='local-a'");
    assert.equal(
      (await h.request('/api/platform/companies', { user: 'local-a' })).status,
      428,
    );
    assert.equal(
      (
        await h.request('/api/platform/profile', {
          user: 'local-a',
          method: 'POST',
          body: { name: 'Alice', phone: '' },
        })
      ).status,
      200,
    );
    assert.equal(
      (await h.request('/api/platform/companies', { user: 'local-a' })).status,
      200,
    );
    let sent = 0;
    const env = {
      PLATFORM_INVITATION_MODE: 'restricted',
      PLATFORM_INVITATION_FROM: 'no-reply@webshoptoolbox.dk',
      PLATFORM_INVITATION_RECIPIENTS: 'allowed@example.test',
      PLATFORM_INVITATIONS: {
        send: async (m) => {
          sent++;
          assert.equal(m.to, 'allowed@example.test');
          throw Error('timeout');
        },
      },
    };
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/users', {
          env,
          method: 'POST',
          body: { email: 'blocked@example.test' },
        })
      ).status,
      503,
    );
    assert.equal(sent, 0);
    const result = await (
      await h.request('/api/platform/companies/company-a/users', {
        env,
        method: 'POST',
        body: { email: 'allowed@example.test' },
      })
    ).json();
    assert.equal(result.delivery, 'uncertain');
    assert.equal(result.previewLink, undefined);
    assert.equal(sent, 1);
    assert.equal(
      (
        await h.request('/api/invoices/email', {
          env,
          method: 'POST',
          body: {},
        })
      ).status,
      404,
    );
  } finally {
    h.close();
  }
});

test('logout clears local cookie, redirects to Access remotely and rejects foreign origins', async () => {
  const h = harness();
  try {
    const local = await h.request('/logout', {
      auth: false,
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:8790' },
    });
    assert.equal(local.status, 303);
    assert.equal(local.headers.get('location'), '/local-login');
    assert.match(
      local.headers.get('set-cookie'),
      /platform_local=;.*HttpOnly;.*Max-Age=0/,
    );
    assert.equal(local.headers.get('cache-control'), 'no-store');
    const remote = await h.request('/logout', {
      auth: false,
      method: 'POST',
      origin: 'https://portal.example.test',
      headers: { origin: 'https://portal.example.test' },
      env: {
        PLATFORM_ENV: 'remote-test',
        PLATFORM_AUTH: 'cloudflare-access',
        PLATFORM_LOCAL_SECRET: undefined,
      },
    });
    assert.equal(remote.status, 303);
    assert.equal(remote.headers.get('location'), '/cdn-cgi/access/logout');
    assert.equal(
      (
        await h.request('/logout', {
          auth: false,
          method: 'POST',
          headers: { origin: 'https://elsewhere.example' },
        })
      ).status,
      403,
    );
  } finally {
    h.close();
  }
});
test('support uses target permissions, isolates tenants and rejects stolen cookies and stale tabs', async () => {
  const h = harness();
  try {
    assert.equal(
      (
        await h.request('/api/platform/support', {
          user: 'local-a',
          method: 'POST',
          body: {
            companyId: 'company-a',
            userId: 'local-reader',
            reason: 'test',
          },
        })
      ).status,
      403,
    );
    for (const [userId, companyId] of [
      ['local-admin', 'company-a'],
      ['local-b', 'company-a'],
    ])
      assert.equal(
        (
          await h.request('/api/platform/support', {
            method: 'POST',
            body: { userId, companyId, reason: 'test' },
          })
        ).status,
        403,
      );
    assert.equal(
      (
        await h.request('/api/platform/support', {
          method: 'POST',
          csrfOrigin: 'https://evil.test',
          body: {
            userId: 'local-reader',
            companyId: 'company-a',
            reason: 'test',
          },
        })
      ).status,
      403,
    );
    const headers = await startSupport(h);
    const me = await (await h.request('/api/platform/me', { headers })).json();
    assert.equal(me.user.id, 'local-reader');
    assert.equal(me.user.platformAdmin, false);
    assert.equal(
      (await h.request('/api/platform/workspace', { headers })).status,
      200,
    );
    for (const path of [
      '/api/platform/settings/admins',
      '/api/platform/companies/company-b/webshops',
      '/api/platform/companies/company-a/members',
    ])
      assert.equal((await h.request(path, { headers })).status, 403);
    assert.equal(
      (await h.request('/api/platform/me', { headers, user: 'local-a' }))
        .status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/me', {
          headers: { ...headers, 'x-platform-actor': 'local-admin:' },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.request('/api/platform/support', {
          headers,
          method: 'POST',
          body: {},
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/webshops', {
          headers,
          method: 'POST',
          body: { name: 'No', domain: 'no.test' },
        })
      ).status,
      403,
    );
    const stop = await h.request('/api/platform/support', {
      headers,
      method: 'DELETE',
      body: {},
    });
    assert.equal(stop.status, 200);
    assert.match(stop.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal(
      (await h.request('/api/platform/me', { headers })).status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies', {
          headers: { 'x-platform-actor': headers['x-platform-actor'] },
          method: 'POST',
          body: { name: 'Stale' },
        })
      ).status,
      409,
    );
    assert.equal((await h.request('/api/platform/me')).status, 200);
  } finally {
    h.close();
  }
});
test('support writes identify original admin; expiry, deactivation and role revocation take effect immediately', async () => {
  const h = harness();
  try {
    const headers = await startSupport(h, 'local-a');
    const result = await h.request(
      '/api/platform/companies/company-a/accounting',
      {
        headers,
        method: 'PUT',
        body: { provider: 'dinero', accountName: 'Support test' },
      },
    );
    assert.equal(result.status, 200, await result.text());
    const audit = h.sql
      .prepare(
        "SELECT actor_id,details_json FROM audit_events WHERE action='accounting.configured'",
      )
      .get();
    assert.equal(audit.actor_id, 'local-admin');
    assert.equal(JSON.parse(audit.details_json).impersonatedUser, 'local-a');
    for (const path of [
      '/api/platform/profile',
      '/api/platform/companies/company-a/users',
    ])
      assert.equal(
        (
          await h.request(path, {
            headers,
            method: 'POST',
            body: { name: 'Changed', email: 'other@example.test' },
          })
        ).status,
        403,
      );
    assert.equal(
      (
        await h.request('/api/platform/onboarding', {
          headers,
          method: 'POST',
          body: {},
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/accounting', {
          headers: { cookie: headers.cookie },
          method: 'PUT',
          body: { provider: 'dinero', accountName: 'No' },
        })
      ).status,
      409,
    );
    h.sql.exec('UPDATE support_sessions SET expires_at=0');
    assert.equal(
      (await h.request('/api/platform/me', { headers })).status,
      403,
    );
    assert.equal((await h.request('/', { headers })).status, 200);
    assert.equal(
      (
        await h.request('/api/platform/support', {
          headers,
          method: 'DELETE',
          body: {},
        })
      ).status,
      200,
    );
    const second = await startSupport(h);
    h.sql.exec("UPDATE users SET status='inactive' WHERE id='local-reader'");
    assert.equal(
      (await h.request('/api/platform/me', { headers: second })).status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/support', {
          headers: second,
          method: 'DELETE',
          body: {},
        })
      ).status,
      200,
    );
    h.sql.exec("UPDATE users SET status='active' WHERE id='local-reader'");
    const third = await startSupport(h);
    h.sql.exec("DELETE FROM platform_admins WHERE user_id='local-admin'");
    assert.equal(
      (await h.request('/api/platform/me', { headers: third })).status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/support', {
          headers: third,
          method: 'DELETE',
          body: {},
        })
      ).status,
      200,
    );
  } finally {
    h.close();
  }
});
test('customer login isolates Tier 0 and tenants, ignores Access on public routes and revokes logout', async () => {
  const h = harness();
  try {
    assert.equal(
      (await customerRequest(h, '/')).headers.get('location'),
      '/login',
    );
    assert.equal(
      (await customerRequest(h, '/api/platform/me', { auth: true })).status,
      401,
    );
    assert.equal(
      (await customerRequest(h, '/admin/api/platform/me', { auth: true }))
        .status,
      200,
    );
    assert.equal(
      (
        await customerRequest(h, '/admin/api/platform/me', {
          auth: true,
          user: 'local-a',
        })
      ).status,
      403,
    );
    const start = await customerStart(h);
    const result = await customerVerify(h, start);
    assert.equal(result.status, 200, await result.clone().text());
    const session = result.headers
      .getSetCookie()
      .find((c) => c.startsWith('__Host-toolbox_session='))
      .split(';')[0];
    assert.match(
      result.headers.get('set-cookie'),
      /HttpOnly; Secure; SameSite=Lax/,
    );
    const me = await customerRequest(h, '/api/platform/me', {
      headers: { cookie: session },
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.platformAdmin, false);
    assert.equal(
      (
        await customerRequest(h, '/api/platform/companies/company-b/webshops', {
          headers: { cookie: session },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await customerRequest(h, '/admin/api/platform/me', {
          headers: { cookie: session },
        })
      ).status,
      401,
    );
    assert.equal((await customerVerify(h, start)).status, 401);
    assert.equal(
      (
        await customerRequest(h, '/logout', {
          method: 'POST',
          headers: { cookie: session, origin: 'http://127.0.0.1:8790' },
        })
      ).status,
      303,
    );
    assert.equal(
      (
        await customerRequest(h, '/api/platform/me', {
          headers: { cookie: session },
        })
      ).status,
      401,
    );
  } finally {
    h.close();
  }
});
test('customer login hides unknown and admin identities, binds browser, expires and locks codes', async () => {
  const h = harness();
  try {
    for (const email of ['missing@example.test', 'admin@example.test']) {
      const s = await customerStart(h, email);
      assert.equal(s.previewCode, undefined);
      assert.equal(
        (await customerVerify(h, { ...s, previewCode: '12345678' })).status,
        401,
      );
    }
    const s = await customerStart(h);
    assert.equal(
      (
        await customerVerify(h, {
          ...s,
          cookie: '__Host-toolbox_challenge=wrong',
        })
      ).status,
      401,
    );
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await customerVerify(h, s, {
            code: s.previewCode === '00000000' ? '11111111' : '00000000',
          })
        ).status,
        401,
      );
    assert.equal((await customerVerify(h, s)).status, 401);
    const expired = await customerStart(h, 'b@example.test');
    h.sql
      .prepare('UPDATE customer_login_challenges SET expires_at=0 WHERE id=?')
      .run(expired.challenge);
    assert.equal((await customerVerify(h, expired)).status, 401);
    assert.equal(
      (
        await customerRequest(h, '/auth/start', {
          method: 'POST',
          csrfOrigin: 'https://attacker.test',
          body: { email: 'a@example.test' },
        })
      ).status,
      403,
    );
  } finally {
    h.close();
  }
});
test('customer login enforces throttling and company deactivation invalidates sessions', async () => {
  const h = harness();
  try {
    const start = await customerStart(h, 'reader@example.test'),
      login = await customerVerify(h, start);
    assert.equal(login.status, 200);
    const session = login.headers.getSetCookie()[0].split(';')[0];
    h.sql.exec("UPDATE companies SET status='inactive' WHERE id='company-a'");
    assert.equal(
      (
        await customerRequest(h, '/api/platform/me', {
          headers: { cookie: session },
        })
      ).status,
      401,
    );
    for (let i = 0; i < 3; i++) await customerStart(h, 'b@example.test');
    assert.equal(
      (
        await customerRequest(h, '/auth/start', {
          method: 'POST',
          body: { email: 'b@example.test' },
        })
      ).status,
      429,
    );
  } finally {
    h.close();
  }
});
test('customer login invitation activates only invited company membership and records name', async () => {
  const h = harness();
  try {
    const invitation = await h.request(
      '/api/platform/companies/company-a/users',
      { method: 'POST', body: { email: 'new@example.test', role: 'member' } },
    );
    assert.equal(invitation.status, 201);
    const data = await invitation.json(),
      token = new URL(data.previewLink).searchParams.get('invitation');
    const s = await customerStart(h, 'new@example.test', { invitation: token });
    assert.ok(s.previewCode);
    assert.equal(
      (await customerVerify(h, s, { name: 'New Customer' })).status,
      200,
    );
    const user = h.sql
      .prepare('SELECT full_name,status,company_id FROM users WHERE id=?')
      .get(data.id);
    assert.equal(user.full_name, 'New Customer');
    assert.equal(user.status, 'active');
    assert.equal(user.company_id, 'company-a');
    assert.equal(
      (await customerVerify(h, s, { name: 'New Customer' })).status,
      401,
    );
  } finally {
    h.close();
  }
});
test('customer login revoked invitation cannot create a session; secret and mail errors fail closed', async () => {
  const h = harness();
  try {
    const invitation = await h.request(
        '/api/platform/companies/company-a/users',
        { method: 'POST', body: { email: 'new@example.test' } },
      ),
      data = await invitation.json();
    const s = await customerStart(h, 'new@example.test', {
      invitation: new URL(data.previewLink).searchParams.get('invitation'),
    });
    h.sql.exec("UPDATE invitations SET state='revoked'");
    assert.equal(
      (await customerVerify(h, s, { name: 'New Customer' })).status,
      401,
    );
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM customer_sessions').get().n,
      0,
    );
    assert.equal(
      (
        await customerRequest(h, '/auth/start', {
          method: 'POST',
          body: { email: 'a@example.test' },
          env: { PLATFORM_LOGIN_SECRET: undefined },
        })
      ).status,
      503,
    );
  } finally {
    h.close();
  }
});
test('customer login mail is known-recipient only, no remote preview and no uncertain resend', async () => {
  const h = harness();
  try {
    h.sql.exec("UPDATE users SET email='rj@itm8.com' WHERE id='local-a'");
    let sends = 0;
    const env = {
      ...customerEnv,
      PLATFORM_ENV: 'remote-test',
      PLATFORM_AUTH: 'cloudflare-access',
      PLATFORM_AUTH_MAIL: {
        send: async (m) => {
          sends++;
          assert.equal(m.to, 'rj@itm8.com');
          assert.equal(m.from.email, 'no-reply@webshoptoolbox.dk');
          assert.match(m.text, /\d{8}/);
          throw Error('timeout');
        },
      },
    };
    for (const email of [
      'rj@itm8.com',
      'b@example.test',
      'unknown@example.test',
    ]) {
      const response = await customerRequest(h, '/auth/start', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '192.0.2.1' },
        body: { email },
        env,
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).previewCode, undefined);
    }
    assert.equal(sends, 1);
    assert.equal(
      h.sql
        .prepare(
          "SELECT count(*) n FROM customer_login_challenges WHERE delivery='uncertain'",
        )
        .get().n,
      1,
    );
    assert.equal(
      h.sql
        .prepare(
          'SELECT length(code_hash) n FROM customer_login_challenges LIMIT 1',
        )
        .get().n,
      64,
    );
  } finally {
    h.close();
  }
});
test('customer login absolute and idle expiry, user deactivation, browser and environment boundaries', async () => {
  const h = harness();
  try {
    const s = await customerStart(h, 'reader@example.test');
    assert.equal(
      (
        await customerRequest(h, '/auth/verify', {
          method: 'POST',
          headers: { cookie: s.cookie, 'cf-connecting-ip': '192.0.2.1' },
          body: { challenge: s.challenge, code: s.previewCode },
          env: {
            PLATFORM_ENV: 'remote-test',
            PLATFORM_AUTH: 'cloudflare-access',
          },
        })
      ).status,
      401,
    );
    const response = await customerVerify(h, s);
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    h.sql.exec('UPDATE customer_sessions SET last_seen=0');
    assert.equal(
      (await customerRequest(h, '/api/platform/me', { headers: { cookie } }))
        .status,
      401,
    );
    h.sql.exec(
      'UPDATE customer_sessions SET last_seen=9999999999,expires_at=0',
    );
    assert.equal(
      (await customerRequest(h, '/api/platform/me', { headers: { cookie } }))
        .status,
      401,
    );
    h.sql.exec("UPDATE users SET status='inactive' WHERE id='local-reader'");
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM customer_sessions').get().n,
      0,
    );
    assert.equal(
      (
        await customerRequest(h, '/auth/start', {
          origin: 'https://public.test',
          method: 'POST',
          body: { email: 'a@example.test' },
        })
      ).status,
      503,
    );
  } finally {
    h.close();
  }
});
test('customer login configuration keeps dev mail restricted and production transactional mail separate', () => {
  const config = JSON.parse(read('wrangler.platform-test.json'));
  assert.doesNotThrow(() => validateConfig(config, true));
  delete config.send_email[2].allowed_destination_addresses;
  assert.throws(() => validateConfig(config, true));
});

test('customer login incomplete profile still boots customer UI and cannot use support actions', async () => {
  const h = harness();
  try {
    h.sql.exec("UPDATE users SET full_name=NULL WHERE id='local-reader'");
    const s = await customerStart(h, 'reader@example.test'),
      response = await customerVerify(h, s);
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    assert.equal(
      (
        await customerRequest(h, '/api/platform/support', {
          headers: { cookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (await customerRequest(h, '/api/platform/me', { headers: { cookie } }))
        .status,
      200,
    );
    assert.equal(
      (
        await customerRequest(h, '/api/platform/support', {
          method: 'POST',
          headers: { cookie },
          body: {},
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await customerRequest(h, '/api/platform/profile', {
          method: 'POST',
          headers: { cookie },
          body: { name: 'Customer Name' },
        })
      ).status,
      200,
    );
  } finally {
    h.close();
  }
});
test('admin hostname keeps authentication, redirects old GET routes and rejects customer flows', async () => {
  const h = harness();
  try {
    const env = {
      ...customerEnv,
      PLATFORM_ENV: 'remote-test',
      PLATFORM_AUTH: 'cloudflare-access',
      PLATFORM_ADMIN_HOST: 'admin.webshoptoolbox.dk',
      PLATFORM_ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
      PLATFORM_ACCESS_AUD: 'ab'.repeat(32),
    };
    const request = (path, options = {}) =>
      h.request(path, {
        auth: false,
        origin: 'https://admin.webshoptoolbox.dk',
        env,
        ...options,
      });
    assert.equal((await request('/')).headers.get('location'), '/admin/');
    assert.equal((await request('/admin/api/platform/me')).status, 401);
    assert.equal(
      (
        await request('/auth/start', {
          method: 'POST',
          body: { email: 'a@example.test' },
        })
      ).status,
      404,
    );
    const old = await request('/admin/onboarding?invitation=test', {
      origin: 'https://dev.webshoptoolbox.dk',
    });
    assert.equal(old.status, 303);
    assert.equal(
      old.headers.get('location'),
      'https://admin.webshoptoolbox.dk/admin/onboarding?invitation=test',
    );
    assert.equal(
      (
        await request('/admin/api/platform/companies', {
          origin: 'https://dev.webshoptoolbox.dk',
          method: 'POST',
          body: {},
        })
      ).status,
      403,
    );
    for (const path of ['/', '/admin/api/platform/me', '/robots.txt', '/login'])
      assert.match(
        (await request(path)).headers.get('x-robots-tag'),
        /noindex/,
      );
  } finally {
    h.close();
  }
});
test('portal pages exclude search indexing and customer login has no Tier 0 link', async () => {
  const h = harness();
  try {
    for (const file of ['login.html', 'index.html', 'onboarding.html'])
      assert.match(
        read('platform/public/' + file),
        /name="robots" content="noindex, nofollow, noarchive"/,
      );
    assert.doesNotMatch(read('platform/public/login.html'), /href="\/admin/);
    const response = await h.request('/robots.txt', { auth: false });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    const config = JSON.parse(read('wrangler.platform-test.json'));
    config.vars.PLATFORM_ADMIN_HOST = 'admin.webshoptoolbox.dk';
    config.routes.push({
      pattern: 'admin.webshoptoolbox.dk',
      custom_domain: true,
    });
    assert.doesNotThrow(() => validateConfig(config, true));
    config.vars.PLATFORM_ADMIN_HOST = 'other.example';
    assert.throws(() => validateConfig(config, true));
  } finally {
    h.close();
  }
});

test('support tickets isolate companies and preserve replies with optimistic concurrency', async () => {
  const h = harness();
  try {
    const base = '/api/platform/companies/company-a/tickets';
    const created = await h.request(base, {
      user: 'local-a',
      method: 'POST',
      body: { subject: 'Test af faktura', message: 'Kan I hjælpe med PDF?' },
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal(
      (await h.request('/api/platform/tickets', { user: 'local-a' })).status,
      403,
    );
    assert.equal(
      (await h.request(base + '/' + id, { user: 'local-b' })).status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-b/tickets/' + id, {
          user: 'local-b',
        })
      ).status,
      404,
    );
    const queue = await (await h.request('/api/platform/tickets')).json();
    assert.equal(queue.tickets.length, 1);
    const reply = await h.request('/api/platform/tickets/' + id, {
      method: 'PATCH',
      body: { version: 1, message: 'Vi undersøger det.' },
    });
    assert.equal(reply.status, 200);
    const detail = await (
      await h.request(base + '/' + id, { user: 'local-reader' })
    ).json();
    assert.equal(detail.ticket.status, 'waiting_customer');
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[1].author_kind, 'support');
    assert.equal(
      (
        await h.request(base + '/' + id, {
          user: 'local-a',
          method: 'PATCH',
          body: { version: 1, message: 'Forældet svar' },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.request(base + '/' + id, {
          user: 'local-a',
          method: 'PATCH',
          body: { version: 2, priority: 'high' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request(base + '/' + id, {
          user: 'local-a',
          method: 'PATCH',
          body: { version: 2, message: 'Tak for hjælpen' },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request(base + '/' + id, {
          user: 'local-a',
          method: 'PATCH',
          body: { version: 3, status: 'resolved' },
        })
      ).status,
      200,
    );
    const resolved = await (
      await h.request(base + '/' + id, { user: 'local-a' })
    ).json();
    assert.equal(resolved.ticket.status, 'resolved');
    assert.equal(resolved.messages.length, 3);
    assert.equal(
      (
        await h.request(base, {
          user: 'local-a',
          method: 'POST',
          csrfOrigin: 'https://other.example',
          body: { subject: 'x', message: 'y' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request(base, {
          user: 'local-a',
          method: 'POST',
          body: { subject: 'x', message: 'y'.repeat(6001) },
        })
      ).status,
      400,
    );
  } finally {
    h.close();
  }
});

test('Tier 0 can view webshops and invite users but only a Tier 1 company admin can maintain shops', async () => {
  const h = harness();
  try {
    const base = '/api/platform/companies/company-a/webshops';
    assert.equal((await h.request(base)).status, 200);
    for (const [path, method, body] of [
      [base, 'POST', { name: 'Forbidden', domain: 'forbidden.example.test' }],
      [
        base + '/shop-a1',
        'PATCH',
        {
          name: 'Forbidden',
          domain: 'forbidden.example.test',
          status: 'active',
        },
      ],
      [
        base + '/shop-a1/connection',
        'PUT',
        {
          provider: 'shopify',
          shopDomain: 'test.myshopify.com',
          clientId: 'id',
          clientSecret: 'secret',
        },
      ],
    ])
      assert.equal((await h.request(path, { method, body })).status, 403);
    assert.equal(
      h.sql
        .prepare("SELECT count(*) n FROM webshops WHERE company_id='company-a'")
        .get().n,
      2,
    );
    const response = await h.request(base, {
      user: 'local-a',
      method: 'POST',
      body: { name: 'Customer shop', domain: 'customer-shop.example.test' },
    });
    assert.equal(response.status, 201, await response.clone().text());
    const { id } = await response.json();
    assert.equal(
      (
        await h.request(base + '/' + id, {
          user: 'local-a',
          method: 'PATCH',
          body: {
            name: 'Customer changed',
            domain: 'customer-shop.example.test',
            status: 'active',
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request('/api/platform/companies/company-a/users', {
          method: 'POST',
          body: { email: 'new-invitation@example.test' },
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await h.request(base, {
          user: 'local-b',
          method: 'POST',
          body: { name: 'Forbidden', domain: 'foreign.example.test' },
        })
      ).status,
      403,
    );
  } finally {
    h.close();
  }
});

test('Tier 1 derives company access in dev and production', async () => {
  const h = harness();
  try {
    const route = '/api/platform/tier1/shops/shop-a1/dinero/accounts';
    assert.equal((await h.request(route, { auth: false })).status, 401);
    assert.equal((await h.request(route)).status, 403);
    assert.equal((await h.request(route, { user: 'local-a' })).status, 200);
    assert.equal((await h.request(route, { user: 'local-b' })).status, 404);
    assert.equal(
      (
        await h.request('/api/platform/tier1/shops/shop-a2/dinero/accounts', {
          user: 'local-reader',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/platform/tier1/shops/none/dinero/accounts', {
          user: 'local-reader',
        })
      ).status,
      403,
    );
    const unseen = await h.request(
      '/api/platform/tier1/shops/shop-a1/invoices',
      { user: 'local-a' },
    );
    assert.equal(unseen.status, 200);
    assert.deepEqual((await unseen.json()).statuses, {});
    assert.equal(
      (
        await h.request('/api/platform/tier1/shops/shop-a1/integrations', {
          user: 'local-a',
          method: 'POST',
          body: { provider: 'shopify' },
        })
      ).status,
      400,
    );
    // Production uses the same tenant authorization.
    const remote = { ...h.env, PLATFORM_ENV: 'production' };
    const { handleTier1 } = loader({ jose, 'pdf-lib': pdfLib })(
      'platform/tier1-api.ts',
    );
    assert.equal(
      (
        await handleTier1(
          new Request('https://portal.webshoptoolbox.dk' + route),
          remote,
          { id: 'local-a', platformAdmin: false },
        )
      ).status,
      200,
    );
    await assert.rejects(
      () =>
        handleTier1(
          new Request('https://portal.webshoptoolbox.dk' + route),
          remote,
          { id: 'local-b', platformAdmin: false },
        ),
      (e) => e.status === 404,
    );
    assert.equal(
      (
        await handleTier1(
          new Request('https://dev.webshoptoolbox.dk' + route),
          { ...h.env, PLATFORM_ENV: 'remote-test' },
          { id: 'local-a', platformAdmin: false },
        )
      ).status,
      200,
    );
    const preview = await h.request('/tier1-next/', { user: 'local-a' });
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('x-robots-tag'), /noindex/);
    assert.match(
      preview.headers.get('content-security-policy'),
      /script-src 'self';/,
    );
    assert.equal((await h.request('/tier1-next/')).status, 403);
  } finally {
    h.close();
  }
});

test('original Tier 1 settings preserve shared invoice template, scope automation and reject stale edits across shops', async () => {
  const h = harness();
  const path = '/api/platform/tier1/shops/shop-a1/admin/settings';
  try {
    const before = await (await h.request(path, { user: 'local-a' })).json();
    const second = await (
      await h.request(path.replace('shop-a1', 'shop-a2'), { user: 'local-a' })
    ).json();
    const settings = structuredClone(before.settings);
    settings.invoiceEmail.subject = 'Faktura {{fakturanummer}}';
    settings.invoiceEmail.body = 'Tak for din ordre ' + 'x'.repeat(3900);
    settings.automation.sales = true;
    settings.syncIntervalMinutes = 10;
    const saved = await h.request(path, {
      user: 'local-a',
      method: 'POST',
      body: { settings, revision: before.revision },
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.match((await saved.json()).message, /blokeret/);
    const invoice = h.sql
      .prepare(
        "SELECT subject,body FROM invoice_settings WHERE company_id='company-a'",
      )
      .get();
    assert.equal(invoice.subject, settings.invoiceEmail.subject);
    assert.equal(invoice.body, settings.invoiceEmail.body);
    assert.equal(
      (
        await h.request(path, {
          user: 'local-a',
          method: 'POST',
          body: { settings, revision: before.revision },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await h.request(path.replace('shop-a1', 'shop-a2'), {
          user: 'local-a',
          method: 'POST',
          body: { settings: second.settings, revision: second.revision },
        })
      ).status,
      409,
    );
    const otherShop = await (
      await h.request(path.replace('shop-a1', 'shop-a2'), { user: 'local-a' })
    ).json();
    assert.equal(otherShop.settings.automation.sales, false);
    assert.equal(
      otherShop.settings.invoiceEmail.subject,
      settings.invoiceEmail.subject,
    );
    const otherCompany = await (
      await h.request(path.replace('shop-a1', 'shop-b1'), { user: 'local-b' })
    ).json();
    assert.notEqual(
      otherCompany.settings.invoiceEmail.subject,
      settings.invoiceEmail.subject,
    );
    assert.equal((await h.request(path, { user: 'local-reader' })).status, 403);
    const latest = await (await h.request(path, { user: 'local-a' })).json();
    const originalBatch = h.db.batch;
    h.db.batch = async (statements) => {
      h.sql
        .prepare(
          "UPDATE invoice_settings SET subject='Concurrent edit' WHERE company_id='company-a'",
        )
        .run();
      return originalBatch(statements);
    };
    assert.equal(
      (await h.request(path, { user: 'local-a', method: 'POST', body: latest }))
        .status,
      409,
    );
    assert.equal(
      h.sql
        .prepare(
          "SELECT subject FROM invoice_settings WHERE company_id='company-a'",
        )
        .get().subject,
      'Concurrent edit',
    );
  } finally {
    h.close();
  }
});

test('each webshop keeps its own mellemregningskonti; other accounts stay shared', async () => {
  const h = harness();
  const path = (shop) => `/api/platform/tier1/shops/${shop}/admin/settings`,
    save = async (shop, change) => {
      const current = await (
        await h.request(path(shop), { user: 'local-a' })
      ).json();
      Object.assign(current.settings.accounts, change);
      const r = await h.request(path(shop), {
        user: 'local-a',
        method: 'POST',
        body: current,
      });
      assert.equal(r.status, 200, await r.clone().text());
    },
    read = async (shop) =>
      (await (await h.request(path(shop), { user: 'local-a' })).json()).settings
        .accounts;
  try {
    const companyBefore = () =>
      JSON.parse(
        h.sql
          .prepare(
            "SELECT accounts_json FROM accounting_mapping WHERE company_id='company-a'",
          )
          .get()?.accounts_json || '{}',
      ).flatpayClearing || '';
    const defaultBefore = companyBefore();
    await save('shop-a1', { flatpayClearing: '58010', fees: '7220' });
    await save('shop-a2', { flatpayClearing: '58020', clearing: '58900' });
    const first = await read('shop-a1'),
      second = await read('shop-a2');
    assert.equal(first.flatpayClearing, '58010');
    assert.equal(second.flatpayClearing, '58020');
    assert.equal(second.clearing, '58900');
    assert.notEqual(first.clearing, '58900');
    // Shared accounts follow the latest save for every webshop.
    assert.equal(first.fees, second.fees);
    // The company default (for webshops without their own) is not taken over by a webshop's save.
    assert.equal(companyBefore(), defaultBefore);
    const { accountsForWebshop } = loader()(
      'platform/tier1/src/lib/admin-settings.ts',
    );
    assert.deepEqual(
      accountsForWebshop(
        JSON.stringify({ fees: '1', flatpayClearing: '2' }),
        JSON.stringify({
          accounts: { flatpayClearing: '3', fees: '9', clearing: '' },
        }),
      ),
      { fees: '1', flatpayClearing: '3' },
    );
  } finally {
    h.close();
  }
});

test('dev and production serve rebuilt Tier 1 while Tier 0 retains admin assets', async () => {
  const h = harness();
  try {
    const login = await customerVerify(h, await customerStart(h));
    const cookie = login.headers
      .getSetCookie()
      .find((c) => c.startsWith('__Host-toolbox_session='))
      .split(';')[0];
    const assets = {
      fetch: async (request) => new Response(new URL(request.url).pathname),
    };
    const env = {
      PLATFORM_ENV: 'remote-test',
      PLATFORM_AUTH: 'cloudflare-access',
      ASSETS: assets,
    };
    const options = {
      origin: 'https://dev.webshoptoolbox.dk',
      headers: { cookie },
      env,
    };
    const root = await customerRequest(h, '/', options);
    assert.equal(root.status, 200);
    assert.equal(await root.text(), '/tier1-next/index.html');
    const script = await customerRequest(
      h,
      '/tier1-next/assets/index-test.js',
      options,
    );
    assert.equal(script.status, 200);
    // Built files with a content hash may stay in the browser; the page itself and unhashed files never.
    assert.equal(script.headers.get('cache-control'), 'no-store');
    assert.equal(
      (
        await customerRequest(
          h,
          '/tier1-next/assets/react-D0Ec-185.js',
          options,
        )
      ).headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    );
    assert.equal(
      (await customerRequest(h, '/', options)).headers.get('cache-control'),
      'no-store',
    );
    assert.equal(
      (
        await customerRequest(h, '/tier1-next/assets/react-D0Ec-185.js', {
          ...options,
          headers: {},
        })
      ).headers.get('cache-control'),
      'no-store',
      'not signed in: no file, nothing cached',
    );
    const production = {
      ...options,
      env: {
        ...env,
        PLATFORM_ENV: 'production',
        PLATFORM_ACCESS_AUD: 'a'.repeat(64),
      },
    };
    assert.equal(
      await (await customerRequest(h, '/', production)).text(),
      '/tier1-next/index.html',
    );
    assert.equal(
      (await customerRequest(h, '/tier1-next/', production)).status,
      200,
    );
    assert.equal(
      (
        await customerRequest(
          h,
          '/api/platform/tier1/shops/shop-a1/admin/settings',
          production,
        )
      ).status,
      200,
    );
    const admin = await customerRequest(h, '/admin/', {
      auth: true,
      env: { ASSETS: assets },
    });
    assert.equal(admin.status, 200);
    assert.equal(await admin.text(), '/');
  } finally {
    h.close();
  }
});

test('production runtime exposes capabilities only after authentication and retains DEV write denial', async () => {
  const h = harness();
  try {
    const base = '/api/platform/tier1/shops/shop-a1';
    assert.equal(
      (await h.request(base + '/runtime', { auth: false })).status,
      401,
    );
    assert.equal(
      (await h.request(base + '/runtime', { user: 'local-b' })).status,
      404,
    );
    const dev = await (
      await h.request(base + '/runtime', { user: 'local-a' })
    ).json();
    assert.equal(dev.bookkeeping, false);
    assert.equal(dev.customerEmail, false);
    for (const path of ['/bookkeeping/manual', '/invoices/email'])
      assert.equal(
        (
          await h.request(base + path, {
            user: 'local-a',
            method: 'POST',
            body: {},
          })
        ).status,
        403,
      );
  } finally {
    h.close();
  }
});

test('job insights are exclusive to Tier 0 and intervals below 15 normalize on read', async () => {
  const h = harness();
  try {
    h.sql
      .prepare(
        "INSERT INTO operation_runs(id,company_id,webshop_id,module,status) VALUES('private-job','company-a','shop-a1','orders','success')",
      )
      .run();
    for (const user of ['local-a', 'local-reader', 'local-b'])
      for (const path of [
        '/api/platform/tier1/shops/shop-a1/admin/insights',
        '/api/platform/companies/company-a/webshops/shop-a1/data/insights',
        '/api/platform/companies/company-a/webshops/shop-a1/insights',
      ])
        assert.ok(
          [403, 404].includes((await h.request(path, { user })).status),
          user + ' ' + path,
        );
    const result = await h.request(
      '/api/platform/companies/company-a/webshops/shop-a1/insights',
    );
    assert.equal(result.status, 200);
    assert.equal((await result.json()).runs[0].id, 'private-job');
    assert.equal(
      (
        await h.request(
          '/api/platform/companies/company-b/webshops/shop-a1/insights',
        )
      ).status,
      404,
    );
    h.sql
      .prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)')
      .run(
        'company-a',
        'shop-a1',
        JSON.stringify({ syncIntervalMinutes: 7 }),
        'old',
      );
    const status = await (
      await h.request('/api/platform/tier1/shops/shop-a1/admin/sync-status', {
        user: 'local-a',
      })
    ).json();
    assert.equal(status.intervalMinutes, 15);
    // A saved 5-minute interval is shown as saved, so the settings page does not report an unsaved change.
    h.sql
      .prepare(
        "UPDATE tier1_preferences SET preferences_json=? WHERE company_id='company-a' AND webshop_id='shop-a1'",
      )
      .run(JSON.stringify({ syncIntervalMinutes: 5 }));
    assert.equal(
      (
        await (
          await h.request(
            '/api/platform/tier1/shops/shop-a1/admin/sync-status',
            { user: 'local-a' },
          )
        ).json()
      ).intervalMinutes,
      5,
    );
  } finally {
    h.close();
  }
});

test('user-facing platform messages use æ, ø and å rather than transliterations', () => {
  // Long, distinctive stems are found inside compound words too (e.g. "refunderingsbeloeb"); short words only whole.
  const words =
    /(gennemfoer|fortsaet|koersel|joblaas|udloeb|bogfoer|overfoersel|tilgaengelig|testmiljoe|tilhoer|praecis|beloeb|ufuldstaendig|aendre|vaelg|\b(?:naeste|vaere|foerst|paa|laas\w*)\b)/i;
  const found = [];
  for (const file of readdirSync('platform').filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync('platform/' + file, 'utf8');
    for (const literal of source.match(
      /'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
    ) || []) {
      const hit = literal.match(words);
      if (hit) found.push(file + ': ' + hit[0]);
    }
  }
  assert.deepEqual(found, []);
});

test('support opens the real Tier 1 portal as the customer user and can only look', async () => {
  const h = harness();
  try {
    const headers = await startSupport(h, 'local-a');
    const read = await h.request('/api/platform/tier1/shops/shop-a1/invoices', {
      headers,
    });
    assert.equal(read.status, 200, await read.clone().text());
    assert.equal(
      (
        await h.request('/api/platform/tier1/shops/shop-a1/admin/settings', {
          headers,
        })
      ).status,
      200,
    );
    const write = await h.request(
      '/api/platform/tier1/shops/shop-a1/admin/settings',
      { headers, method: 'POST', body: {} },
    );
    assert.equal(write.status, 403);
    assert.match((await write.json()).error, /kun se/);
    assert.equal(
      (await h.request('/api/platform/tier1/shops/shop-a1/invoices')).status,
      403,
    );
    // Under /admin/ the portal page is only served while a support session is active.
    const assets = {
      fetch: async (request) =>
        new Response(
          '<script src="/tier1-next/assets/index.js"></script>' +
            new URL(request.url).pathname,
          { headers: { 'content-type': 'text/html' } },
        ),
    };
    const admin = { auth: true, env: { ASSETS: assets } };
    const idle = await customerRequest(h, '/admin/kundeportal/', admin);
    assert.equal(idle.status, 303);
    assert.equal(idle.headers.get('location'), '/admin/');
    const started = await customerRequest(h, '/admin/api/platform/support', {
      ...admin,
      method: 'POST',
      body: {
        companyId: 'company-a',
        userId: 'local-a',
        reason: 'Hjælp kunden',
      },
    });
    assert.equal(started.status, 201, await started.clone().text());
    const cookie = started.headers.get('set-cookie').split(';')[0];
    const page = await customerRequest(h, '/admin/kundeportal/', {
      ...admin,
      headers: { cookie },
    });
    assert.equal(page.status, 200);
    assert.equal(
      await page.text(),
      '<script src="/admin/tier1-next/assets/index.js"></script>/tier1-next/index.html',
    );
    assert.match(
      page.headers.get('content-security-policy'),
      /script-src 'self';/,
    );
    assert.equal(
      (
        await customerRequest(
          h,
          '/admin/tier1-next/assets/index-test.js',
          admin,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await customerRequest(h, '/admin/kundeportal/', {
          ...admin,
          user: 'local-a',
          headers: { cookie },
        })
      ).status,
      403,
    );
  } finally {
    h.close();
  }
});

test('"Stol på denne enhed" keeps a session for 30 days and 7 idle days; other sessions keep 30 idle minutes', async () => {
  const h = harness();
  try {
    const session = async (trustDevice) => {
      h.sql.exec('DELETE FROM customer_login_limits');
      const login = await customerVerify(
        h,
        await customerStart(h),
        trustDevice === undefined ? {} : { trustDevice },
      );
      assert.equal(login.status, 200, await login.clone().text());
      const set = login.headers
        .getSetCookie()
        .find((c) => c.startsWith('__Host-toolbox_session='));
      const cookie = set.split(';')[0],
        token = cookie.split('=')[1];
      return {
        cookie,
        maxAge: Number(set.match(/Max-Age=(\d+)/)[1]),
        hash: (await import('node:crypto'))
          .createHash('sha256')
          .update(token)
          .digest('hex'),
      };
    };
    const now = Math.floor(Date.now() / 1000);
    const normal = await session();
    assert.equal(normal.maxAge, 21600);
    h.sql
      .prepare('UPDATE customer_sessions SET last_seen=? WHERE token_hash=?')
      .run(now - 1801, normal.hash);
    assert.equal(
      (
        await customerRequest(h, '/api/platform/me', {
          headers: { cookie: normal.cookie },
        })
      ).status,
      401,
    );
    for (const notTrusted of ['true', 1])
      assert.equal((await session(notTrusted)).maxAge, 21600);
    const trusted = await session(true);
    assert.equal(trusted.maxAge, 2592000);
    const row = h.sql
      .prepare(
        'SELECT expires_at-created_at AS life,idle_seconds FROM customer_sessions WHERE token_hash=?',
      )
      .get(trusted.hash);
    assert.deepEqual({ ...row }, { life: 2592000, idle_seconds: 604800 });
    h.sql
      .prepare('UPDATE customer_sessions SET last_seen=? WHERE token_hash=?')
      .run(now - 6 * 86400, trusted.hash);
    assert.equal(
      (
        await customerRequest(h, '/api/platform/me', {
          headers: { cookie: trusted.cookie },
        })
      ).status,
      200,
    );
    h.sql
      .prepare('UPDATE customer_sessions SET last_seen=? WHERE token_hash=?')
      .run(now - 7 * 86400 - 1, trusted.hash);
    assert.equal(
      (
        await customerRequest(h, '/api/platform/me', {
          headers: { cookie: trusted.cookie },
        })
      ).status,
      401,
    );
    assert.throws(() =>
      h.sql.prepare('UPDATE customer_sessions SET idle_seconds=99999999').run(),
    );
  } finally {
    h.close();
  }
});

test('the demo account is rebuilt nightly, logs in with its fixed code and never reaches a provider or other companies', async () => {
  const h = harness(jose, async (url) => {
    throw Error('Demo must not call ' + url);
  });
  try {
    const objects = new Map();
    const bucket = {
      put: async (k, v) => objects.set(k, v),
      get: async (k) =>
        objects.has(k)
          ? { body: objects.get(k), arrayBuffer: async () => objects.get(k) }
          : null,
      list: async ({ prefix }) => ({
        objects: [...objects.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((key) => ({ key })),
      }),
      delete: async (keys) => {
        for (const k of [].concat(keys)) objects.delete(k);
      },
    };
    const env = { ...h.env, PLATFORM_DOCUMENTS: bucket },
      demo = {
        ...loader({ jose, 'pdf-lib': pdfLib })('platform/demo-reset.ts'),
        ...loader({ jose })('platform/demo.ts'),
      };
    const others = () =>
      h.sql
        .prepare(
          "SELECT (SELECT count(*) FROM operation_snapshots WHERE company_id!='demo-company')+(SELECT count(*) FROM companies WHERE id!='demo-company')+(SELECT count(*) FROM users WHERE id!='demo-user') n",
        )
        .get().n;
    const before = others();
    const first = await demo.resetDemoIfDue(
      env,
      new Date('2026-09-30T08:00:00Z'),
    );
    assert.equal(first.orders, 50);
    assert.ok(first.payouts >= 8 && first.payouts <= 10, String(first.payouts));
    const count = (sql) => h.sql.prepare(sql).get().n;
    assert.equal(
      count(
        "SELECT count(*) n FROM operation_snapshots WHERE company_id='demo-company' AND module='orders'",
      ),
      50,
    );
    assert.ok(
      count(
        "SELECT count(*) n FROM platform_invoices WHERE company_id='demo-company'",
      ) >= 35,
    );
    assert.ok(
      count(
        "SELECT count(*) n FROM platform_payout_documents WHERE company_id='demo-company'",
      ) >= 7,
    );
    assert.equal(
      count(
        "SELECT count(*) n FROM companies WHERE id='demo-company' AND demo=1 AND name='Demofirma A/S'",
      ),
      1,
    );
    assert.equal(
      count(
        "SELECT count(*) n FROM users WHERE id='demo-user' AND email='demo@webshoptoolbox.dk' AND full_name='Peter Andersen'",
      ),
      1,
    );
    assert.ok(
      [...objects.keys()].every((k) => k.startsWith('companies/demo-company/')),
    );
    assert.equal(others(), before, 'other companies are untouched');
    // Once a day, after 03:00 Danish time.
    assert.equal(
      await demo.resetDemoIfDue(env, new Date('2026-09-30T20:00:00Z')),
      null,
    );
    assert.equal(
      await demo.resetDemoIfDue(env, new Date('2026-10-01T00:30:00Z')),
      null,
      '02:30 Danish time is too early',
    );
    // Every table with company data is cleared by the reset, except the kept company, user and webshop rows.
    const kept = [
      'companies',
      'webshops',
      'users',
      'company_memberships',
      'webshop_memberships',
      'support_sessions',
      'public_signups',
      'finance_state',
    ];
    for (const { name } of h.sql
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()) {
      const columns = h.sql
        .prepare(`PRAGMA table_info(${name})`)
        .all()
        .map((c) => c.name);
      if (columns.includes('company_id') && !kept.includes(name))
        assert.ok(
          demo.demoTables.includes(name),
          name + ' is not cleared by the demo reset',
        );
    }
    // Login: fixed code, no mail and no preview, and the mail limit does not lock the shared account.
    const login = async () => {
      const s = await customerStart(h, 'demo@webshoptoolbox.dk');
      assert.equal(s.previewCode, undefined);
      return customerVerify(h, { ...s, previewCode: '10203040' });
    };
    let session;
    for (let i = 0; i < 5; i++) {
      h.sql.exec("DELETE FROM customer_login_limits WHERE key LIKE 'ip:%'");
      const r = await login();
      assert.equal(r.status, 200, await r.clone().text());
      session = r.headers
        .getSetCookie()
        .find((c) => c.startsWith('__Host-toolbox_session='))
        .split(';')[0];
    }
    const wrong = await customerStart(h, 'demo@webshoptoolbox.dk');
    assert.equal(
      (await customerVerify(h, { ...wrong, previewCode: '12345678' })).status,
      401,
    );
    assert.match(
      (await customerStart(h)).previewCode,
      /^\d{8}$/,
      'other customers keep their own random code',
    );
    const call = (path, options = {}) =>
      customerRequest(h, '/api/platform/tier1/shops/demo-shop' + path, {
        ...options,
        env: { PLATFORM_DOCUMENTS: bucket, ...options.env },
        headers: { cookie: session, ...options.headers },
      });
    // Reads come from the demo rows or fixtures; nothing calls Shopify or Dinero (the network throws).
    const orders = await (await call('/shopify/orders?limit=25')).json();
    assert.equal(orders.total, 50);
    assert.equal((await (await call('/runtime')).json()).demo, true);
    assert.equal((await (await call('/dashboard/finance')).json()).ready, true);
    const year = Number(new Date().toISOString().slice(0, 4));
    for (const kind of ['finance', 'shop'])
      assert.equal(
        (await call(`/performance/${kind}?year=${year}`)).status,
        200,
        kind,
      );
    const shipments = await (await call('/shipments?days=60')).json();
    assert.ok(shipments.shipments.length >= 10);
    assert.ok(shipments.shipments.some((s) => s.current === 'ready'));
    assert.ok(
      (await (await call('/shopify/inventory')).json()).rows.length >= 10,
    );
    assert.equal(
      (await (await call('/feeds/catalog?kind=collections&q=')).json()).items
        .length,
      3,
    );
    const feeds = (await (await call('/feeds')).json()).feeds;
    assert.equal(feeds.length, 1);
    assert.match(feeds[0].url, /\/feeds\/demofirma-shop\/partnerads\.xml$/);
    assert.equal(
      (
        await call('/feeds/' + feeds[0].id + '/refresh', {
          method: 'POST',
          body: { revision: feeds[0].revision },
        })
      ).status,
      200,
    );
    assert.match(
      await (await call('/feeds/' + feeds[0].id + '/preview')).text(),
      /<produktnavn>Uldplaid Klitrose<\/produktnavn>/,
    );
    // Actions that would reach a provider or a customer are simulated or refused.
    assert.equal(
      (
        await (
          await call('/shopify/orders', { method: 'POST', body: {} })
        ).json()
      ).synced,
      0,
    );
    assert.equal(
      (
        await (
          await call('/shopify/orders/process', { method: 'POST', body: {} })
        ).json()
      ).status,
      'completed',
    );
    for (const [path, body] of [
      ['/invoices', { action: 'send', externalId: 'x' }],
      ['/bookkeeping/manual', { kind: 'sale' }],
      ['/dinero/accounts', {}],
      ['/integrations', { provider: 'dinero' }],
      ['/emballage/shopify-fields', {}],
    ]) {
      const r = await call(path, { method: 'POST', body });
      assert.equal(r.status, 409, path);
      assert.match((await r.json()).error, /Demokonto/);
    }
    // Settings may be changed and are restored by the next reset.
    const settings = await (await call('/admin/settings')).json();
    assert.equal(
      (
        await call('/admin/settings', {
          method: 'POST',
          body: {
            settings: { ...settings.settings, syncIntervalMinutes: 60 },
            revision: settings.revision,
          },
        })
      ).status,
      200,
    );
    // Outside Tier 1 the demo user changes nothing, and Tier 0 cannot edit or delete the demo company.
    assert.equal(
      (
        await customerRequest(h, '/api/platform/profile', {
          method: 'POST',
          headers: { cookie: session },
          body: { name: 'Hacker' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await customerRequest(
          h,
          '/api/platform/companies/demo-company/tickets',
          {
            method: 'POST',
            headers: { cookie: session },
            body: { subject: 'x', message: 'y' },
          },
        )
      ).status,
      403,
    );
    for (const [method, path] of [
      ['PATCH', '/admin/api/platform/companies/demo-company'],
      ['POST', '/admin/api/platform/companies/demo-company/users'],
      ['PATCH', '/admin/api/platform/companies/demo-company/users/demo-user'],
    ])
      assert.equal(
        (
          await customerRequest(h, path, {
            auth: true,
            method,
            body: { status: 'inactive' },
          })
        ).status,
        403,
        path,
      );
    // The scheduler never imports, books or mails the demo shop.
    const jobs = loader({
      jose,
      'pdf-lib': pdfLib,
      './operations': {
        handleOperations: async (req, env, actor, company) => {
          assert.notEqual(company, 'demo-company');
          return Response.json({ hasNextPage: false, endCursor: null });
        },
      },
    })('platform/production-jobs.ts');
    await jobs.runProductionJobs({
      ...env,
      PLATFORM_ENV: 'production',
      PLATFORM_EXTERNAL_WRITES: 'enabled',
    });
    assert.equal(
      count(
        "SELECT count(*) n FROM production_jobs WHERE company_id='demo-company'",
      ),
      0,
    );
    // The nightly reset restores everything the visitors changed.
    h.sql.exec("DELETE FROM product_feeds WHERE company_id='demo-company'");
    await demo.resetDemoIfDue(env, new Date('2026-10-01T03:30:00Z'));
    assert.equal(
      count(
        "SELECT count(*) n FROM product_feeds WHERE company_id='demo-company'",
      ),
      1,
    );
    assert.equal(
      JSON.parse(
        h.sql
          .prepare(
            "SELECT preferences_json FROM tier1_preferences WHERE company_id='demo-company'",
          )
          .get().preferences_json,
      ).syncIntervalMinutes,
      15,
    );
    assert.equal(others(), before);
  } finally {
    h.close();
  }
});

test('values from request bodies and outside APIs become text without "[object Object]"', () => {
  const { asText } = loader()('platform/tier1/src/lib/format.ts');
  assert.deepEqual(
    [asText('a'), asText(42), asText(true), asText(0)],
    ['a', '42', 'true', '0'],
  );
  for (const value of [{}, { id: 'x' }, ['a'], null, undefined, () => 1])
    assert.equal(asText(value), '');
});
