import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as jose from 'jose';
import { loader } from './automation-test-fixture.mjs';
import { validateConfig } from '../scripts/platform-config.mjs';

const root = new URL('../', import.meta.url),
  secret = 'synthetic-platform-secret-with-at-least-32-characters';
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const walk = (dir) =>
  readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir + e.name + '/') : [dir + e.name],
  );
async function token(subject = 'local-admin', options = {}) {
  return new jose.SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setIssuer(options.issuer || 'urn:webshop-toolbox:local-test')
    .setAudience(options.audience || 'platform-local')
    .setIssuedAt()
    .setExpirationTime(options.exp || '1h')
    .sign(new TextEncoder().encode(options.secret || secret));
}
function harness(joseOverride = jose) {
  const sql = new DatabaseSync(':memory:');
  for (const migration of readdirSync(new URL('platform/migrations/',root)).sort()) sql.exec(read('platform/migrations/' + migration));
  sql.exec(read('platform/fixtures/seed.sql'));
  const db = {
    prepare(query) {
      const wrap = (args) => ({
        bind: (...values) => wrap(values),
        first: async () => sql.prepare(query).get(...args) || null,
        all: async () => ({ results: sql.prepare(query).all(...args) }),
        run: async () => ({
          meta: { changes: sql.prepare(query).run(...args).changes },
        }),
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
  const worker = loader({ jose: joseOverride })('platform/worker.ts').default;
  const env = {
    PLATFORM_DB: db,
    PLATFORM_DOCUMENTS: {},
    ASSETS: { fetch: async () => new Response('ADMIN ASSET') },
    PLATFORM_ENV: 'local-test',
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
        body: options.body ? JSON.stringify(options.body) : undefined,
      }),
      { ...env, ...options.env },
    );
  }
  return { sql, db, worker, env, request, close: () => sql.close() };
}
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
    h.sql.exec("UPDATE users SET status='inactive' WHERE id='local-a'");
    assert.equal(
      (await h.request('/api/platform/me', { user: 'local-a' })).status,
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
      (await h.request('/api/platform/settings/admins', { user: 'local-reader' })).status,
      403,
    );
  } finally {
    h.close();
  }
});
test('admin creates and edits company and webshop with atomic audit', async () => {
  const h = harness();
  try {
    const created = await h.request('/api/platform/companies', {
      method: 'POST',
      body: { name: 'Ny virksomhed' },
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const shop = await h.request(`/api/platform/companies/${id}/webshops`, {
      method: 'POST',
      body: { name: 'Ny shop', domain: 'new.example.test' },
    });
    assert.equal(shop.status, 201);
    const sid = (await shop.json()).id;
    assert.equal(
      (
        await h.request(`/api/platform/companies/${id}/webshops/${sid}`, {
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
      3,
    );
  } finally {
    h.close();
  }
});
test('admin changes user membership and grants; revocation is effective on next request', async () => {
  const h = harness();
  try {
    const u = await h.request('/api/platform/companies/company-a/users', {
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
test('company administrator cannot access another company, create identities or assign company roles', async () => {
  const h = harness();
  try {
    for (const [path, body] of [
      ['/companies', { name: 'x' }],
      ['/settings/admins', { email: 'x@example.test', issuer: 'urn:x', subject: 'x' }],
      [
        '/companies/company-b/webshops',
        { name: 'x', domain: 'x.example.test' },
      ],
      [
        '/companies/company-a/members',
        { userId: 'local-reader', role: 'admin' },
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
  assert.throws(() =>
    validateConfig(
      { ...remote, vars: { ...remote.vars, PLATFORM_AUTH: 'local-jwt' } },
      true,
    ),
  );
});
test('platform runtime imports no legacy code and has no outbound integration or email capability', () => {
  for (const file of readdirSync(new URL('platform/', root)).filter((f) =>
    f.endsWith('.ts'),
  )) {
    const source = read('platform/' + file);
    for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g))
      assert.ok(
        match[1] === 'jose' || /^\.\/(auth|admin|safety|types)$/.test(match[1]),
        `${file}: ${match[1]}`,
      );
    assert.doesNotMatch(source, /(?<!ASSETS\.)\bfetch\s*\((?!request:)/);
    assert.doesNotMatch(source, /\.send\s*\(/);
  }
});
test('every current legacy API route is absent from the platform entrypoint', async () => {
  const h = harness();
  try {
    const jwt = await token();
    for (const file of walk('app/api/').filter((f) =>
      f.endsWith('/route.ts'),
    )) {
      const path = '/' + file.replace(/^app\//, '').replace(/\/route.ts$/, '');
      for (const method of [
        ...read(file).matchAll(
          /export\s+(?:async\s+)?function\s+(GET|POST|PATCH|DELETE|PUT)\b/g,
        ),
      ].map((m) => m[1]))
        assert.equal(
          (
            await h.request(path, {
              token: jwt,
              method,
              body: method === 'GET' ? undefined : {},
            })
          ).status,
          404,
          `${method} ${path}`,
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
    assert.equal(response.headers.get('referrer-policy'), 'same-origin');
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
 const h=harness(); try {
 const res=await h.request('/api/platform/companies/company-a/users',{user:'local-a',method:'POST',body:{email:'owned@example.test',issuer:'urn:webshop-toolbox:local-test',subject:'owned',role:'member'}});
 assert.equal(res.status,201); const {id}=await res.json();
 assert.equal(h.sql.prepare('SELECT company_id FROM users WHERE id=?').get(id).company_id,'company-a');
 for(const [path,user,expected] of [[`/companies/company-b/users/${id}`,'local-b',404],[`/companies/company-a/users/${id}`,'local-reader',403],[`/settings/admins/${id}`,'local-admin',404]]) assert.equal((await h.request('/api/platform'+path,{user,method:'PATCH',body:{status:'inactive'}})).status,expected);
 assert.equal((await h.request('/api/platform/companies/company-b/members',{method:'POST',body:{userId:id,role:'member'}})).status,400);
 assert.throws(()=>h.sql.prepare('INSERT INTO platform_admins VALUES(?)').run(id),/Company users/);
 assert.throws(()=>h.sql.prepare("INSERT INTO company_memberships VALUES('company-b',?,'member')").run(id),/owner|UNIQUE/);
 assert.throws(()=>h.sql.prepare("UPDATE users SET company_id='company-b' WHERE id=?").run(id),/cannot change/);
 assert.equal((await h.request(`/api/platform/companies/company-a/users/${id}`,{user:'local-a',method:'PATCH',body:{status:'inactive'}})).status,200);
 assert.equal((await h.request('/api/platform/me',{user:'owned'})).status,403);
 assert.equal((await h.request('/api/platform/users')).status,404);
 assert.deepEqual((await (await h.request('/api/platform/settings/admins')).json()).users.map(u=>u.id),['local-admin']);
 const pa=await h.request('/api/platform/settings/admins',{method:'POST',body:{email:'portal@example.test',issuer:'urn:webshop-toolbox:local-test',subject:'portal-new'}});
 assert.equal(pa.status,201); const aid=(await pa.json()).id;
 assert.equal((await (await h.request('/api/platform/me',{user:'portal-new'})).json()).user.platformAdmin,true);
 assert.equal((await h.request('/api/platform/companies/company-a/members',{method:'POST',body:{userId:aid,role:'admin'}})).status,400);
 assert.equal((await h.request(`/api/platform/settings/admins/${aid}`,{method:'PATCH',body:{status:'inactive'}})).status,200);
 assert.equal((await h.request('/api/platform/me',{user:'portal-new'})).status,403);
 } finally {h.close();}
});
test('ownership migration rejects ambiguous memberships and preserves valid ownership',()=>{
 const sql=new DatabaseSync(':memory:');try{
 sql.exec(read('platform/migrations/0001_admin.sql'));
 sql.exec("INSERT INTO companies(id,name) VALUES('a','A'),('b','B'); INSERT INTO users VALUES('u','urn:test','u','u@example.test','active'); INSERT INTO company_memberships VALUES('a','u','member'),('b','u','member');");
 assert.throws(()=>sql.exec(read('platform/migrations/0002_company_users.sql')),/UNIQUE/);
 sql.exec("DELETE FROM company_memberships WHERE company_id='b'");sql.exec(read('platform/migrations/0002_company_users.sql'));
 assert.equal(sql.prepare("SELECT company_id FROM users WHERE id='u'").get().company_id,'a');
 }finally{sql.close();}
});
