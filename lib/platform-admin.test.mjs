import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as jose from 'jose';
import * as pdfLib from 'pdf-lib';
import { fixture } from './invoice-fixture.mjs';
import { loader } from './automation-test-fixture.mjs';
import { validateConfig } from '../scripts/platform-config.mjs';

const root = new URL('../', import.meta.url),
  secret = 'synthetic-platform-secret-with-at-least-32-characters';
test('public signup atomically creates an inactive company administrator; verified activation starts a single trial',async()=>{
 const h=harness();try{
  const env={PLATFORM_SIGNUP:'enabled',PLATFORM_CUSTOMER_LOGIN:'enabled',PLATFORM_LOGIN_SECRET:'ab'.repeat(32)};
  const body={name:'New Owner',company:'New Shop',email:'signup@example.test',cvr:'12345678',accept:true};
  const send=extra=>h.request('/auth/signup',{auth:false,method:'POST',env,body:{...body,...extra}});
  const before=h.sql.prepare('SELECT count(*) n FROM companies').get().n;
  const r=await send({role:'platformAdmin',companyId:'company-a'});assert.equal(r.status,202,await r.clone().text());
  const link=(await r.json()).previewLink,invitation=new URL(link).searchParams.get('invitation');
  let user=h.sql.prepare('SELECT * FROM users WHERE email=?').get(body.email);
  assert.equal(user.status,'inactive');assert.notEqual(user.company_id,'company-a');
  assert.equal(h.sql.prepare('SELECT role FROM company_memberships WHERE user_id=?').get(user.id).role,'admin');
  assert.equal(h.sql.prepare('SELECT * FROM platform_admins WHERE user_id=?').get(user.id),undefined);
  assert.equal(h.sql.prepare('SELECT trial_started_at FROM public_signups WHERE user_id=?').get(user.id).trial_started_at,null);
  assert.equal((await send({})).status,202);assert.equal((await send({email:'different@example.test'})).status,202);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM companies').get().n,before+1);
  const start=await customerStart(h,body.email,{invitation});
  const verified=await customerVerify(h,start,{name:body.name});assert.equal(verified.status,200,await verified.clone().text());
  const session=verified.headers.getSetCookie().find(c=>c.startsWith('__Host-toolbox_session=')).split(';')[0];
  const trial=h.sql.prepare('SELECT * FROM public_signups WHERE user_id=?').get(user.id);
  assert.ok(trial.trial_started_at);assert.ok(trial.trial_ends_at>=trial.trial_started_at+89*86400);assert.equal(trial.trial_ends_at-trial.contact_due_at,14*86400);
  assert.equal((await customerRequest(h,'/api/platform/companies/company-a/members',{headers:{cookie:session}})).status,403);
  assert.equal((await customerRequest(h,'/api/platform/settings/welcome',{headers:{cookie:session}})).status,403);
  assert.equal((await customerVerify(h,start,{name:body.name})).status,401);
  assert.equal(h.sql.prepare('SELECT trial_started_at FROM public_signups WHERE user_id=?').get(user.id).trial_started_at,trial.trial_started_at);
  h.sql.prepare('UPDATE public_signups SET trial_ends_at=1 WHERE user_id=?').run(user.id);
  assert.equal((await customerRequest(h,'/api/platform/me',{headers:{cookie:session}})).status,403);
 }finally{h.close();}
});
test('signup validates consent/origin, bounds abuse and rolls back partial creation',async()=>{
 const h=harness();try{
  const env={PLATFORM_SIGNUP:'enabled',PLATFORM_CUSTOMER_LOGIN:'enabled',PLATFORM_LOGIN_SECRET:'ab'.repeat(32)};
  const body={name:'New Owner',company:'New Shop',email:'signup@example.test',cvr:'12345678',accept:true};
  const opts={auth:false,method:'POST',env,body};
  assert.equal((await h.request('/auth/signup',{...opts,csrfOrigin:'https://attacker.test'})).status,403);
  assert.equal((await h.request('/auth/signup',{...opts,body:{...body,accept:false}})).status,400);
  assert.equal((await h.request('/auth/signup',{...opts,body:{...body,website:'spam'}})).status,400);
  const before=h.sql.prepare('SELECT count(*) n FROM companies').get().n;
  h.sql.exec("CREATE TRIGGER fail_signup BEFORE INSERT ON public_signups BEGIN SELECT RAISE(ABORT,'fixture fail'); END");
  assert.equal((await h.request('/auth/signup',opts)).status,500);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM companies').get().n,before);
  assert.equal(h.sql.prepare('SELECT * FROM users WHERE email=?').get(body.email),undefined);
  h.sql.exec('DROP TRIGGER fail_signup');
  for(let n=0;n<6;n++)await h.request('/auth/signup',{...opts,body:{...body,email:`signup${n}@example.test`,cvr:String(12345670+n)}});
  assert.equal((await h.request('/auth/signup',opts)).status,429);
 }finally{h.close();}
});
test('welcome template uses revision checks, rejects missing link and restricts customer access',async()=>{
 const h=harness();try{
  const path='/api/platform/settings/welcome',original=await (await h.request(path)).json();
  assert.equal((await h.request(path,{user:'local-a'})).status,403);
  assert.equal((await h.request(path,{method:'PUT',body:{...original,body:'Missing invitation link'}})).status,400);
  const change={...original,subject:'Hej {{name}}',body:'Din virksomhed {{company}} er oprettet. {{link}}'};
  assert.equal((await h.request(path,{method:'PUT',body:change})).status,200);
  assert.equal((await h.request(path,{method:'PUT',body:change})).status,409);
  assert.equal((await (await h.request(path)).json()).version,original.version+1);
 }finally{h.close();}
});
test('uncertain signup mail is not retried by a repeat submission and contains configured welcome content',async()=>{
 const h=harness();try{
  const sent=[],env={PLATFORM_ENV:'remote-test',PLATFORM_AUTH:'cloudflare-access',PLATFORM_SIGNUP:'enabled',PLATFORM_CUSTOMER_LOGIN:'enabled',PLATFORM_LOGIN_SECRET:'ab'.repeat(32),PLATFORM_INVITATION_FROM:'no-reply@webshoptoolbox.dk',PLATFORM_INVITATION_RECIPIENTS:'signup@example.test',PLATFORM_INVITATIONS:{send:async m=>{sent.push(m);throw Error('uncertain');}}};
  const opts={auth:false,origin:'https://dev.webshoptoolbox.dk',method:'POST',env,headers:{'cf-connecting-ip':'192.0.2.1'},body:{name:'Owner',company:'My Shop',email:'signup@example.test',cvr:'12345678',accept:true}};
  assert.equal((await h.request('/auth/signup',opts)).status,202);
  assert.equal((await h.request('/auth/signup',opts)).status,202);assert.equal(sent.length,1);
  assert.match(sent[0].text,/3 måneders gratis abonnement/);assert.match(sent[0].text,/https:\/\/dev.webshoptoolbox.dk\/onboarding\?invitation=[a-f0-9]{64}/);
  assert.equal(h.sql.prepare("SELECT delivery FROM invitations i JOIN users u ON u.id=i.user_id WHERE u.email='signup@example.test'").get().delivery,'uncertain');
 }finally{h.close();}
});
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const walk = (dir) =>
  readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir + e.name + '/') : [dir + e.name],
  );
async function token(subject = 'local-admin', options = {}) {
  return new jose.SignJWT(options.email ? {email:options.email} : {})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setIssuer(options.issuer || 'urn:webshop-toolbox:local-test')
    .setAudience(options.audience || 'platform-local')
    .setIssuedAt()
    .setExpirationTime(options.exp || '1h')
    .sign(new TextEncoder().encode(options.secret || secret));
}
function harness(joseOverride = jose, network) {
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
  const worker = loader({ jose: joseOverride, 'pdf-lib': pdfLib, fetch:network })('platform/worker.ts').default;
  const env = {
    PLATFORM_DB: db,
    PLATFORM_DOCUMENTS: {},
    ASSETS: { fetch: async () => new Response('ADMIN ASSET') },
    PLATFORM_ENV: 'local-test',
    PLATFORM_INVITATION_MODE:'preview',
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
        body: options.rawBody ?? (options.body ? JSON.stringify(options.body) : undefined),
      }),
      { ...env, ...options.env },
    );
  }
  async function provision(path,options) {
    const response=await request(path,options); if(response.status!==201) return response;
    const data=await response.clone().json();
    const accepted=await request('/api/platform/onboarding',{token:await token(options.body.subject,{email:options.body.email}),method:'POST',body:{token:data.previewLink.split('invitation=')[1],name:'Test User'}});
    assert.equal(accepted.status,200,await accepted.text());return response;
  }
  return { sql, db, worker, env, request, provision, close: () => sql.close() };
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
      (await h.request('/api/platform/settings/admins', { user: 'local-reader' })).status,
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
    assert.equal((await h.provision(`/api/platform/companies/${id}/users`,{method:'POST',body:{email:'owner@example.test',issuer:'urn:webshop-toolbox:local-test',subject:'new-owner',role:'admin'}})).status,201);
    const before=h.sql.prepare('SELECT count(*) n FROM audit_events WHERE company_id=?').get(id).n;
    const shop = await h.request(`/api/platform/companies/${id}/webshops`, {
      user:'new-owner', method: 'POST',
      body: { name: 'Ny shop', domain: 'new.example.test' },
    });
    assert.equal(shop.status, 201);
    const sid = (await shop.json()).id;
    assert.equal(
      (
        await h.request(`/api/platform/companies/${id}/webshops/${sid}`, {
          user:'new-owner', method: 'PATCH',
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
      before+2,
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
      ['/settings/admins', { email: 'x@example.test', issuer: 'urn:x', subject: 'x' }],
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
          user:'local-a', body: { name: 'x', domain: 'a1.example.test' },
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
  for(const pattern of ['portal.webshoptoolbox.dk','webshoptoolbox.dk','*.webshoptoolbox.dk','integration.sablen.dk'])
    assert.throws(()=>validateConfig({...remote,routes:[{pattern,custom_domain:true}]},true));

  assert.throws(() =>
    validateConfig(
      { ...remote, vars: { ...remote.vars, PLATFORM_AUTH: 'local-jwt' } },
      true,
    ),
  );
});
test('platform runtime imports no legacy code; only restricted invitation and mail-test adapters can send email', () => {
  for (const file of readdirSync(new URL('platform/', root)).filter((f) =>
    f.endsWith('.ts'),
  )) {
    const source = read('platform/' + file);
    for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g))
      assert.ok(
        ['jose','pdf-lib','../lib/invoice-check','../lib/dinero-sale','../lib/refund-voucher','../lib/flatpay-draft','../lib/invoice-totals','./tier1/src/lib/admin-settings','./tier1/src/lib/history-policy','./tier1/src/lib/order-period','./tier1/src/lib/booking-status'].includes(match[1]) || /^\.\/(signup|auth|admin|safety|types|invitations|catalog|support|connections|mail|invoices|invoice-pdf|invoice-design|invoice-source|order-check|customer-auth|tickets|invoice-line-order|operations|accounting|dinero-read|sales-preview|packaging|packaging-calculations|payout-calculations|payout-source|payout-pdf|money|documents|payments|flatpay-read|viabill-read|packaging-source|stocktake|inventory-source|inventory-calculations|finance-source|finance-calculations|tier1-api|tier1-settings|tier1-connections|tier1-history|booking-onboarding|production-receipts|production-sales|production-booking|production-policy|production-proposals|production-emballage|production-stocktake|production-jobs|flatpay-report|dinero-write|tier1-data|flatpay-refunds|emballage-read|tier1-emballage|feeds|feed-source|feed-format)$/.test(match[1]),
        `${file}: ${match[1]}`,
      );
    if(!['production-stocktake.ts','mail.ts','invoice-source.ts','dinero-write.ts','dinero-read.ts','payout-source.ts','flatpay-read.ts','viabill-read.ts','finance-source.ts','emballage-read.ts'].includes(file)) assert.doesNotMatch(source, /(?<!ASSETS\.)\bfetch\s*\((?!request:)/);
    if(!['signup.ts','invitations.ts','mail.ts','customer-auth.ts'].includes(file)) assert.doesNotMatch(source, /\.send\s*\(/);
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
 const h=harness(); try {
 const res=await h.provision('/api/platform/companies/company-a/users',{user:'local-a',method:'POST',body:{email:'owned@example.test',issuer:'urn:webshop-toolbox:local-test',subject:'owned',role:'member'}});
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
 const pa=await h.provision('/api/platform/settings/admins',{method:'POST',body:{email:'portal@example.test',issuer:'urn:webshop-toolbox:local-test',subject:'portal-new'}});
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

test('invitation requires matching verified email, profile, fresh token and single use',async()=>{
 const h=harness();try{
 const response=await h.request('/api/platform/companies/company-a/users',{method:'POST',body:{email:'INVITED@example.test',role:'member'}});
 assert.equal(response.status,201);const result=await response.json();const invitation=result.previewLink.split('invitation=')[1];
 const accept=(jwt,code=invitation,name='Invited User')=>h.request('/api/platform/onboarding',{token:jwt,method:'POST',body:{token:code,name}});
 assert.equal((await accept(await token('invited',{email:'other@example.test'}))).status,403);
 assert.equal((await accept(await token('invited'))).status,400);
 const jwt=await token('invited',{email:'invited@example.test'});
 assert.equal((await accept(jwt,invitation,'')).status,400);
 assert.equal((await h.request(`/api/platform/companies/company-a/users/${result.id}`,{method:'PATCH',body:{status:'active'}})).status,409);
 assert.equal((await accept(jwt)).status,200);
 assert.equal((await accept(jwt)).status,403);
 assert.equal((await (await h.request('/api/platform/me',{token:jwt})).json()).user.fullName,'Invited User');
 assert.equal(h.sql.prepare('SELECT count(*) n FROM invitations WHERE token_hash=?').get(invitation).n,0);
 assert.equal((await h.request('/api/platform/companies/company-b/users',{method:'POST',body:{email:'invited@example.test'}})).status,409);
 }finally{h.close();}
});
test('expired and revoked invitations are rejected; renewal invalidates old token',async()=>{
 const h=harness();try{
 const first=await (await h.request('/api/platform/companies/company-a/users',{method:'POST',body:{email:'renew@example.test'}})).json();
 const jwt=await token('renew',{email:'renew@example.test'});
 const accept=link=>h.request('/api/platform/onboarding',{token:jwt,method:'POST',body:{token:link.split('invitation=')[1],name:'Renew User'}});
 h.sql.prepare('UPDATE invitations SET expires_at=0 WHERE user_id=?').run(first.id);
 assert.equal((await accept(first.previewLink)).status,403);
 const path=`/api/platform/companies/company-a/users/${first.id}/invitation`;
 assert.equal((await h.request(path,{user:'local-b',method:'POST',body:{}})).status,403);
 const fresh=await (await h.request(path,{method:'POST',body:{}})).json();
 assert.equal((await accept(first.previewLink)).status,403);
 assert.equal((await h.request(path,{method:'DELETE',body:{}})).status,200);
 assert.equal((await accept(fresh.previewLink)).status,403);
 }finally{h.close();}
});
test('first invite is company admin and last active admin is protected',async()=>{
 const h=harness();try{
 const c=await (await h.request('/api/platform/companies',{method:'POST',body:{name:'Fresh'}})).json();
 const first=await h.provision(`/api/platform/companies/${c.id}/users`,{method:'POST',body:{email:'first@example.test',subject:'first',role:'member'}});
 assert.equal(first.status,201);const id=(await first.json()).id;
 assert.equal(h.sql.prepare('SELECT role FROM company_memberships WHERE user_id=?').get(id).role,'admin');
 for(const [path,method,body] of [[`/companies/${c.id}/users/${id}`,'PATCH',{status:'inactive'}],[`/companies/${c.id}/members`,'POST',{userId:id,role:'member'}],[`/companies/${c.id}/members`,'DELETE',{userId:id}]])
 assert.equal((await h.request('/api/platform'+path,{method,body})).status,409);
 const jwt=await token('first',{email:'first@example.test'});
 const next=await h.request(`/api/platform/companies/${c.id}/users`,{token:jwt,method:'POST',body:{email:'next@example.test',role:'admin'}});
 assert.equal(next.status,201);
 // An unaccepted administrator invitation cannot replace the last active administrator.
 assert.equal((await h.request(`/api/platform/companies/${c.id}/users/${id}`,{method:'PATCH',body:{status:'inactive'}})).status,409);
 }finally{h.close();}
});
test('profile gate and restricted invitation delivery never enable customer mail',async()=>{
 const h=harness();try{
 h.sql.exec("UPDATE users SET full_name=NULL WHERE id='local-a'");
 assert.equal((await h.request('/api/platform/companies',{user:'local-a'})).status,428);
 assert.equal((await h.request('/api/platform/profile',{user:'local-a',method:'POST',body:{name:'Alice',phone:''}})).status,200);
 assert.equal((await h.request('/api/platform/companies',{user:'local-a'})).status,200);
 let sent=0;const env={PLATFORM_INVITATION_MODE:'restricted',PLATFORM_INVITATION_FROM:'no-reply@webshoptoolbox.dk',PLATFORM_INVITATION_RECIPIENTS:'allowed@example.test',PLATFORM_INVITATIONS:{send:async m=>{sent++;assert.equal(m.to,'allowed@example.test');throw Error('timeout');}}};
 assert.equal((await h.request('/api/platform/companies/company-a/users',{env,method:'POST',body:{email:'blocked@example.test'}})).status,503);
 assert.equal(sent,0);
 const result=await (await h.request('/api/platform/companies/company-a/users',{env,method:'POST',body:{email:'allowed@example.test'}})).json();
 assert.equal(result.delivery,'uncertain');assert.equal(result.previewLink,undefined);assert.equal(sent,1);
 assert.equal((await h.request('/api/invoices/email',{env,method:'POST',body:{}})).status,404);
 }finally{h.close();}
});

test('customer workspace is server-selected and accounting is one configuration per company', async () => {
  const h=harness();
  try {
    const workspace=await h.request('/api/platform/workspace?companyId=company-b',{user:'local-a'});
    assert.equal(workspace.status,200);
    assert.equal((await workspace.json()).company.id,'company-a');
    assert.equal((await h.request('/api/platform/workspace',{user:'local-admin'})).status,403);
    const save=(company,provider,user='local-a')=>h.request(`/api/platform/companies/${company}/accounting`,{user,method:'PUT',body:{provider,accountName:'Testregnskab'}});
    assert.equal((await save('company-a','dinero')).status,200);
    assert.equal((await save('company-a','e-conomic')).status,200);
    assert.equal(h.sql.prepare('SELECT count(*) n FROM company_accounting WHERE company_id=?').get('company-a').n,1);
    assert.equal((await save('company-b','dinero')).status,403);
    assert.equal((await save('company-a','dinero','local-reader')).status,403);
    assert.equal((await save('company-a','unknown')).status,400);
    assert.equal((await h.request('/api/platform/companies/company-a/accounting',{user:'local-b'})).status,403);
    const config=await (await h.request('/api/platform/companies/company-a/accounting',{user:'local-reader'})).json();
    assert.deepEqual(config.accounting,{provider:'e-conomic',account_name:'Testregnskab',status:'pending'});
    assert.equal(h.sql.prepare("SELECT count(*) n FROM audit_events WHERE action='accounting.configured'").get().n,2);
    assert.throws(()=>h.sql.exec("INSERT INTO company_accounting VALUES('company-a','dinero','Duplicate','pending',CURRENT_TIMESTAMP)"));
    assert.throws(()=>h.sql.exec("UPDATE company_accounting SET status='connected'"));
    h.sql.exec("UPDATE companies SET status='inactive' WHERE id='company-a'");
    assert.equal((await h.request('/api/platform/workspace',{user:'local-a'})).status,403);
    assert.equal((await save('company-a','dinero')).status,403);
  } finally {h.close();}
});

test('catalog selections are company-scoped and cannot create extra accounting connections', async()=>{
 const h=harness();try{
  assert.equal((await h.request('/api/platform/catalog',{user:'local-a'})).status,200);
  assert.equal((await h.request('/api/platform/catalog/status',{user:'local-a'})).status,403);
  const choose=(company,id,user='local-a',method='POST')=>h.request(`/api/platform/companies/${company}/integrations`,{user,method,body:{integrationId:id}});
  assert.equal((await choose('company-a','flatpay')).status,200);
  assert.equal((await choose('company-a','flatpay')).status,200);
  assert.equal((await choose('company-b','viabill')).status,403);
  assert.equal((await choose('company-a','viabill','local-reader')).status,403);
  assert.equal((await choose('company-a','dinero')).status,400);
  assert.equal((await choose('company-a','unknown')).status,400);
  const selection=await (await h.request('/api/platform/companies/company-a/integrations',{user:'local-a'})).json();
  assert.deepEqual(selection.selected,[{integration_id:'flatpay'}]);
  assert.equal((await h.request('/api/platform/companies/company-a/integrations',{user:'local-b'})).status,403);
  assert.equal((await choose('company-a','flatpay','local-a','DELETE')).status,200);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM company_integrations').get().n,0);
 }finally{h.close();}
});
test('public API indicator fails closed for bad responses and never follows redirects or sends credentials',async()=>{
 const {apiStatus}=loader({})('platform/catalog.ts');
 for(const [status,expected] of [['operational','available'],['partial_outage','disrupted'],['unexpected','unknown']]){
  const result=await apiStatus(async(url,options)=>{
   assert.equal(url,'https://www.shopifystatus.com/api/v2/components.json');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);
   return Response.json({components:[{name:'API & Mobile',status}]});
  });
  assert.equal(result[0].api.state,expected);assert.ok(result[0].api.checkedAt);
  assert.equal(result[1].api.state,'unknown');assert.equal(result[1].api.checkedAt,null);
 }
 for(const response of [new Response('',{status:503}),Response.json({components:[]}),Response.json({}),new Response('bad json')]){
  assert.equal((await apiStatus(async()=>response))[0].api.state,'unknown');
 }
 assert.equal((await apiStatus(async()=>{throw Error('timeout');}))[0].api.state,'unknown');
});

test('logout clears local cookie, redirects to Access remotely and rejects foreign origins',async()=>{
 const h=harness();try{
  const local=await h.request('/logout',{auth:false,method:'POST',headers:{origin:'http://127.0.0.1:8790'}});
  assert.equal(local.status,303);assert.equal(local.headers.get('location'),'/local-login');
  assert.match(local.headers.get('set-cookie'),/platform_local=;.*HttpOnly;.*Max-Age=0/);
  assert.equal(local.headers.get('cache-control'),'no-store');
  const remote=await h.request('/logout',{auth:false,method:'POST',origin:'https://portal.example.test',headers:{origin:'https://portal.example.test'},env:{PLATFORM_ENV:'remote-test',PLATFORM_AUTH:'cloudflare-access',PLATFORM_LOCAL_SECRET:undefined}});
  assert.equal(remote.status,303);assert.equal(remote.headers.get('location'),'/cdn-cgi/access/logout');
  assert.equal((await h.request('/logout',{auth:false,method:'POST',headers:{origin:'https://elsewhere.example'}})).status,403);
 }finally{h.close();}
});


async function startSupport(h,userId='local-reader',companyId='company-a') {
  const response=await h.request('/api/platform/support',{method:'POST',body:{userId,companyId,reason:'Undersøg adgang'}});
  assert.equal(response.status,201,await response.clone().text());
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const me=await (await h.request('/api/platform/me',{headers:{cookie}})).json();
  return {cookie,'x-platform-actor':me.user.id+':'+me.user.support.sessionId};
}
test('support uses target permissions, isolates tenants and rejects stolen cookies and stale tabs',async()=>{
  const h=harness();try {
    assert.equal((await h.request('/api/platform/support',{user:'local-a',method:'POST',body:{companyId:'company-a',userId:'local-reader',reason:'test'}})).status,403);
    for(const [userId,companyId] of [['local-admin','company-a'],['local-b','company-a']])
      assert.equal((await h.request('/api/platform/support',{method:'POST',body:{userId,companyId,reason:'test'}})).status,403);
    assert.equal((await h.request('/api/platform/support',{method:'POST',csrfOrigin:'https://evil.test',body:{userId:'local-reader',companyId:'company-a',reason:'test'}})).status,403);
    const headers=await startSupport(h);
    const me=await (await h.request('/api/platform/me',{headers})).json();
    assert.equal(me.user.id,'local-reader');assert.equal(me.user.platformAdmin,false);
    assert.equal((await h.request('/api/platform/workspace',{headers})).status,200);
    for(const path of ['/api/platform/settings/admins','/api/platform/companies/company-b/webshops','/api/platform/companies/company-a/members'])
      assert.equal((await h.request(path,{headers})).status,403);
    assert.equal((await h.request('/api/platform/me',{headers,user:'local-a'})).status,403);
    assert.equal((await h.request('/api/platform/me',{headers:{...headers,'x-platform-actor':'local-admin:'}})).status,409);
    assert.equal((await h.request('/api/platform/support',{headers,method:'POST',body:{}})).status,409);
    assert.equal((await h.request('/api/platform/companies/company-a/webshops',{headers,method:'POST',body:{name:'No',domain:'no.test'}})).status,403);
    const stop=await h.request('/api/platform/support',{headers,method:'DELETE',body:{}});
    assert.equal(stop.status,200);assert.match(stop.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await h.request('/api/platform/me',{headers})).status,403);
    assert.equal((await h.request('/api/platform/companies',{headers:{'x-platform-actor':headers['x-platform-actor']},method:'POST',body:{name:'Stale'}})).status,409);
    assert.equal((await h.request('/api/platform/me')).status,200);
  }finally{h.close();}
});
test('support writes identify original admin; expiry, deactivation and role revocation take effect immediately',async()=>{
 const h=harness();try {
   const headers=await startSupport(h,'local-a');
   const result=await h.request('/api/platform/companies/company-a/accounting',{headers,method:'PUT',body:{provider:'dinero',accountName:'Support test'}});
   assert.equal(result.status,200,await result.text());
   const audit=h.sql.prepare("SELECT actor_id,details_json FROM audit_events WHERE action='accounting.configured'").get();
   assert.equal(audit.actor_id,'local-admin');assert.equal(JSON.parse(audit.details_json).impersonatedUser,'local-a');
   for(const path of ['/api/platform/profile','/api/platform/companies/company-a/users'])
     assert.equal((await h.request(path,{headers,method:'POST',body:{name:'Changed',email:'other@example.test'}})).status,403);
   assert.equal((await h.request('/api/platform/onboarding',{headers,method:'POST',body:{}})).status,403);
   assert.equal((await h.request('/api/platform/companies/company-a/accounting',{headers:{cookie:headers.cookie},method:'PUT',body:{provider:'dinero',accountName:'No'}})).status,409);
   h.sql.exec("UPDATE support_sessions SET expires_at=0");
   assert.equal((await h.request('/api/platform/me',{headers})).status,403);
   assert.equal((await h.request('/',{headers})).status,200);
   assert.equal((await h.request('/api/platform/support',{headers,method:'DELETE',body:{}})).status,200);
   const second=await startSupport(h);
   h.sql.exec("UPDATE users SET status='inactive' WHERE id='local-reader'");
   assert.equal((await h.request('/api/platform/me',{headers:second})).status,403);
   assert.equal((await h.request('/api/platform/support',{headers:second,method:'DELETE',body:{}})).status,200);
   h.sql.exec("UPDATE users SET status='active' WHERE id='local-reader'");
   const third=await startSupport(h);
   h.sql.exec("DELETE FROM platform_admins WHERE user_id='local-admin'");
   assert.equal((await h.request('/api/platform/me',{headers:third})).status,403);
   assert.equal((await h.request('/api/platform/support',{headers:third,method:'DELETE',body:{}})).status,200);
 }finally{h.close();}
});


test('Shopify setup is encrypted, scoped, atomic and never returned or logged',async()=>{
 const h=harness();try {
  h.env.PLATFORM_CREDENTIALS_KEY='ab'.repeat(32);
  const body={provider:'shopify',name:'New shop',domain:'https://new.example.test/',shopDomain:'https://new.myshopify.com',clientId:'synthetic-client',clientSecret:'synthetic-secret'};
  const response=await h.request('/api/platform/companies/company-a/webshops',{user:'local-a',method:'POST',body});
  assert.equal(response.status,201,await response.clone().text());const {id}=await response.json();
  const row=h.sql.prepare('SELECT * FROM webshop_connections WHERE webshop_id=?').get(id);
  assert.equal(row.shop_domain,'new.myshopify.com');assert.ok(!row.credentials_encrypted.includes(body.clientSecret));
  const {unseal}=loader({})('platform/connections.ts');
  assert.equal((await unseal(h.env,['company-a',id,'shopify',row.shop_domain],row.credentials_encrypted)).clientSecret,body.clientSecret);
  for(const scope of [['company-b',id,'shopify',row.shop_domain],['company-a','shop-a1','shopify',row.shop_domain],['company-a',id,'shopify','other.myshopify.com']])
    await assert.rejects(unseal(h.env,scope,row.credentials_encrypted));
  await assert.rejects(unseal({...h.env,PLATFORM_ENV:'remote-test'},['company-a',id,'shopify',row.shop_domain],row.credentials_encrypted));
  const list=await (await h.request('/api/platform/companies/company-a/webshops',{user:'local-a'})).text();
  assert.ok(list.includes('shopify'));assert.ok(!list.includes('credentials_encrypted'));assert.ok(!list.includes(body.clientSecret));assert.ok(!list.includes(body.clientId));
  const audit=JSON.stringify(h.sql.prepare('SELECT * FROM audit_events').all());assert.ok(!audit.includes(body.clientSecret));
  for(const user of ['local-b','local-reader']) assert.equal((await h.request(`/api/platform/companies/company-a/webshops/${id}/connection`,{user,method:'PUT',body})).status,403);
  const update={...body,clientSecret:'replacement-secret'};
  assert.equal((await h.request(`/api/platform/companies/company-a/webshops/${id}/connection`,{user:'local-a',method:'PUT',body:update})).status,200);
  assert.equal((await unseal(h.env,['company-a',id,'shopify',row.shop_domain],h.sql.prepare('SELECT credentials_encrypted FROM webshop_connections WHERE webshop_id=?').get(id).credentials_encrypted)).clientSecret,update.clientSecret);
  const before=h.sql.prepare('SELECT count(*) n FROM webshops').get().n;
  for(const change of [{provider:'unknown'},{shopDomain:'https://new.myshopify.com.evil.test'},{domain:'https://user:password@example.test'},{shopDomain:'https://new.myshopify.com/admin'},{clientSecret:''}])
    assert.equal((await h.request('/api/platform/companies/company-a/webshops',{user:'local-a',method:'POST',body:{...body,...change,domain:change.domain||'bad.example.test'}})).status,400);
  assert.equal((await h.request('/api/platform/companies/company-a/webshops',{user:'local-a',method:'POST',body:{...body,domain:'another.example.test'}})).status,409);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM webshops').get().n,before);
  delete h.env.PLATFORM_CREDENTIALS_KEY;
  assert.equal((await h.request('/api/platform/companies/company-a/webshops',{user:'local-a',method:'POST',body:{...body,domain:'missing.example.test'}})).status,503);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM webshops').get().n,before);
 }finally{h.close();}
});

test('company mail isolates settings, validates headers, hides credentials and uses standard fallback until verified', async()=>{
 const h=harness(),base='/api/platform/companies/company-a/mail';
 try{
  const get=await (await h.request(base,{user:'local-a'})).json();assert.equal(get.effectiveFrom,'faktura@webshoptoolbox.dk');
  assert.equal((await h.request(base,{user:'local-b'})).status,403);
  assert.equal((await h.request(base,{user:'local-reader',method:'PUT',body:{senderName:'A'}})).status,403);
  assert.equal((await h.request(base,{user:'local-a',method:'PUT',body:{senderName:'A\r\nB'}})).status,400);
  const input={senderName:'Test A',replyTo:'contact@example.test',customFrom:'invoice@a.example.test',accountId:'a'.repeat(32),apiToken:'synthetic-test-token-value-12345',status:'verified'};
  const response=await h.request(base,{user:'local-a',method:'PUT',body:input,env:{PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)}});
  assert.equal(response.status,200,await response.clone().text());
  const saved=await response.json();assert.equal(saved.status,'pending');assert.equal(saved.effectiveFrom,get.effectiveFrom);assert.equal(saved.credentialsSaved,true);assert.ok(!JSON.stringify(saved).includes(input.apiToken));
  const encrypted=h.sql.prepare('SELECT credentials_encrypted FROM company_mail').get().credentials_encrypted;assert.ok(!encrypted.includes(input.apiToken));
  const {unseal}=loader()('platform/connections.ts');await assert.rejects(()=>unseal({PLATFORM_ENV:'local-test',PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},['company-b','mail',input.customFrom,input.accountId],encrypted));
  assert.equal((await h.request(base,{user:'local-a',method:'PUT',body:{...input,customFrom:'new@a.example.test',apiToken:''}})).status,400);
  const reset=await (await h.request(base,{user:'local-a',method:'PUT',body:{senderName:'Test A',replyTo:'contact@example.test',customFrom:''}})).json();assert.equal(reset.status,'standard');assert.equal(reset.credentialsSaved,false);
 }finally{h.close();}
});

function mailFixture(network){
 const h=harness(),handle=loader({jose,fetch:network})('platform/mail.ts').handleMail;
 const actor={id:'local-a',email:'a@example.test',platformAdmin:false,fullName:'Test A'};
 const env={...h.env,PLATFORM_ENV:'remote-test',PLATFORM_MAIL_FROM:'faktura@webshoptoolbox.dk',PLATFORM_MAIL_TEST_RECIPIENTS:'a@example.test,b@example.test',PLATFORM_CREDENTIALS_KEY:'cd'.repeat(32)};
 const call=(input,who=actor,company='company-a',action='test',method='POST')=>handle(new Request('https://platform.example.test/api/platform/companies/'+company+'/mail'+(action?'/'+action:''),{method,headers:{origin:'https://platform.example.test','content-type':'application/json'},body:JSON.stringify(input)}),env,who,company,action);
 return {...h,actor,env,call};
}
test('test mail is restricted to authenticated recipients, rate limited and idempotent across concurrent requests',async()=>{
 const h=mailFixture();let sent=0;const messages=[];h.env.PLATFORM_MAIL_TEST={send:async m=>{sent++;messages.push(m);return {messageId:'fixture-receipt'};}};
 try{
  await assert.rejects(()=>h.call({requestId:crypto.randomUUID(),mode:'standard',recipient:'victim@example.test'}),e=>e.status===400);
  await assert.rejects(()=>h.call({requestId:crypto.randomUUID(),mode:'standard'},{...h.actor,support:{adminId:'local-admin'}}),e=>e.status===403);
  await assert.rejects(()=>h.call({requestId:crypto.randomUUID(),mode:'standard'},{...h.actor,email:'not-approved@example.test'}),e=>e.status===403);
  const id=crypto.randomUUID();const responses=await Promise.allSettled([h.call({requestId:id,mode:'standard'}),h.call({requestId:id,mode:'standard'})]);assert.equal(sent,1);
  assert.equal((await (await h.call({requestId:id,mode:'standard'})).json()).status,'accepted');assert.equal(sent,1);
  await assert.rejects(()=>h.call({requestId:crypto.randomUUID(),mode:'standard'}),e=>e.status===429);
  const b=await (await h.call({requestId:id,mode:'standard'},{...h.actor,id:'local-b',email:'b@example.test'},'company-b')).json();assert.equal(b.status,'accepted');assert.equal(sent,2);assert.deepEqual(messages.map(m=>m.to),['a@example.test','b@example.test']);
 }finally{h.close();}
});
test('uncertain test sends never retry the same request or claim successful delivery',async()=>{
 const h=mailFixture();let sent=0;h.env.PLATFORM_MAIL_TEST={send:async()=>{sent++;throw Error('secret-provider-token');}};
 try{const body={requestId:crypto.randomUUID(),mode:'standard'};const result=await(await h.call(body)).json();assert.equal(result.status,'uncertain');assert.ok(!JSON.stringify(result).includes('secret'));assert.equal((await(await h.call(body)).json()).status,'uncertain');assert.equal(sent,1);}finally{h.close();}
});
test('custom Cloudflare mail verifies only the saved revision using a fixed endpoint and no redirects',async()=>{
 let requests=[];const h=mailFixture(async(url,options)=>{requests.push({url,options});return Response.json({success:true,result:{delivered:[],queued:['a@example.test'],permanent_bounces:[]}});});h.env.PLATFORM_MAIL_TEST={send:async()=>{throw Error('must not use standard');}};
 try{
  await h.call({senderName:'A',replyTo:'reply@a.example.test',customFrom:'invoice@a.example.test',accountId:'a'.repeat(32),apiToken:'synthetic-token-123456789'},h.actor,'company-a','','PUT');
  const result=await(await h.call({requestId:crypto.randomUUID(),mode:'custom'})).json();assert.equal(result.status,'accepted');
  assert.equal(requests[0].url,'https://api.cloudflare.com/client/v4/accounts/'+'a'.repeat(32)+'/email/sending/send');assert.equal(requests[0].options.redirect,'manual');assert.deepEqual(JSON.parse(requests[0].options.body).from,{address:'invoice@a.example.test',name:'A'});assert.equal(JSON.parse(requests[0].options.body).reply_to,'reply@a.example.test');
  const saved=h.sql.prepare('SELECT * FROM company_mail').get();assert.equal(saved.verified_revision,saved.revision);
  await h.call({senderName:'A',customFrom:'new@a.example.test',accountId:'a'.repeat(32),apiToken:'different-token-123456789'},h.actor,'company-a','','PUT');assert.equal(h.sql.prepare('SELECT verified_revision FROM company_mail').get().verified_revision,null);
 }finally{h.close();}
});
test('custom mail cannot promote a setting edited while sending, and local preview never sends',async()=>{
 let h;h=mailFixture(async()=>{h.sql.prepare("UPDATE company_mail SET revision='new-revision'").run();return Response.json({success:true,result:{delivered:['a@example.test']}});});h.env.PLATFORM_MAIL_TEST={send:async()=>{throw Error('unexpected');}};
 try{
  await h.call({senderName:'A',customFrom:'invoice@a.example.test',accountId:'a'.repeat(32),apiToken:'synthetic-token-123456789'},h.actor,'company-a','','PUT');
  await h.call({requestId:crypto.randomUUID(),mode:'custom'});assert.equal(h.sql.prepare('SELECT verified_revision FROM company_mail').get().verified_revision,null);
  h.env.PLATFORM_ENV='local-test';h.sql.prepare('DELETE FROM mail_test_deliveries').run();const preview=await(await h.call({requestId:crypto.randomUUID(),mode:'standard'})).json();assert.equal(preview.status,'preview');
 }finally{h.close();}
});
test('test mail binding permits invoice recipients but cannot change sender or add hidden restrictions',()=>{
 const cfg=JSON.parse(read('wrangler.platform-test.json'));validateConfig(cfg,true);
 const unsafe=structuredClone(cfg);unsafe.send_email[1].allowed_destination_addresses=['hidden@example.test'];assert.throws(()=>validateConfig(unsafe,true));
});
async function invoiceHarness(){
 let order=fixture(),networkCalls=0,failStore=false;
 const network=async(url,options)=>{networkCalls++;assert.match(url,/^https:\/\/a[12]\.myshopify\.com\/admin\//);assert.equal(options.redirect,'manual');
  if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'synthetic-shopify-token'});
  const body=JSON.parse(options.body);assert.doesNotMatch(body.query,/mutation/);
  if(body.query.includes('InvoiceOrders'))return Response.json({data:{orders:{nodes:[{id:order.id,name:order.name,createdAt:order.createdAt}],pageInfo:{hasNextPage:false,endCursor:null}}}});
  return Response.json({data:{order:structuredClone(order)}});
 };
 const h=harness(jose,network),env={...h.env,PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},objects=new Map();
 env.PLATFORM_DOCUMENTS={put:async(key,bytes)=>{if(failStore)throw Error('storage failure');objects.set(key,new Uint8Array(bytes).slice());},get:async key=>{const b=objects.get(key);return b?{body:b,arrayBuffer:async()=>b.slice().buffer}:null;}};
 const {seal}=loader()('platform/connections.ts');
 for(const [shop,domain] of [['shop-a1','a1.myshopify.com'],['shop-a2','a2.myshopify.com']]){h.sql.prepare('INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)').run('company-a',shop,'shopify',domain,await seal(env,['company-a',shop,'shopify',domain],{clientId:'fixture-client',clientSecret:'fixture-secret'}));}
 const base='/api/platform/companies/company-a/invoices';
 const call=(action='',body,options={})=>h.request(base+(action?'/'+action:''),{user:'local-a',env,method:body?'POST':'GET',body,...options});
 const settings={name:'Eksempelhandel ApS',address:'Testvej 12, 8000 Aarhus C',cvr:'12345678',contact:'faktura@example.test',subject:'Faktura {{fakturanummer}} fra {{virksomhedsnavn}}',body:'Hej {{kundenavn}}\nDin ordre {{ordrenummer}} er vedhæftet.',months:120};
 assert.equal((await call('settings',settings,{method:'PUT'})).status,200);
 const input=shop=>({webshopId:shop,externalId:order.id});
 return {...h,env,objects,call,input,settings,network,get order(){return order;},set order(v){order=v;},get calls(){return networkCalls;},failStore:()=>{failStore=true;}};
}

test('platform invoices isolate overlapping IDs, preserve changed invoices and enforce document permissions',async()=>{
 const h=await invoiceHarness();try{
  for(const shop of ['shop-a1','shop-a2']){assert.equal((await h.call('sync',{webshopId:shop})).status,200);const r=await h.call('generate',h.input(shop));assert.equal(r.status,200,await r.text());}
  assert.equal(h.objects.size,2);const keys=[...h.objects.keys()];assert.ok(keys.some(k=>k.includes('/shop-a1/')));assert.ok(keys.some(k=>k.includes('/shop-a2/')));
  const pdf=await h.call('pdf?'+new URLSearchParams(h.input('shop-a1')));assert.equal(pdf.status,200);assert.equal((await pdfLib.PDFDocument.load(await pdf.arrayBuffer())).getPageCount(),1);
  assert.equal((await h.call('pdf?'+new URLSearchParams(h.input('shop-a2')),undefined,{user:'local-reader'})).status,403);
  assert.equal((await h.call('pdf?'+new URLSearchParams(h.input('shop-a1')),undefined,{user:'local-b'})).status,403);
  const reader=await(await h.call('',undefined,{user:'local-reader'})).json();assert.deepEqual(reader.orders.map(r=>r.webshop_id),['shop-a1']);
  assert.equal((await h.call('generate',h.input('shop-a1'),{user:'local-reader'})).status,403);
  const original=[...h.objects.values()].map(b=>Buffer.from(b).toString('base64'));
  const reused=await(await h.call('generate',h.input('shop-a1'))).json();assert.equal(reused.existing,true);
  h.order.billingAddress.name='Ændret modtager';const changed=await h.call('generate',h.input('shop-a1'));assert.equal(changed.status,409);assert.match((await changed.json()).error,/bevares/);assert.deepEqual([...h.objects.values()].map(b=>Buffer.from(b).toString('base64')),original);
 }finally{h.close();}
});

test('invoice validation and durable generation claims prevent unsafe retries and duplicate PDFs',async()=>{
 const h=await invoiceHarness();try{
  await h.call('sync',{webshopId:'shop-a1'});h.order.displayFulfillmentStatus='UNFULFILLED';let r=await h.call('generate',h.input('shop-a1'));assert.equal(r.status,409);assert.match((await r.json()).error,/Afventer/);assert.equal(h.objects.size,0);
  h.order.displayFulfillmentStatus='FULFILLED';const responses=await Promise.all([h.call('generate',h.input('shop-a1')),h.call('generate',h.input('shop-a1'))]);assert.ok(responses.some(r=>r.status===200));assert.equal(h.objects.size,1);assert.equal(h.sql.prepare('SELECT count(*) n FROM platform_invoices').get().n,1);
  await h.call('sync',{webshopId:'shop-a2'});h.failStore();assert.equal((await h.call('generate',h.input('shop-a2'))).status,500);assert.equal((await h.call('generate',h.input('shop-a2'))).status,409);assert.equal(h.sql.prepare("SELECT status FROM platform_invoices WHERE webshop_id='shop-a2'").get().status,'generating');
 }finally{h.close();}
});

test('invoice test sends scoped PDF and rendered template only to self, with no retry after uncertainty',async()=>{
 const h=await invoiceHarness();try{
  await h.call('sync',{webshopId:'shop-a1'});await h.call('generate',h.input('shop-a1'));
  const handle=loader({jose,'pdf-lib':pdfLib,fetch:h.network})('platform/invoices.ts').handleInvoices;
  let sends=0,sentMessage;const env={...h.env,PLATFORM_ENV:'remote-test',PLATFORM_MAIL_FROM:'faktura@webshoptoolbox.dk',PLATFORM_MAIL_TEST_RECIPIENTS:'a@example.test',PLATFORM_MAIL_TEST:{send:async m=>{sends++;sentMessage=m;throw Error('uncertain network');}}};
  // Re-encrypt only synthetic Shopify credentials for the remote-test test harness.
  const {seal}=loader()('platform/connections.ts');h.sql.prepare("UPDATE webshop_connections SET credentials_encrypted=? WHERE webshop_id='shop-a1'").run(await seal(env,['company-a','shop-a1','shopify','a1.myshopify.com'],{clientId:'fixture-client',clientSecret:'fixture-secret'}));
  const id=crypto.randomUUID(),actor={id:'local-a',email:'a@example.test',platformAdmin:false};
  const send=()=>handle(new Request('https://dev.example.test/api/platform/companies/company-a/invoices/test',{method:'POST',headers:{origin:'https://dev.example.test','content-type':'application/json'},body:JSON.stringify({...h.input('shop-a1'),mode:'standard',requestId:id})}),env,actor,'company-a','test');
  assert.equal((await(await send()).json()).status,'uncertain');assert.equal((await(await send()).json()).status,'uncertain');assert.equal(sends,1);
  assert.equal(sentMessage.to,'a@example.test');assert.match(sentMessage.subject,/\[TEST\] Faktura TEST-999999 fra Eksempelhandel/);assert.match(sentMessage.text,/Testkunde/);assert.equal(sentMessage.attachments[0].type,'application/pdf');assert.equal((await pdfLib.PDFDocument.load(sentMessage.attachments[0].content)).getPageCount(),1);
  assert.equal(h.sql.prepare('SELECT status FROM mail_test_deliveries WHERE request_id=?').get(id).status,'uncertain');
 }finally{h.close();}
});

test('demo invoice email matches saved preview, accepts a validated recipient and remains idempotent',async()=>{
 const h=await invoiceHarness();try{
  const handle=loader({jose,'pdf-lib':pdfLib,fetch:async()=>{throw Error('Demo must not contact Shopify');}})('platform/invoices.ts').handleInvoices;
  let sends=0,message;
  const env={...h.env,PLATFORM_ENV:'remote-test',PLATFORM_MAIL_FROM:'faktura@webshoptoolbox.dk',PLATFORM_MAIL_TEST_RECIPIENTS:'a@example.test',PLATFORM_MAIL_TEST:{send:async m=>{sends++;message=m;return {messageId:'demo-receipt'};}}};
  const actor={id:'local-a',email:'a@example.test',platformAdmin:false},requestId=crypto.randomUUID();
  const recipient='customer@example.test';
  const send=(to=recipient,webshopId='shop-a1',who=actor)=>handle(new Request('https://dev.example.test/demo',{method:'POST',headers:{origin:'https://dev.example.test','content-type':'application/json'},body:JSON.stringify({recipient:to,webshopId,requestId})}),env,who,'company-a','example-test');
  const preview=await handle(new Request('https://dev.example.test/preview?webshopId=shop-a1'),env,actor,'company-a','preview');assert.equal(preview.status,200);
  assert.equal((await(await send()).json()).status,'accepted');
  assert.equal((await(await send()).json()).status,'accepted');assert.equal(sends,1);
  assert.deepEqual(Buffer.from(message.attachments[0].content),Buffer.from(await preview.arrayBuffer()));
  assert.equal(message.from.name,'Eksempelhandel ApS');assert.match(message.subject,/TEST · DEMO/);assert.match(message.text,/Eksempelkunde/);assert.equal(message.attachments[0].filename,'eksempelfaktura.pdf');
  assert.equal(message.to,recipient);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM platform_invoices').get().n,0);
  assert.equal(h.objects.size,0);assert.equal(h.calls,0);
  await assert.rejects(()=>send('ikke-en-mail'),/gyldig mailadresse/);
  await assert.rejects(()=>send('someone@example.test','shop-a1',{...actor,support:{adminId:'local-admin'}}),/supportadgang/);
  await assert.rejects(()=>send(actor.email,'shop-b1'));
 }finally{h.close();}
});

test('unified demo test verifies a pending custom sender and never falls back on failure',async()=>{
 const h=await invoiceHarness();try{
  let calls=0,fail=false;
  const modules=loader({jose,'pdf-lib':pdfLib,fetch:async(url,options)=>{
   calls++;assert.match(url,/api.cloudflare.com/);const body=JSON.parse(options.body);
   assert.equal(body.from.address,'invoice@a.example.test');assert.equal(body.to,'demo@example.test');assert.equal(body.attachments[0].filename,'eksempelfaktura.pdf');
   if(fail)throw Error('timeout');return Response.json({success:true,result:{queued:['demo@example.test']}});
  }});
  const env={...h.env,PLATFORM_ENV:'remote-test',PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32),PLATFORM_MAIL_TEST:{send:async()=>{throw Error('Standard sender must not be used');}}};
  const actor={id:'local-a',email:'a@example.test',platformAdmin:false};
  await modules('platform/mail.ts').handleMail(new Request('https://dev.example.test/sender',{method:'PUT',headers:{origin:'https://dev.example.test','content-type':'application/json'},body:JSON.stringify({senderName:'A',customFrom:'invoice@a.example.test',accountId:'a'.repeat(32),apiToken:'synthetic-token-123456789'})}),env,actor,'company-a');
  assert.equal(h.sql.prepare('SELECT verified_revision FROM company_mail').get().verified_revision,null);
  const send=id=>modules('platform/invoices.ts').handleInvoices(new Request('https://dev.example.test/demo',{method:'POST',headers:{origin:'https://dev.example.test','content-type':'application/json'},body:JSON.stringify({recipient:'demo@example.test',webshopId:'shop-a1',requestId:id})}),env,actor,'company-a','example-test');
  const id=crypto.randomUUID();assert.equal((await(await send(id)).json()).status,'accepted');
  const saved=h.sql.prepare('SELECT * FROM company_mail').get();assert.equal(saved.revision,saved.verified_revision);
  assert.equal((await(await send(id)).json()).status,'accepted');assert.equal(calls,1);
  h.sql.prepare('UPDATE mail_test_deliveries SET created_at=0').run();fail=true;
  const failedId=crypto.randomUUID();assert.equal((await(await send(failedId)).json()).status,'uncertain');
  assert.equal(h.sql.prepare('SELECT verified_revision FROM company_mail').get().verified_revision,null);
  assert.equal((await(await send(failedId)).json()).status,'uncertain');assert.equal(calls,2);
 }finally{h.close();}
});

test('Shopify invoice pagination rejects repeated cursors and changed line revisions',async()=>{
 const access={shop:'a1.myshopify.com',accessToken:'fixture-token'};
 const repeated=loader({fetch:async()=>Response.json({data:{orders:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'same'}}}})})('platform/invoice-source.ts');
 await assert.rejects(()=>repeated.listInvoiceOrders(access,'same','2026-01-01'),/fuldstændigt/);
 const order=fixture();order.lineItems.pageInfo={hasNextPage:true,endCursor:'line-cursor'};
 const changed=loader({fetch:async()=>Response.json({data:{order:{id:order.id,updatedAt:'changed'}}})})('platform/invoice-source.ts');
 await assert.rejects(()=>changed.completeOrder(order,access),/ændret under kontrollen/);
});
const customerEnv={PLATFORM_CUSTOMER_LOGIN:'enabled',PLATFORM_LOGIN_SECRET:'ab'.repeat(32)};
const feedSettings={name:'PartnerAds test',service:'partnerads',enabled:false,allProducts:false,collections:[{id:'gid://shopify/Collection/42',title:'Kollektion'}],products:[{id:'gid://shopify/Product/1',title:'Produkt'}],shippingCost:'39.00',freeShippingFrom:'100.00',deliveryTime:'1-3 hverdage',category:''};
function feedFixture(){
 const state={fail:false,repeat:false,calls:0,paginate:false};
 const variant=(id,price='99.00',sale=true)=>({id:'gid://shopify/ProductVariant/'+id,barcode:'123',title:'Default Title',price,compareAtPrice:'89.00',availableForSale:sale,inventoryQuantity:3,selectedOptions:[{name:'Farve',value:'Rød'}],image:null});
 const p={id:'gid://shopify/Product/1',status:'ACTIVE',title:'Sabel & glas',handle:'sabel',descriptionHtml:'<p>Flot &amp; fin</p><script>bad()</script>',vendor:'Firma',featuredImage:{url:'https://example.test/image.png'},gender:null,productType:'Gaver',variants:{nodes:[variant('1'),variant('2','150.00'),variant('3','80.00',false)],pageInfo:{hasNextPage:false,endCursor:null}}};
 const h=harness(jose,async(url,opt)=>{
  state.calls++;assert.equal(opt.redirect,'manual');assert.match(url,/^https:\/\/shop-[ab][12]\.myshopify\.com\//);
  if(state.fail)throw Error('Synthetic provider failure');
  if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'synthetic'});
  const {query,variables}=JSON.parse(opt.body);assert.match(query,/^query /);assert.doesNotMatch(query,/mutation/);
  if(query.includes('FeedShop'))return Response.json({data:{shop:{currencyCode:'DKK',primaryDomain:{url:'https://'+new URL(url).hostname}}}});
  if(query.includes('FeedCatalog'))return Response.json({data:{collections:{nodes:[{id:'gid://shopify/Collection/42',title:'Kollektion'}],pageInfo:{hasNextPage:false,endCursor:null}}}});
  if(query.includes('FeedVariants'))return Response.json({data:{product:{variants:{nodes:[variant('4','179.00')],pageInfo:{hasNextPage:false,endCursor:null}}}}});
  if(state.paginate)p.variants.pageInfo={hasNextPage:true,endCursor:'variant-next'};
  if(query.includes('FeedSelected'))return Response.json({data:{nodes:variables.ids.map(()=>p)}});
  if(query.includes('FeedCollection'))return Response.json({data:{collection:{title:'Kollektion',products:{nodes:[p,{...p,id:'gid://shopify/Product/2',status:'DRAFT'}],pageInfo:{hasNextPage:state.repeat,endCursor:state.repeat?'same':null}}}}});
  throw Error('Unexpected feed query');
 });
 const objects=new Map(),env={...h.env,PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32),PLATFORM_DOCUMENTS:{put:async(k,v)=>objects.set(k,v),get:async k=>objects.has(k)?{body:objects.get(k)}:null}};
 const call=(path='',method='GET',body,shop='shop-a1',user='local-a')=>h.request('/api/platform/tier1/shops/'+shop+'/feeds'+path,{method,body,user,env});
 return {...h,state,objects,env,call,p};
}
test('product feeds isolate tenants and overlapping IDs; PartnerAds preserves pricing, selection and public revocation',async()=>{
 const h=feedFixture();try{
  await testShopConnections(h,h.env);
  assert.equal((await h.call('','GET',undefined,'shop-b1')).status,404);
  assert.equal((await h.call('','POST',feedSettings,'shop-a1','local-reader')).status,403);
  assert.equal((await h.call('','POST',feedSettings,'shop-a1','local-admin')).status,403);
  const response=await h.call('','POST',feedSettings);assert.equal(response.status,201,await response.clone().text());let f=await response.json();
  const publicPath=new URL(f.url).pathname;
  assert.equal((await h.request(publicPath,{auth:false,env:h.env})).status,404);
  assert.equal((await h.call('/'+f.id+'/refresh','POST',{revision:f.revision})).status,200);
  let xml=await h.call('/'+f.id+'/preview');assert.equal(xml.status,200);const body=await xml.text();
  assert.equal((body.match(/<produkt>/g)||[]).length,2);assert.match(body,/<variantid>1<\/variantid>/);assert.match(body,/<gammelpris>99.00<\/gammelpris>/);assert.match(body,/<fragtomk>0<\/fragtomk>/);assert.match(body,/<fragtomk>39.00<\/fragtomk>/);assert.match(body,/Sabel &amp; glas/);assert.doesNotMatch(body,/bad\(\)|<script>/);
  assert.equal((await h.call('/'+f.id+'/preview','GET',undefined,'shop-a2')).status,404);
  const second=await(await h.call('','POST',feedSettings,'shop-a2')).json();assert.equal((await h.call('/'+second.id+'/refresh','POST',{revision:1},'shop-a2')).status,200);assert.equal(h.objects.size,2);assert.ok([...h.objects.keys()].some(k=>k.includes('/shop-a2/')));
  assert.equal((await h.call('/'+f.id,'PUT',{...feedSettings,enabled:true,revision:f.revision})).status,200);
  h.sql.exec('UPDATE product_feeds SET last_attempt=0');
  xml=await h.request(publicPath,{auth:false,env:h.env});assert.equal(xml.status,200,await xml.clone().text());assert.match(xml.headers.get('content-type'),/application\/xml/);assert.match(xml.headers.get('x-robots-tag'),/noindex/);
  const calls=h.state.calls;assert.equal((await h.request(publicPath,{auth:false,env:h.env})).status,200);assert.equal(h.state.calls,calls);
  f=(await(await h.call()).json()).feeds.find(x=>x.id===f.id);
  assert.equal((await h.call('/'+f.id,'PUT',{...feedSettings,revision:1})).status,409);
  const rotated=await(await h.call('/'+f.id+'/rotate','POST',{revision:f.revision})).json();assert.notEqual(rotated.url,f.url);assert.equal((await h.request(publicPath,{auth:false,env:h.env})).status,404);
  assert.equal((await h.request(new URL(rotated.url).pathname,{auth:false,env:h.env})).status,200);
  assert.equal((await h.call('/'+f.id,'PUT',{...feedSettings,revision:rotated.revision})).status,200);
  assert.equal((await h.request(new URL(rotated.url).pathname,{auth:false,env:h.env})).status,404);
 }finally{h.close();}
});
test('feed failures keep the last good snapshot; incomplete pagination never publishes and CSRF is enforced',async()=>{
 const h=feedFixture();try{
  await testShopConnections(h,h.env);
  let f=await(await h.call('','POST',feedSettings)).json();
  assert.equal((await h.call('/'+f.id+'/refresh','POST',{revision:1})).status,200);const previous=[...h.objects.values()][0];
  h.sql.exec('UPDATE product_feeds SET last_attempt=0');h.state.fail=true;
  assert.equal((await h.call('/'+f.id+'/refresh','POST',{revision:1})).status,503);assert.equal(h.objects.size,1);assert.equal(await(await h.call('/'+f.id+'/preview')).text(),previous);
  h.state.fail=false;h.state.repeat=true;h.sql.exec('UPDATE product_feeds SET last_attempt=0');assert.equal((await h.call('/'+f.id+'/refresh','POST',{revision:1})).status,409);assert.equal(h.objects.size,1);
  assert.equal((await h.request('/api/platform/tier1/shops/shop-a1/feeds',{user:'local-a',method:'POST',body:feedSettings,csrfOrigin:'https://foreign.test',env:h.env})).status,403);
  for(const bad of [{service:'other'},{shippingCost:'NaN'},{allProducts:false,products:[],collections:[]}])assert.equal((await h.call('','POST',{...feedSettings,...bad})).status,400);
  h.state.repeat=false;const catalog=await h.call('/catalog?kind=collections');assert.equal(catalog.status,200);
 }finally{h.close();}
});
test('feeds paginate variants, serialize refreshes and stop public access after company deactivation',async()=>{
 const h=feedFixture();try{
  await testShopConnections(h,h.env);h.state.paginate=true;
  const f=await(await h.call('','POST',{...feedSettings,enabled:true})).json();
  const results=await Promise.all([h.call('/'+f.id+'/refresh','POST',{revision:1}),h.call('/'+f.id+'/refresh','POST',{revision:1})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(h.objects.size,1);
  const xml=await(await h.call('/'+f.id+'/preview')).text();assert.equal((xml.match(/<produkt>/g)||[]).length,3);assert.match(xml,/<variantid>4<\/variantid>/);
  h.sql.exec("UPDATE companies SET status='inactive' WHERE id='company-a'");
  assert.equal((await h.request(new URL(f.url).pathname,{auth:false,env:h.env})).status,404);
 }finally{h.close();}
});
function customerRequest(h,path,options={}){return h.request(path,{auth:false,...options,env:{...customerEnv,...options.env}});}
async function customerStart(h,email='a@example.test',extra={}){
 const response=await customerRequest(h,'/auth/start',{method:'POST',body:{email,...extra}});
 assert.equal(response.status,200,await response.clone().text());
 return {...await response.json(),cookie:response.headers.get('set-cookie').split(';')[0]};
}
async function customerVerify(h,start,extra={}){return customerRequest(h,'/auth/verify',{method:'POST',headers:{cookie:start.cookie},body:{challenge:start.challenge,code:start.previewCode,...extra}});}
test('customer login isolates Tier 0 and tenants, ignores Access on public routes and revokes logout',async()=>{
 const h=harness();try{
  assert.equal((await customerRequest(h,'/')).headers.get('location'),'/login');
  assert.equal((await customerRequest(h,'/api/platform/me',{auth:true})).status,401);
  assert.equal((await customerRequest(h,'/admin/api/platform/me',{auth:true})).status,200);
  assert.equal((await customerRequest(h,'/admin/api/platform/me',{auth:true,user:'local-a'})).status,403);
  const start=await customerStart(h);const result=await customerVerify(h,start);
  assert.equal(result.status,200,await result.clone().text());
  const session=result.headers.getSetCookie().find(c=>c.startsWith('__Host-toolbox_session=')).split(';')[0];
  assert.match(result.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
  const me=await customerRequest(h,'/api/platform/me',{headers:{cookie:session}});assert.equal(me.status,200);assert.equal((await me.json()).user.platformAdmin,false);
  assert.equal((await customerRequest(h,'/api/platform/companies/company-b/webshops',{headers:{cookie:session}})).status,403);
  assert.equal((await customerRequest(h,'/admin/api/platform/me',{headers:{cookie:session}})).status,401);
  assert.equal((await customerVerify(h,start)).status,401);
  assert.equal((await customerRequest(h,'/logout',{method:'POST',headers:{cookie:session,origin:'http://127.0.0.1:8790'}})).status,303);
  assert.equal((await customerRequest(h,'/api/platform/me',{headers:{cookie:session}})).status,401);
 }finally{h.close();}
});
test('customer login hides unknown and admin identities, binds browser, expires and locks codes',async()=>{
 const h=harness();try{
  for(const email of ['missing@example.test','admin@example.test']){const s=await customerStart(h,email);assert.equal(s.previewCode,undefined);assert.equal((await customerVerify(h,{...s,previewCode:'12345678'})).status,401);}
  const s=await customerStart(h);
  assert.equal((await customerVerify(h,{...s,cookie:'__Host-toolbox_challenge=wrong'})).status,401);
  for(let i=0;i<5;i++)assert.equal((await customerVerify(h,s,{code:s.previewCode==='00000000'?'11111111':'00000000'})).status,401);
  assert.equal((await customerVerify(h,s)).status,401);
  const expired=await customerStart(h,'b@example.test');h.sql.prepare('UPDATE customer_login_challenges SET expires_at=0 WHERE id=?').run(expired.challenge);
  assert.equal((await customerVerify(h,expired)).status,401);
  assert.equal((await customerRequest(h,'/auth/start',{method:'POST',csrfOrigin:'https://attacker.test',body:{email:'a@example.test'}})).status,403);
 }finally{h.close();}
});
test('customer login enforces throttling and company deactivation invalidates sessions',async()=>{
 const h=harness();try{
  const start=await customerStart(h,'reader@example.test'),login=await customerVerify(h,start);assert.equal(login.status,200);
  const session=login.headers.getSetCookie()[0].split(';')[0];
  h.sql.exec("UPDATE companies SET status='inactive' WHERE id='company-a'");
  assert.equal((await customerRequest(h,'/api/platform/me',{headers:{cookie:session}})).status,401);
  for(let i=0;i<3;i++)await customerStart(h,'b@example.test');
  assert.equal((await customerRequest(h,'/auth/start',{method:'POST',body:{email:'b@example.test'}})).status,429);
 }finally{h.close();}
});
test('customer login invitation activates only invited company membership and records name',async()=>{
 const h=harness();try{
  const invitation=await h.request('/api/platform/companies/company-a/users',{method:'POST',body:{email:'new@example.test',role:'member'}});assert.equal(invitation.status,201);
  const data=await invitation.json(),token=new URL(data.previewLink).searchParams.get('invitation');
  const s=await customerStart(h,'new@example.test',{invitation:token});assert.ok(s.previewCode);
  assert.equal((await customerVerify(h,s,{name:'New Customer'})).status,200);
  const user=h.sql.prepare('SELECT full_name,status,company_id FROM users WHERE id=?').get(data.id);
  assert.equal(user.full_name,'New Customer');assert.equal(user.status,'active');assert.equal(user.company_id,'company-a');
  assert.equal((await customerVerify(h,s,{name:'New Customer'})).status,401);
 }finally{h.close();}
});
test('customer login revoked invitation cannot create a session; secret and mail errors fail closed',async()=>{
 const h=harness();try{
  const invitation=await h.request('/api/platform/companies/company-a/users',{method:'POST',body:{email:'new@example.test'}}),data=await invitation.json();
  const s=await customerStart(h,'new@example.test',{invitation:new URL(data.previewLink).searchParams.get('invitation')});
  h.sql.exec("UPDATE invitations SET state='revoked'");
  assert.equal((await customerVerify(h,s,{name:'New Customer'})).status,401);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM customer_sessions').get().n,0);
  assert.equal((await customerRequest(h,'/auth/start',{method:'POST',body:{email:'a@example.test'},env:{PLATFORM_LOGIN_SECRET:undefined}})).status,503);
 }finally{h.close();}
});
test('customer login mail is known-recipient only, no remote preview and no uncertain resend',async()=>{
 const h=harness();try{
  h.sql.exec("UPDATE users SET email='rj@itm8.com' WHERE id='local-a'");let sends=0;
  const env={...customerEnv,PLATFORM_ENV:'remote-test',PLATFORM_AUTH:'cloudflare-access',PLATFORM_AUTH_MAIL:{send:async m=>{sends++;assert.equal(m.to,'rj@itm8.com');assert.equal(m.from.email,'no-reply@webshoptoolbox.dk');assert.match(m.text,/\d{8}/);throw Error('timeout');}}};
  for(const email of ['rj@itm8.com','b@example.test','unknown@example.test']){
   const response=await customerRequest(h,'/auth/start',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.1'},body:{email},env});assert.equal(response.status,200);assert.equal((await response.json()).previewCode,undefined);
  }
  assert.equal(sends,1);assert.equal(h.sql.prepare("SELECT count(*) n FROM customer_login_challenges WHERE delivery='uncertain'").get().n,1);
  assert.equal(h.sql.prepare("SELECT length(code_hash) n FROM customer_login_challenges LIMIT 1").get().n,64);
 }finally{h.close();}
});
test('customer login absolute and idle expiry, user deactivation, browser and environment boundaries',async()=>{
 const h=harness();try{
  const s=await customerStart(h,'reader@example.test');
  assert.equal((await customerRequest(h,'/auth/verify',{method:'POST',headers:{cookie:s.cookie,'cf-connecting-ip':'192.0.2.1'},body:{challenge:s.challenge,code:s.previewCode},env:{PLATFORM_ENV:'remote-test',PLATFORM_AUTH:'cloudflare-access'}})).status,401);
  const response=await customerVerify(h,s);assert.equal(response.status,200);const cookie=response.headers.getSetCookie()[0].split(';')[0];
  h.sql.exec('UPDATE customer_sessions SET last_seen=0');assert.equal((await customerRequest(h,'/api/platform/me',{headers:{cookie}})).status,401);
  h.sql.exec('UPDATE customer_sessions SET last_seen=9999999999,expires_at=0');assert.equal((await customerRequest(h,'/api/platform/me',{headers:{cookie}})).status,401);
  h.sql.exec("UPDATE users SET status='inactive' WHERE id='local-reader'");assert.equal(h.sql.prepare('SELECT count(*) n FROM customer_sessions').get().n,0);
  assert.equal((await customerRequest(h,'/auth/start',{origin:'https://public.test',method:'POST',body:{email:'a@example.test'}})).status,503);
 }finally{h.close();}
});
test('customer login configuration keeps dev mail restricted and production transactional mail separate',()=>{
 const config=JSON.parse(read('wrangler.platform-test.json'));assert.doesNotThrow(()=>validateConfig(config,true));
 delete config.send_email[2].allowed_destination_addresses;assert.throws(()=>validateConfig(config,true));
});

test('customer login incomplete profile still boots customer UI and cannot use support actions',async()=>{
 const h=harness();try{
 h.sql.exec("UPDATE users SET full_name=NULL WHERE id='local-reader'");const s=await customerStart(h,'reader@example.test'),response=await customerVerify(h,s);assert.equal(response.status,200);const cookie=response.headers.getSetCookie()[0].split(';')[0];
 assert.equal((await customerRequest(h,'/api/platform/support',{headers:{cookie}})).status,200);
 assert.equal((await customerRequest(h,'/api/platform/me',{headers:{cookie}})).status,200);
 assert.equal((await customerRequest(h,'/api/platform/support',{method:'POST',headers:{cookie},body:{}})).status,403);
 assert.equal((await customerRequest(h,'/api/platform/profile',{method:'POST',headers:{cookie},body:{name:'Customer Name'}})).status,200);
 }finally{h.close();}
});
test('admin hostname keeps authentication, redirects old GET routes and rejects customer flows',async()=>{
 const h=harness();try{
 const env={...customerEnv,PLATFORM_ENV:'remote-test',PLATFORM_AUTH:'cloudflare-access',PLATFORM_ADMIN_HOST:'admin.webshoptoolbox.dk',PLATFORM_ACCESS_ISSUER:'https://test.cloudflareaccess.com',PLATFORM_ACCESS_AUD:'ab'.repeat(32)};
 const request=(path,options={})=>h.request(path,{auth:false,origin:'https://admin.webshoptoolbox.dk',env,...options});
 assert.equal((await request('/')).headers.get('location'),'/admin/');
 assert.equal((await request('/admin/api/platform/me')).status,401);
 assert.equal((await request('/auth/start',{method:'POST',body:{email:'a@example.test'}})).status,404);
 const old=await request('/admin/onboarding?invitation=test',{origin:'https://dev.webshoptoolbox.dk'});
 assert.equal(old.status,303);assert.equal(old.headers.get('location'),'https://admin.webshoptoolbox.dk/admin/onboarding?invitation=test');
 assert.equal((await request('/admin/api/platform/companies',{origin:'https://dev.webshoptoolbox.dk',method:'POST',body:{}})).status,403);
 for(const path of ['/','/admin/api/platform/me','/robots.txt','/login'])assert.match((await request(path)).headers.get('x-robots-tag'),/noindex/);
 }finally{h.close();}
});
test('portal pages exclude search indexing and customer login has no Tier 0 link',async()=>{
 const h=harness();try{
 for(const file of ['login.html','index.html','onboarding.html'])assert.match(read('platform/public/'+file),/name="robots" content="noindex, nofollow, noarchive"/);
 assert.doesNotMatch(read('platform/public/login.html'),/href="\/admin/);
 const response=await h.request('/robots.txt',{auth:false});assert.equal(response.status,200);assert.match(response.headers.get('x-robots-tag'),/noindex/);
 const config=JSON.parse(read('wrangler.platform-test.json'));config.vars.PLATFORM_ADMIN_HOST='admin.webshoptoolbox.dk';config.routes.push({pattern:'admin.webshoptoolbox.dk',custom_domain:true});assert.doesNotThrow(()=>validateConfig(config,true));config.vars.PLATFORM_ADMIN_HOST='other.example';assert.throws(()=>validateConfig(config,true));
 }finally{h.close();}
});

test('support tickets isolate companies and preserve replies with optimistic concurrency',async()=>{
 const h=harness();try{
 const base='/api/platform/companies/company-a/tickets';
 const created=await h.request(base,{user:'local-a',method:'POST',body:{subject:'Test af faktura',message:'Kan I hjælpe med PDF?'}});assert.equal(created.status,201);const {id}=await created.json();
 assert.equal((await h.request('/api/platform/tickets',{user:'local-a'})).status,403);
 assert.equal((await h.request(base+'/'+id,{user:'local-b'})).status,403);
 assert.equal((await h.request('/api/platform/companies/company-b/tickets/'+id,{user:'local-b'})).status,404);
 const queue=await(await h.request('/api/platform/tickets')).json();assert.equal(queue.tickets.length,1);
 const reply=await h.request('/api/platform/tickets/'+id,{method:'PATCH',body:{version:1,message:'Vi undersøger det.'}});assert.equal(reply.status,200);
 const detail=await(await h.request(base+'/'+id,{user:'local-reader'})).json();assert.equal(detail.ticket.status,'waiting_customer');assert.equal(detail.messages.length,2);assert.equal(detail.messages[1].author_kind,'support');
 assert.equal((await h.request(base+'/'+id,{user:'local-a',method:'PATCH',body:{version:1,message:'Forældet svar'}})).status,409);
 assert.equal((await h.request(base+'/'+id,{user:'local-a',method:'PATCH',body:{version:2,priority:'high'}})).status,403);
 assert.equal((await h.request(base+'/'+id,{user:'local-a',method:'PATCH',body:{version:2,message:'Tak for hjælpen'}})).status,200);
 assert.equal((await h.request(base+'/'+id,{user:'local-a',method:'PATCH',body:{version:3,status:'resolved'}})).status,200);
 const resolved=await(await h.request(base+'/'+id,{user:'local-a'})).json();assert.equal(resolved.ticket.status,'resolved');assert.equal(resolved.messages.length,3);
 assert.equal((await h.request(base,{user:'local-a',method:'POST',csrfOrigin:'https://other.example',body:{subject:'x',message:'y'}})).status,403);
 assert.equal((await h.request(base,{user:'local-a',method:'POST',body:{subject:'x',message:'y'.repeat(6001)}})).status,400);
 }finally{h.close();}
});
test('invoice template accepts 4000 characters and latest test fails safely without a PDF',async()=>{
 const h=harness();try{
 const base='/api/platform/companies/company-a/invoices';
 const settings={name:'Firma',address:'Testvej 1',cvr:'12345678',contact:'test@example.test',months:3,subject:'Faktura {{fakturanummer}}',body:'a'.repeat(4000)};
 assert.equal((await h.request(base+'/settings',{user:'local-a',method:'PUT',body:settings})).status,200);
 assert.equal((await(await h.request(base+'/settings',{user:'local-a'})).json()).body.length,4000);
 assert.equal((await h.request(base+'/settings',{user:'local-a',method:'PUT',body:{...settings,body:'a'.repeat(4001)}})).status,400);
 assert.equal((await h.request(base+'/test-latest',{user:'local-a',method:'POST',body:{requestId:crypto.randomUUID(),mode:'standard'}})).status,409);
 }finally{h.close();}
});

test('operation snapshots isolate identical IDs, reject writes by readers and reject incomplete pages',async()=>{
 let mode='normal',calls=0;
 const order={id:'gid://shopify/Order/42',name:'#42',createdAt:new Date().toISOString(),test:false,currentTotalPriceSet:{shopMoney:{amount:'125.00',currencyCode:'DKK'}}};
 const network=async(url,opt)=>{calls++;assert.equal(opt.redirect,'manual');if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture-token'});const {query}=JSON.parse(opt.body);assert.doesNotMatch(query,/mutation/);return Response.json({data:{orders:{nodes:mode==='duplicate'?[order,order]:[order],pageInfo:{hasNextPage:mode==='cursor',endCursor:mode==='cursor'?'repeat':null}}}});};
 const h=harness(jose,network),env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)};try{
 const {seal}=loader()('platform/connections.ts');for(const shop of ['shop-a1','shop-a2'])h.sql.prepare('INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)').run('company-a',shop,'shopify','a.myshopify.com'.replace('a.',shop+'.'),await seal({...h.env,...env},['company-a',shop,'shopify',shop+'.myshopify.com'],{clientId:'test',clientSecret:'secret'}));
 const base=s=>'/api/platform/companies/company-a/webshops/'+s+'/data/orders';
 for(const shop of ['shop-a1','shop-a2']){const response=await h.request(base(shop),{user:'local-a',env,method:'POST',body:{}});assert.equal(response.status,200,await response.text());}
 assert.equal(h.sql.prepare('SELECT count(*) n FROM operation_snapshots').get().n,2);
 const before=calls;assert.equal((await h.request(base('shop-a2'),{user:'local-reader'})).status,403);assert.equal((await h.request(base('shop-a1'),{user:'local-b'})).status,403);assert.equal((await h.request(base('shop-a1'),{user:'local-reader',env,method:'POST',body:{}})).status,403);assert.equal(calls,before);
 const own=await(await h.request(base('shop-a1'),{user:'local-reader'})).json();assert.equal(own.rows.length,1);
 mode='cursor';assert.equal((await h.request(base('shop-a1'),{user:'local-a',env,method:'POST',body:{after:'repeat'}})).status,409);
 mode='duplicate';assert.equal((await h.request(base('shop-a1'),{user:'local-a',env,method:'POST',body:{}})).status,409);
 assert.equal(h.sql.prepare("SELECT count(*) n FROM operation_runs WHERE status='failed'").get().n,2);assert.equal(h.sql.prepare('SELECT count(*) n FROM operation_snapshots').get().n,2);
 }finally{h.close();}
});
test('Dinero connection only reads, encrypts credentials and scopes chart and mappings',async()=>{
 const calls=[];const h=harness(jose,async(url,opt)=>{calls.push({url,method:opt.method||'GET'});assert.equal(opt.redirect,'manual');if(url.includes('/oauth/token'))return Response.json({access_token:'fixture-token'});return Response.json([{AccountNumber:1000,Name:'Salg',VatCode:'U25'}]);});const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)};try{
 const base='/api/platform/companies/company-a/accounting',credentials={organizationId:'123',clientId:'test',clientSecret:'secret',apiKey:'test-key'};
 assert.equal((await h.request(base+'/connection',{user:'local-reader',env,method:'PUT',body:credentials})).status,403);assert.equal(calls.length,0);
 const saved=await h.request(base+'/connection',{user:'local-a',env,method:'PUT',body:credentials});assert.equal(saved.status,200,await saved.text());
 assert.ok(calls.every(c=>c.method==='GET'||c.url==='https://authz.dinero.dk/dineroapi/oauth/token'));
 const info=await(await h.request(base+'/connection',{user:'local-a'})).json();assert.equal(info.accounts.length,1);assert.ok(!JSON.stringify(info).includes('test-key'));assert.ok(!h.sql.prepare('SELECT credentials_encrypted FROM accounting_connections').get().credentials_encrypted.includes('test-key'));
 assert.equal((await h.request(base+'/connection',{user:'local-b'})).status,403);
 assert.equal((await h.request(base+'/mapping',{user:'local-a',method:'PUT',body:{revision:info.revision,mapping:{goodsVat:'1000 - Salg',vatCode:'U25'}}})).status,200);
 assert.equal((await h.request(base+'/mapping',{user:'local-a',method:'PUT',body:{revision:info.revision,mapping:{goodsVat:'9999 - Forged'}}})).status,400);
 assert.equal((await h.request(base+'/connection',{user:'local-a',env,method:'PUT',body:{...credentials,organizationId:'456'}})).status,409);
 }finally{h.close();}
});
test('packaging validates calendar dates, scopes data and preserves revision conflicts',async()=>{
 const h=harness();try{const base='/api/platform/companies/company-a/webshops/shop-a1/packaging',entry={action:'save',date:'2026-01-01',description:'Kasser',supplier:'Test',supplierCountry:'DK',supplierCvr:'',weightGrams:1000,reportable:'yes',audience:'household'};
 assert.equal((await h.request(base,{user:'local-reader',method:'POST',body:entry})).status,403);
 assert.equal((await h.request(base,{user:'local-a',method:'POST',body:{...entry,date:'2026-02-31'}})).status,400);
 const saved=await h.request(base,{user:'local-a',method:'POST',body:entry});assert.equal(saved.status,200);const {id}=await saved.json();
 assert.equal((await h.request(base,{user:'local-b'})).status,403);
 const data=await(await h.request(base+'?from=2026-01-01&to=2026-12-31',{user:'local-reader'})).json();assert.equal(data.period.householdGrams,1000);
 assert.equal((await h.request(base,{user:'local-a',method:'POST',body:{...entry,id,version:1,weightGrams:2000}})).status,200);
 assert.equal((await h.request(base,{user:'local-a',method:'POST',body:{...entry,id,version:1}})).status,409);
 }finally{h.close();}
});

test('payout documents reconcile transactions, scope PDFs and preserve generation claims',async()=>{
 const payoutId='gid://shopify/ShopifyPaymentsPayout/77';
 const {payoutSummaryFields}=loader()('platform/payout-calculations.ts');
 const summary=Object.fromEntries(payoutSummaryFields.map(f=>[f,{amount:'0.00',currencyCode:'DKK'}]));summary.chargesGross.amount='100.00';summary.chargesFee.amount='2.00';
 const source={id:payoutId,issuedAt:'2026-09-01T12:00:00Z',status:'PAID',transactionType:'DEPOSIT',net:{amount:'98.00',currencyCode:'DKK'},summary};
 let mismatch=false,failStore=false;
 const h=harness(jose,async(url,opt)=>{assert.equal(opt.redirect,'manual');if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});if(url.includes('/balance/transactions.json'))return Response.json({transactions:[{id:1,type:'charge',test:false,payout_id:77,currency:'DKK',amount:'100.00',fee:'2.00',net:mismatch?'97.00':'98.00',source_type:'charge',source_order_id:42,processed_at:'2026-09-01T08:00:00Z'}]});assert.doesNotMatch(JSON.parse(opt.body).query,/mutation/);return Response.json({data:{nodes:[{id:'gid://shopify/Order/42',name:'#42'}]}});});
 const objects=new Map(),env={...h.env,PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32),PLATFORM_DOCUMENTS:{put:async(k,b)=>{if(failStore)throw Error('failed');objects.set(k,b);},get:async k=>objects.has(k)?{body:objects.get(k)}:null}};
 try{
 const {seal}=loader()('platform/connections.ts');for(const shop of ['shop-a1','shop-a2']){const domain=shop+'.myshopify.com';h.sql.prepare('INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)').run('company-a',shop,'shopify',domain,await seal(env,['company-a',shop,'shopify',domain],{clientId:'test',clientSecret:'secret'}));h.sql.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').run('company-a',shop,'payouts',payoutId,source.issuedAt,JSON.stringify(source));}
 const base=shop=>'/api/platform/companies/company-a/webshops/'+shop+'/documents';
 mismatch=true;assert.equal((await h.request(base('shop-a1'),{env,user:'local-a',method:'POST',body:{externalId:payoutId}})).status,409);assert.equal(objects.size,0);
 mismatch=false;const generated=await h.request(base('shop-a1'),{env,user:'local-a',method:'POST',body:{externalId:payoutId}});assert.equal(generated.status,200,await generated.clone().text());const {id}=await generated.json();
 assert.equal((await pdfLib.PDFDocument.load([...objects.values()][0])).getPageCount(),2);
 assert.ok([...objects.keys()][0].startsWith('companies/company-a/webshops/shop-a1/'));
 assert.equal((await h.request(base('shop-a1')+'?id='+id,{env,user:'local-b'})).status,403);
 assert.equal((await h.request(base('shop-a2')+'?id='+id,{env,user:'local-a'})).status,404);
 assert.equal((await h.request(base('shop-a1')+'?id='+id,{env,user:'local-reader'})).status,200);
 assert.equal((await(await h.request(base('shop-a1'),{env,user:'local-a',method:'POST',body:{externalId:payoutId}})).json()).existing,true);
 failStore=true;assert.equal((await h.request(base('shop-a2'),{env,user:'local-a',method:'POST',body:{externalId:payoutId}})).status,500);assert.equal((await h.request(base('shop-a2'),{env,user:'local-a',method:'POST',body:{externalId:payoutId}})).status,409);
 }finally{h.close();}
});

test('platform invoice display groups engraving under its physical product without changing financial lines',()=>{
 const {invoiceDisplayLines}=loader()('platform/invoice-line-order.ts');
 const lines=[{kind:'service',title:'Indgravering linje 2',id:'e2'},{kind:'service',title:'Indgravering linje 1',id:'e1'},{kind:'goods',title:'Et generisk produkt',id:'p1'},{kind:'shipping',title:'Fragt',id:'s1'}];
 const before=JSON.stringify(lines);assert.deepEqual(invoiceDisplayLines(lines).map(l=>l.id),['p1','e1','e2','s1']);assert.equal(JSON.stringify(lines),before);
});


test('payment connections bind verified accounts to one shop, encrypt credentials and preserve paid records',async()=>{
 let upcoming=false;const calls=[];
 const h=harness(jose,async(input,init)=>{const url=new URL(input);calls.push([url.pathname,init.method]);assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');
  if(url.pathname.endsWith('/agreements'))return Response.json({agreements:[{id:'agreement',merchantID:'merchant',agreementNumber:'123',currency:'DKK'}]});
  if(url.pathname.endsWith('/payments'))return Response.json({payments:url.searchParams.has('ScheduledDateFrom')?(upcoming?[{paymentID:'42',merchantID:'merchant',agreementNumber:'123',scheduledDate:new Date().toISOString().slice(0,10),paidDate:null,payoutAmount:1,currency:'DKK'}]:[]):[{paymentID:'42',merchantID:'merchant',agreementNumber:'123',paidDate:'2026-09-01',payoutAmount:100,currency:'DKK'},{paymentID:'43',merchantID:'foreign',agreementNumber:'123',paidDate:'2026-09-01',payoutAmount:500,currency:'DKK'}]});throw Error('unexpected provider call');
 });
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},base='/api/platform/companies/company-a/webshops/shop-a1/payments/flatpay';
 const connection={username:'test',password:'synthetic-secret',agreementNumber:'123',startDate:'2026-01-01'};
 try{
  let response=await h.request(base+'/connection',{user:'local-a',env,method:'PUT',body:connection});assert.equal(response.status,200,await response.text());
  assert.doesNotMatch(h.sql.prepare('SELECT credentials_encrypted FROM payment_connections').get().credentials_encrypted,/synthetic-secret/);
  response=await h.request(base+'/connection',{user:'local-reader'});assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/credentials|password|synthetic-secret/);
  response=await h.request(base.replace('shop-a1','shop-a2')+'/connection',{user:'local-a',env,method:'PUT',body:connection});assert.equal(response.status,409);
  assert.equal((await h.request(base+'/connection',{user:'local-b'})).status,403);
  assert.equal((await h.request(base+'/records',{user:'local-reader',env,method:'POST',body:{start:'2026-09-01',end:'2026-09-01',kind:'payments'}})).status,403);
  for(const state of [false,true]){upcoming=state;response=await h.request(base+'/records',{user:'local-a',env,method:'POST',body:{start:'2026-09-01',end:'2026-09-01',kind:'payments'}});assert.equal(response.status,200,await response.text());}
  const rows=(await(await h.request(base+'/records',{user:'local-a'})).json()).rows;assert.equal(rows.length,1);assert.equal(rows[0].payoutAmount,100);assert.equal(rows[0].paidDate,'2026-09-01');
  assert.equal((await h.request(base+'/connection',{user:'local-a',env,method:'PUT',body:{...connection,revision:0}})).status,409);
  const tier1='/api/platform/tier1/shops/shop-a1';
  response=await h.request(tier1+'/integrations/start-date',{user:'local-a',method:'POST',body:{provider:'flatpay',startDate:'2026-02-01',bookingStartDate:'2026-09-01'}});assert.equal(response.status,200);
  const savedRevision=h.sql.prepare("SELECT revision FROM payment_connections WHERE webshop_id='shop-a1'").get().revision;
  response=await h.request(tier1+'/flatpay/connection',{user:'local-a',env,method:'POST',body:{action:'save',username:connection.username,password:connection.password,agreementNumber:connection.agreementNumber,revision:savedRevision}});assert.equal(response.status,200,await response.text());
  assert.equal(h.sql.prepare("SELECT start_date FROM payment_connections WHERE webshop_id='shop-a1'").get().start_date,'2026-02-01');
  assert.equal(h.sql.prepare("SELECT start_date FROM booking_start_dates WHERE webshop_id='shop-a1' AND provider='flatpay'").get().start_date,'2026-09-01');

  assert.ok(calls.length>0);
 }finally{h.close();}
});

test('ViaBill exports isolate identical external IDs and reject foreign continuation cursors',async()=>{
 let exports=0;
 const h=harness(jose,async(input,init)=>{
  const url=new URL(input);assert.equal(url.hostname,'secure.viabill.com');assert.equal(init.redirect,'manual');assert.match(url.pathname,/entries\/download\/JSON$/);assert.equal(init.method,'POST');
  const body=JSON.parse(init.body);if(body.entryPage.pageLength===1)return Response.json({entries:[]});exports++;
  return Response.json({entries:Array.from({length:50},(_,n)=>({entryUUID:'same-'+n,type:'capture',date:'2026-09-01',amount:{amount:100,currency:'DKK'}}))});
 });const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},a='/api/platform/companies/company-a/webshops/shop-a1/payments/viabill',b='/api/platform/companies/company-b/webshops/shop-b1/payments/viabill';
 try{
  for(const [base,user,account] of [[a,'local-a','account-a'],[b,'local-b','account-b']]){
   let r=await h.request(base+'/connection',{user,env,method:'PUT',body:{apiKey:'key',secret:'secret',accountId:account,startDate:'2026-01-01'}});assert.equal(r.status,200,await r.text());
   r=await h.request(base+'/records',{user,env,method:'POST',body:{kind:'payment',start:'2026-09-01',end:'2026-09-01'}});assert.equal(r.status,200,await r.clone().text());const {next}=await r.json();assert.ok(next);
   r=await h.request(base+'/records',{user,env,method:'POST',body:{kind:'payment',start:'2026-09-01',end:'2026-09-01',cursor:next}});assert.equal(r.status,409,'provider repeated page');
   r=await h.request((base===a?b:a)+'/records',{user:base===a?'local-b':'local-a',env,method:'POST',body:{kind:'payment',start:'2026-09-01',end:'2026-09-01',cursor:next}});assert.ok([400,409].includes(r.status));
  }
  assert.equal(h.sql.prepare('SELECT count(*) n FROM payment_records').get().n,100);assert.ok(exports>=4);
  const rows=(await(await h.request(a+'/records?kind=payment',{user:'local-a'})).json()).rows;assert.equal(rows.length,50);assert.ok(rows.every(r=>r.accountId==='account-a'));
 }finally{h.close();}
});

async function testShopConnections(h,env){const {seal}=loader()('platform/connections.ts');for(const shop of ['shop-a1','shop-a2'])h.sql.prepare('INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)').run('company-a',shop,'shopify',shop+'.myshopify.com',await seal({...h.env,...env},['company-a',shop,'shopify',shop+'.myshopify.com'],{clientId:'test',clientSecret:'secret'}));}

test('stocktakes reread quantity and cost, isolate IDs, expire approvals and cannot mutate providers',async()=>{
 let quantity=5,cost='10.00',truncated=false;const network=async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});const {query}=JSON.parse(opt.body);assert.match(query,/^query /);assert.doesNotMatch(query,/mutation/);return Response.json({data:{inventoryItems:{nodes:[{id:'gid://shopify/InventoryItem/1',tracked:true,unitCost:{amount:cost,currencyCode:'DKK'},variant:{title:'Test',sku:'SKU',product:{title:'Vare',status:'ACTIVE'}},inventoryLevels:{nodes:[{location:{id:'gid://shopify/Location/1',name:'Lager',isActive:true},quantities:[{name:'on_hand',quantity}]}],pageInfo:{hasNextPage:truncated}}}],pageInfo:{hasNextPage:false,endCursor:null}}}});};
 const h=harness(jose,network),env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},base='/api/platform/companies/company-a/webshops/shop-a1/stocktake';
 try{await testShopConnections(h,env);h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run('company-a','123','unused','r1',JSON.stringify([{number:'5500',kind:'entry',vatCode:'',hidden:false},{number:'2000',kind:'entry',vatCode:'',hidden:false}]));h.sql.prepare('INSERT INTO accounting_mapping(company_id,accounts_json) VALUES(?,?)').run('company-a',JSON.stringify({inventory:'5500 - Lager',inventoryAdjustment:'2000 - Regulering'}));
 const changes=[{inventoryItemId:'gid://shopify/InventoryItem/1',locationId:'gid://shopify/Location/1',compareQuantity:5,quantity:3}];
 const post=body=>h.request(base,{user:'local-a',env,method:'POST',body});
 let r=await post({action:'prepare',changes});assert.equal(r.status,200,await r.clone().text());const prepared=await r.json();assert.equal(prepared.adjustmentMinor,-2000);assert.equal(prepared.voucher.Lines[0].Amount,20);assert.doesNotMatch(prepared.voucher.ExternalReference,/sablen/);
 assert.equal((await h.request(base,{user:'local-b',env})).status,403);assert.equal((await h.request(base,{user:'local-reader',env,method:'POST',body:{action:'prepare',changes}})).status,403);
 const body={action:'simulate',id:prepared.id,version:prepared.version,confirmation:true};cost='11.00';assert.equal((await post(body)).status,409);cost='10.00';quantity=4;assert.equal((await post(body)).status,409);quantity=5;
 assert.equal((await h.request(base.replace('shop-a1','shop-a2'),{user:'local-a',env,method:'POST',body})).status,409);
 assert.equal((await post({...body,action:'commit'})).status,403);assert.equal((await post(body)).status,200);assert.equal((await post(body)).status,409);
 truncated=true;assert.equal((await h.request(base,{user:'local-a',env})).status,409);
 assert.equal(h.sql.prepare('SELECT phase FROM stocktakes').get().phase,'simulated');
 }finally{h.close();}
});

test('packaging fulfillment import preserves historical weights and isolates overlapping event IDs',async()=>{
 let weight='100',business=false,broken=false;
 const fulfillment={id:'gid://shopify/Fulfillment/1',createdAt:new Date().toISOString(),status:'SUCCESS',fulfillmentLineItems:{nodes:[{id:'gid://shopify/FulfillmentLineItem/1',quantity:2,lineItem:{title:'Vare',variant:{id:'gid://shopify/ProductVariant/1',title:'Variant',product:{id:'gid://shopify/Product/1',title:'Vare'}}}}],pageInfo:{hasNextPage:false,endCursor:null}}};
 const h=harness(jose,async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture'});const {query}=JSON.parse(opt.body);assert.doesNotMatch(query,/mutation/);
 if(query.includes('PackagingOrders'))return Response.json({data:{orders:{nodes:[{id:'gid://shopify/Order/1',name:'#1',test:false,billingAddress:{company:business?'Test ApS':''},fulfillments:[fulfillment]}],pageInfo:broken?{}:{hasNextPage:false,endCursor:null}}}});
 if(query.includes('PackagingProducts'))return Response.json({data:{nodes:[{id:'gid://shopify/Product/1',title:'Vare',packagingWeight:{value:weight},packagingReportable:{value:'ja'}}]}});throw Error('unexpected request');});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},day=new Date().toISOString().slice(0,10),base=shop=>'/api/platform/companies/company-a/webshops/'+shop+'/packaging';
 try{await testShopConnections(h,env);for(const shop of ['shop-a1','shop-a2']){const r=await h.request(base(shop),{user:'local-a',env,method:'POST',body:{action:'sync',start:day,end:day}});assert.equal(r.status,200,await r.text());}
 weight='900';business=true;let r=await h.request(base('shop-a1'),{user:'local-a',env,method:'POST',body:{action:'sync',start:day,end:day}});assert.equal(r.status,200,await r.text());
 const a=await(await h.request(base('shop-a1'),{user:'local-a'})).json(),b=await(await h.request(base('shop-a2'),{user:'local-a'})).json();assert.equal(a.period.commercialGrams,200);assert.equal(b.period.householdGrams,200);assert.equal(a.period.products[0].grams,200);
 broken=true;r=await h.request(base('shop-a1'),{user:'local-a',env,method:'POST',body:{action:'sync',start:day,end:day}});assert.equal(r.status,409);assert.equal(h.sql.prepare('SELECT count(*) n FROM packaging_snapshots').get().n,2);
 }finally{h.close();}
});


test('finance dashboard isolates overlapping organization and entry IDs and imports only by GET',async()=>{
 const year=new Date().getUTCFullYear(),today=new Date().toISOString().slice(0,10),calls=[];
 const h=harness(jose,async(input,opt)=>{const url=new URL(input);calls.push(url.pathname);assert.equal(opt.redirect,'manual');if(url.pathname.endsWith('/oauth/token'))return Response.json({access_token:'fixture'});assert.ok(!opt.method||opt.method==='GET');
 if(url.pathname.endsWith('/accountingyears'))return Response.json([{FromDate:year+'-01-01',ToDate:year+'-12-31'}]);
 if(url.pathname.endsWith('/accounts/entry'))return Response.json([{AccountNumber:1000,Category:'Turnover'}]);
 if(url.pathname.endsWith('/entries'))return Response.json([{EntryGuid:'00000000-0000-4000-8000-000000000001',AccountNumber:1000,Amount:-100,Date:today,Type:'Normal'}]);throw Error('unexpected');});const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)};
 try{const {seal}=loader()('platform/connections.ts');for(const [company,user] of [['company-a','local-a'],['company-b','local-b']]){
 const credentials={organizationId:'123',clientId:'test',clientSecret:'secret',apiKey:'key'},encrypted=await seal({...h.env,...env},[company,'dinero','123'],credentials);h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run(company,'123',encrypted,'r','[]');
 let r=await h.request('/api/platform/companies/'+company+'/finance',{user,env,method:'POST',body:{}});assert.equal(r.status,200,await r.text());r=await h.request('/api/platform/companies/'+company+'/finance',{user,env});assert.equal(r.status,200);const result=await r.json();assert.equal(result.ready,true);assert.equal(result.data.revenueYtd,10000);assert.equal(result.data.previousYtd,null);
 }
 assert.equal(h.sql.prepare('SELECT count(*) n FROM finance_ledger').get().n,2);
 assert.equal((await h.request('/api/platform/companies/company-a/finance',{user:'local-b',env})).status,403);assert.equal((await h.request('/api/platform/companies/company-a/finance',{user:'local-reader',env})).status,403);
 assert.equal(calls.filter(p=>p.endsWith('/entries')).length,2);
 }finally{h.close();}
});


test('Tier 0 can view webshops and invite users but only a Tier 1 company admin can maintain shops',async()=>{
 const h=harness();try{
 const base='/api/platform/companies/company-a/webshops';
 assert.equal((await h.request(base)).status,200);
 for(const [path,method,body] of [[base,'POST',{name:'Forbidden',domain:'forbidden.example.test'}],[base+'/shop-a1','PATCH',{name:'Forbidden',domain:'forbidden.example.test',status:'active'}],[base+'/shop-a1/connection','PUT',{provider:'shopify',shopDomain:'test.myshopify.com',clientId:'id',clientSecret:'secret'}]])assert.equal((await h.request(path,{method,body})).status,403);
 assert.equal(h.sql.prepare("SELECT count(*) n FROM webshops WHERE company_id='company-a'").get().n,2);
 const response=await h.request(base,{user:'local-a',method:'POST',body:{name:'Customer shop',domain:'customer-shop.example.test'}});assert.equal(response.status,201,await response.clone().text());const {id}=await response.json();
 assert.equal((await h.request(base+'/'+id,{user:'local-a',method:'PATCH',body:{name:'Customer changed',domain:'customer-shop.example.test',status:'active'}})).status,200);
 assert.equal((await h.request('/api/platform/companies/company-a/users',{method:'POST',body:{email:'new-invitation@example.test'}})).status,201);
 assert.equal((await h.request(base,{user:'local-b',method:'POST',body:{name:'Forbidden',domain:'foreign.example.test'}})).status,403);
 }finally{h.close();}
});


test('Tier 1 derives company access in dev and production',async()=>{
 const h=harness();
 try{
  const route='/api/platform/tier1/shops/shop-a1/dinero/accounts';
  assert.equal((await h.request(route,{auth:false})).status,401);
  assert.equal((await h.request(route)).status,403);
  assert.equal((await h.request(route,{user:'local-a'})).status,200);
  assert.equal((await h.request(route,{user:'local-b'})).status,404);
  assert.equal((await h.request('/api/platform/tier1/shops/shop-a2/dinero/accounts',{user:'local-reader'})).status,403);
  assert.equal((await h.request('/api/platform/tier1/shops/none/dinero/accounts',{user:'local-reader'})).status,403);
  const unseen=await h.request('/api/platform/tier1/shops/shop-a1/invoices',{user:'local-a'});
  assert.equal(unseen.status,200);assert.deepEqual((await unseen.json()).statuses,{});
  assert.equal((await h.request('/api/platform/tier1/shops/shop-a1/integrations',{user:'local-a',method:'POST',body:{provider:'shopify'}})).status,400);
  // Production uses the same tenant authorization.
  const remote={...h.env,PLATFORM_ENV:'production'};
  const {handleTier1}=loader({jose,'pdf-lib':pdfLib})('platform/tier1-api.ts');
  assert.equal((await handleTier1(new Request('https://portal.webshoptoolbox.dk'+route),remote,{id:'local-a',platformAdmin:false})).status,200);
  await assert.rejects(()=>handleTier1(new Request('https://portal.webshoptoolbox.dk'+route),remote,{id:'local-b',platformAdmin:false}),e=>e.status===404);
  assert.equal((await handleTier1(new Request('https://dev.webshoptoolbox.dk'+route),{...h.env,PLATFORM_ENV:'remote-test'},{id:'local-a',platformAdmin:false})).status,200);
  const preview=await h.request('/tier1-next/',{user:'local-a'});
  assert.equal(preview.status,200);assert.match(preview.headers.get('x-robots-tag'),/noindex/);
  assert.match(preview.headers.get('content-security-policy'),/script-src 'self';/);
  assert.equal((await h.request('/tier1-next/')).status,403);
 }finally{h.close();}
});


test('original Tier 1 settings preserve shared invoice template, scope automation and reject stale edits across shops',async()=>{
 const h=harness();const path='/api/platform/tier1/shops/shop-a1/admin/settings';
 try {
  const before=await (await h.request(path,{user:'local-a'})).json();
  const second=await (await h.request(path.replace('shop-a1','shop-a2'),{user:'local-a'})).json();
  const settings=structuredClone(before.settings);settings.invoiceEmail.subject='Faktura {{fakturanummer}}';settings.invoiceEmail.body='Tak for din ordre '+ 'x'.repeat(3900);settings.automation.sales=true;settings.syncIntervalMinutes=10;
  const saved=await h.request(path,{user:'local-a',method:'POST',body:{settings,revision:before.revision}});
  assert.equal(saved.status,200,await saved.clone().text());
  assert.match((await saved.json()).message,/blokeret/);
  const invoice=h.sql.prepare("SELECT subject,body FROM invoice_settings WHERE company_id='company-a'").get();
  assert.equal(invoice.subject,settings.invoiceEmail.subject);assert.equal(invoice.body,settings.invoiceEmail.body);
  assert.equal((await h.request(path,{user:'local-a',method:'POST',body:{settings,revision:before.revision}})).status,409);
  assert.equal((await h.request(path.replace('shop-a1','shop-a2'),{user:'local-a',method:'POST',body:{settings:second.settings,revision:second.revision}})).status,409);
  const otherShop=await (await h.request(path.replace('shop-a1','shop-a2'),{user:'local-a'})).json();
  assert.equal(otherShop.settings.automation.sales,false);assert.equal(otherShop.settings.invoiceEmail.subject,settings.invoiceEmail.subject);
  const otherCompany=await (await h.request(path.replace('shop-a1','shop-b1'),{user:'local-b'})).json();
  assert.notEqual(otherCompany.settings.invoiceEmail.subject,settings.invoiceEmail.subject);
  assert.equal((await h.request(path,{user:'local-reader'})).status,403);
  const latest=await (await h.request(path,{user:'local-a'})).json();
  const originalBatch=h.db.batch;
  h.db.batch=async statements=>{h.sql.prepare("UPDATE invoice_settings SET subject='Concurrent edit' WHERE company_id='company-a'").run();return originalBatch(statements);};
  assert.equal((await h.request(path,{user:'local-a',method:'POST',body:latest})).status,409);
  assert.equal(h.sql.prepare("SELECT subject FROM invoice_settings WHERE company_id='company-a'").get().subject,'Concurrent edit');
 } finally {h.close();}
});


test('dev and production serve rebuilt Tier 1 while Tier 0 retains admin assets',async()=>{
 const h=harness();try{
  const login=await customerVerify(h,await customerStart(h));
  const cookie=login.headers.getSetCookie().find(c=>c.startsWith('__Host-toolbox_session=')).split(';')[0];
  const assets={fetch:async request=>new Response(new URL(request.url).pathname)};
  const env={PLATFORM_ENV:'remote-test',PLATFORM_AUTH:'cloudflare-access',ASSETS:assets};
  const options={origin:'https://dev.webshoptoolbox.dk',headers:{cookie},env};
  const root=await customerRequest(h,'/',options);
  assert.equal(root.status,200);assert.equal(await root.text(),'/tier1-next/index.html');
  const script=await customerRequest(h,'/tier1-next/assets/index-test.js',options);assert.equal(script.status,200);
  const production={...options,env:{...env,PLATFORM_ENV:'production',PLATFORM_ACCESS_AUD:'a'.repeat(64)}};
  assert.equal(await (await customerRequest(h,'/',production)).text(),'/tier1-next/index.html');
  assert.equal((await customerRequest(h,'/tier1-next/',production)).status,200);
  assert.equal((await customerRequest(h,'/api/platform/tier1/shops/shop-a1/admin/settings',production)).status,200);
  const admin=await customerRequest(h,'/admin/',{auth:true,env:{ASSETS:assets}});
  assert.equal(admin.status,200);assert.equal(await admin.text(),'/');
 }finally{h.close();}
});


test('Tier 1 onboarding only reports verified connections in the current company and shop',async()=>{
 const h=harness();try{
  const status=async(shop='shop-a1',user='local-a')=>(await (await h.request('/api/platform/tier1/shops/'+shop+'/integrations',{user})).json()).integrations;
  assert.deepEqual(await status('none'),[]);
  h.sql.prepare("INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)").run('company-a','123','encrypted','r','[]');
  h.sql.prepare("INSERT INTO webshop_connections(company_id,webshop_id,provider,shop_domain,credentials_encrypted) VALUES(?,?,?,?,?)").run('company-a','shop-a1','shopify','test.myshopify.com','encrypted');
  assert.deepEqual((await status()).map(x=>x.provider),['dinero']);
  h.sql.prepare("UPDATE webshop_connections SET verified_at=CURRENT_TIMESTAMP WHERE webshop_id='shop-a1'").run();
  assert.deepEqual((await status()).map(x=>x.provider),['dinero','shopify']);
  assert.deepEqual((await status('shop-a2')).map(x=>x.provider),['dinero']);
  assert.deepEqual(await status('shop-b1','local-b'),[]);
  assert.equal((await h.request('/api/platform/tier1/shops/shop-a1/integrations',{user:'local-b'})).status,404);
  h.sql.prepare("UPDATE webshop_connections SET verified_at=NULL WHERE webshop_id='shop-a1'").run();
  assert.deepEqual((await status()).map(x=>x.provider),['dinero']);
 }finally{h.close();}
});


test('Tier 1 Shopify connection verifies before saving, creates first shop and preserves prior credentials on failure',async()=>{
 let fail=false,calls=0;
 const h=harness(jose,async(url,opt)=>{calls++;assert.equal(opt.redirect,'manual');assert.ok(url.startsWith('https://new-shop.myshopify.com/'));if(fail)return Response.json({}, {status:401});if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'test'});assert.match(JSON.parse(opt.body).query,/^query /);return Response.json({data:{shop:{name:'Test shop'}}});});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},body={provider:'shopify',shop:'new-shop.myshopify.com',clientId:'test',clientSecret:'synthetic-secret'};
 const route=shop=>'/api/platform/tier1/shops/'+shop+'/integrations';
 const post=(shop,user='local-a',input=body)=>h.request(route(shop),{user,env,method:'POST',body:input});
 try{
  assert.equal((await post('none','local-reader')).status,403);assert.equal((await post('shop-b1')).status,404);assert.equal(calls,0);
  assert.equal((await post('none','local-a',{...body,shop:'localhost'})).status,400);assert.equal(calls,0);
  const before=h.sql.prepare('SELECT count(*) n FROM webshops').get().n;
  fail=true;assert.equal((await post('none')).status,409);assert.equal(h.sql.prepare('SELECT count(*) n FROM webshops').get().n,before);
  fail=false;const response=await post('none');assert.equal(response.status,200,await response.clone().text());const created=await response.json();assert.equal(created.created,true);assert.equal(created.name,'Test shop');
  const saved=h.sql.prepare('SELECT * FROM webshop_connections WHERE webshop_id=?').get(created.webshopId);assert.ok(saved.verified_at);assert.doesNotMatch(saved.credentials_encrypted,/synthetic-secret/);
  const {unseal}=loader()('platform/connections.ts');assert.equal((await unseal({...h.env,...env},['company-a',created.webshopId,'shopify',body.shop],saved.credentials_encrypted)).clientSecret,body.clientSecret);
  await assert.rejects(()=>unseal({...h.env,...env},['company-b',created.webshopId,'shopify',body.shop],saved.credentials_encrypted));
  assert.equal((await post('none')).status,409);
  fail=true;assert.equal((await post(created.webshopId)).status,409);assert.deepEqual(h.sql.prepare('SELECT * FROM webshop_connections WHERE webshop_id=?').get(created.webshopId),saved);
  fail=false;assert.equal((await post(created.webshopId,'local-a',{...body,shop:'other.myshopify.com'})).status,409);
  assert.equal((await post(created.webshopId,'local-a',{...body,clientSecret:'updated'})).status,200);
  const status=await(await h.request(route(created.webshopId),{user:'local-a'})).json();assert.equal(status.integrations[0].provider,'shopify');assert.doesNotMatch(JSON.stringify(status),/updated|synthetic-secret/);
 }finally{h.close();}
});

test('Tier 1 Dinero connects without a webshop and preserves the single company accounting identity',async()=>{
 let fail=false;
 const h=harness(jose,async(url,opt)=>{assert.equal(opt.redirect,'manual');if(fail)return Response.json({}, {status:401});if(url.includes('/oauth/token'))return Response.json({access_token:'test'});assert.equal(opt.method||'GET','GET');return Response.json([{AccountNumber:1000,Name:'Salg',VatCode:'U25'}]);});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},route='/api/platform/tier1/shops/none/integrations',body={provider:'dinero',organizationId:'123',clientId:'test',clientSecret:'secret',apiKey:'key'};
 const post=(user='local-a',data=body)=>h.request(route,{user,env,method:'POST',body:data});
 try{
  assert.equal((await post('local-reader')).status,403);const response=await post();assert.equal(response.status,200,await response.clone().text());
  const saved=h.sql.prepare('SELECT * FROM accounting_connections').get();fail=true;assert.equal((await post()).status,409);assert.deepEqual(h.sql.prepare('SELECT * FROM accounting_connections').get(),saved);
  fail=false;assert.equal((await post('local-a',{...body,organizationId:'456'})).status,409);
  assert.deepEqual((await(await h.request(route,{user:'local-b'})).json()).integrations,[]);
 }finally{h.close();}
});

test('Tier 1 selection and payment connections adapt account discovery, enforce roles and reject stale updates',async()=>{
 const h=harness(jose,async(input,opt)=>{const url=new URL(input);assert.equal(opt.redirect,'manual');if(url.pathname.endsWith('/agreements'))return Response.json({agreements:[{id:'agreement',merchantID:'merchant',agreementNumber:'123',currency:'DKK'}]});if(url.pathname.endsWith('/accounts'))return Response.json({accounts:[{id:'account-a',name:'Test'}]});if(url.pathname.endsWith('/entries/download/JSON'))return Response.json({entries:[]});throw Error('unexpected call');});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},base='/api/platform/tier1/shops/shop-a1';
 const post=(path,body,user='local-a')=>h.request(base+path,{user,env,method:'POST',body});
 try{
  const initial=await(await h.request(base+'/integrations/selection',{user:'local-a'})).json();assert.deepEqual(initial.selected,['shopify','dinero']);
  assert.equal((await post('/integrations/selection',{provider:'flatpay',action:'add'},'local-reader')).status,403);
  assert.equal((await post('/integrations/selection',{provider:'flatpay',action:'add'})).status,200);
  const body={username:'test',password:'secret',agreementNumber:'123',startDate:'2026-01-01'};
  const discovery=await post('/flatpay/connection',{...body,action:'validate'});assert.equal(discovery.status,200);assert.equal((await discovery.json()).agreements.length,1);
  const saved=await post('/flatpay/connection',{...body,action:'save'});assert.equal(saved.status,200,await saved.clone().text());
  const status=await(await h.request(base+'/flatpay/connection',{user:'local-a'})).json();assert.equal(status.connected,true);assert.ok(status.revision);assert.doesNotMatch(JSON.stringify(status),/password|secret/);
  assert.equal((await post('/flatpay/connection',{...body,action:'save',revision:0})).status,409);
  assert.equal((await post('/flatpay/connection',{...body,action:'save',revision:status.revision})).status,200);
  assert.equal((await post('/integrations/selection',{provider:'flatpay',action:'remove'})).status,409);
  assert.equal((await post('/viabill/connection',{action:'connect',apiKey:'test',secret:'secret',accountId:'account-a',startDate:'2026-01-01'})).status,200);
  assert.equal((await h.request('/api/platform/tier1/shops/none/flatpay/connection',{user:'local-a'})).status,409);
  assert.equal((await post('/integrations/selection',{provider:'emballage',action:'add'})).status,200);
 }finally{h.close();}
});


test('Tier 1 history drives order import and display, isolates shops, and preserves stored data',async()=>{
 const queries=[];const today=new Date().toISOString().slice(0,10),recent=today+'T12:00:00Z';
 const h=harness(jose,async(url,opt)=>{if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'test'});const b=JSON.parse(opt.body);queries.push(b);return Response.json({data:{orders:{nodes:[{id:'gid://shopify/Order/991',name:'#991',test:true,createdAt:recent,currentTotalPriceSet:{shopMoney:{amount:'100.00',currencyCode:'DKK'}}},{id:'gid://shopify/Order/990',name:'#990',createdAt:'2020-01-01T12:00:00Z',currentTotalPriceSet:{shopMoney:{amount:'50.00',currencyCode:'DKK'}}}],pageInfo:{hasNextPage:false,endCursor:null}}}});});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},base='/api/platform/tier1/shops/shop-a1';
 const post=(path,body,user='local-a')=>h.request(base+path,{user,env,method:'POST',body});
 try{
  await testShopConnections(h,env);
  assert.equal((await post('/integrations/start-date',{provider:'shopify',startDate:today},'local-reader')).status,403);
  assert.equal((await post('/integrations/start-date',{provider:'shopify',startDate:'2026-02-30'})).status,400);
  assert.equal((await post('/integrations/start-date',{provider:'shopify',startDate:today})).status,200);
  assert.equal((await(await h.request(base+'/integrations/start-date?provider=shopify',{user:'local-a'})).json()).startDate,today);
  assert.equal((await(await h.request(base.replace('shop-a1','shop-a2')+'/integrations/start-date?provider=shopify',{user:'local-a'})).json()).startDate,'');
  const response=await post('/shopify/orders',{});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).synced,1);assert.match(queries[0].variables.query,/created_at:>=/);
  const list=await(await h.request(base+'/shopify/orders?period=today',{user:'local-a'})).json();assert.equal(list.total,1);assert.equal(list.orders[0].externalId,'gid://shopify/Order/991');assert.equal(h.sql.prepare('SELECT count(*) n FROM invoice_orders').get().n,1);
  assert.equal((await h.request(base+'/shopify/orders',{user:'local-b'})).status,404);
  assert.equal((await post('/admin/history',{months:12,startDate:'2025-01-01'})).status,400);
  assert.equal((await post('/admin/history',{months:12,startDate:'2025-01-01',confirmStartDateChange:true})).status,200);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM operation_snapshots').get().n,1);
  assert.equal((await post('/bookkeeping/manual',{action:'retry'})).status,403);
 }finally{h.close();}
});

test('Tier 1 data views render truthful empty state, show errors and keep company acknowledgements scoped',async()=>{
 const h=harness(),base='/api/platform/tier1/shops/shop-a1';try{
  for(const path of ['/shopify/orders','/invoices','/documents','/payouts/overview','/refunds/overview','/admin/insights','/admin/errors','/admin/sync-status','/notifications','/dashboard/platform','/shopify/packaging']){
   const response=await h.request(base+path,{user:'local-a'});assert.equal(response.status,200,path+': '+await response.clone().text());
  }
  h.sql.prepare("INSERT INTO operation_runs(id,company_id,webshop_id,module,status,message) VALUES('failed-a','company-a','shop-a1','orders','failed','Testfejl')").run();
  const errors=await(await h.request(base+'/admin/errors',{user:'local-a'})).json();assert.equal(errors.openCount,1);
  assert.equal((await h.request(base+'/admin/errors',{user:'local-reader',method:'POST',body:{id:'failed-a'}})).status,403);
  assert.equal((await h.request(base+'/admin/errors',{user:'local-a',method:'POST',body:{id:'failed-a'}})).status,200);
  assert.equal((await(await h.request(base+'/admin/errors',{user:'local-a'})).json()).openCount,0);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM operation_runs').get().n,1);
  assert.equal((await(await h.request(base+'/admin/sync-status',{user:'local-a'})).json()).automatic,false);
  const entry={date:new Date().toISOString().slice(0,10),description:'Test',supplier:'Test',supplierCountry:'DK',supplierCvr:'',weightGrams:100,reportable:'yes',audience:'household'};
  const save=await h.request(base+'/shopify/packaging',{user:'local-a',method:'POST',body:{action:'upsert',entry}});assert.equal(save.status,200,await save.clone().text());
  const periods=(await save.json()).periods;assert.equal(periods.currentQuarter.manualEntries.length,1);const saved=periods.currentQuarter.manualEntries[0];
  assert.equal((await h.request(base+'/shopify/packaging',{user:'local-a',method:'POST',body:{action:'delete',id:saved.id,version:0}})).status,409);
  assert.equal((await h.request(base+'/shopify/packaging',{user:'local-a',method:'POST',body:{action:'delete',id:saved.id,version:saved.version}})).status,200);
 }finally{h.close();}
});

test('Emballage dev connection encrypts keys, explains upstream errors, limits report reads to own account and blocks submission',async()=>{
 const calls=[];let failure='';
 const h=harness(jose,async(url,opt)=>{calls.push(url);assert.equal(opt.method,'GET');assert.equal(opt.redirect,'manual');if(url.endsWith('/me')){if(failure==='network')throw Error('offline');if(failure==='auth')return Response.json({code:'authentication_failed'},{status:401,headers:{'X-Request-Id':'safe-reference'}});return Response.json({data:{organisation:{id:failure==='wrong-account'?2:1,name:'Test'},api_key:{is_test:true},responsibilities:[{code:'packaging',status:'active',product_area:{slug:'packaging',name:'Emballage'}}]}});}if(url.includes('/reports?'))return Response.json({data:[],meta:{}});throw Error('Unexpected report request');});
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},base='/api/platform/tier1/shops/shop-a1/emballage';
 try{
  const body={action:'connect',apiKey:'synthetic-ei-key'};
  assert.equal((await h.request(base+'/connection',{user:'local-reader',env,method:'POST',body})).status,403);
  const response=await h.request(base+'/connection',{user:'local-a',env,method:'POST',body});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).connected,true);
  assert.doesNotMatch(h.sql.prepare('SELECT credentials_encrypted FROM emballage_connections').get().credentials_encrypted,/synthetic-ei-key/);
  assert.equal((await h.request(base+'/connection?reportId=77',{user:'local-a',env})).status,404);
  assert.equal((await h.request(base+'/reporting',{user:'local-a',env,method:'POST',body:{action:'submit'}})).status,403);
  failure='auth';const auth=await h.request(base+'/connection',{user:'local-a',env,method:'POST',body});assert.equal(auth.status,409);assert.match((await auth.json()).error,/API-nøglen blev afvist.*safe-reference.*bevaret/);
  failure='network';const network=await h.request(base+'/connection',{user:'local-a',env,method:'POST',body});assert.equal(network.status,409);assert.match((await network.json()).error,/kunne ikke kontrollere nøglen.*kunne ikke kontaktes.*bevaret/);
  assert.equal(h.sql.prepare('SELECT identity FROM emballage_connections').get().identity,'1');
  failure='wrong-account';assert.equal((await h.request(base+'/connection',{user:'local-a',env,method:'POST',body})).status,409);
  assert.equal((await h.request(base+'/connection',{user:'local-b',env})).status,404);
 }finally{h.close();}
});

test('first Emballage configuration automatically imports scoped Shopify history exactly once',async()=>{
 const shopifyQueries=[];
 const h=harness(jose,async(url,opt)=>{
  if(url.endsWith('/me'))return Response.json({data:{organisation:{id:1,name:'Test'},api_key:{is_test:true},responsibilities:[{code:'packaging',status:'active',product_area:{slug:'packaging',name:'Emballage'}}]}});
  if(url.includes('emballageindberetning.dk/api/public/v1/reports?'))return Response.json({data:[],meta:{}});
  if(url.endsWith('/oauth/access_token'))return Response.json({access_token:'shopify-token'});
  const body=JSON.parse(opt.body);shopifyQueries.push(body);
  if(body.query.includes('PackagingHistoryAccess'))return Response.json({data:{currentAppInstallation:{accessScopes:[{handle:'read_all_orders'}]}}});
  if(body.query.includes('PackagingOrders'))return Response.json({data:{orders:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}});
  throw Error('Unexpected request: '+url);
 });
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)},base='/api/platform/tier1/shops/shop-a1/emballage/connection';
 try{
  await testShopConnections(h,env);
  assert.equal((await h.request(base,{user:'local-a',env,method:'POST',body:{action:'connect',apiKey:'synthetic-ei-key'}})).status,200);
  const start=new Date();start.setUTCMonth(start.getUTCMonth()-3);start.setUTCDate(1);start.setUTCMonth(Math.floor(start.getUTCMonth()/3)*3);const startDate=start.toISOString().slice(0,10);
  const body={action:'settings',config:{startDate,responsibility:'packaging',mappings:{}}};
  const first=await h.request(base,{user:'local-a',env,method:'POST',body});assert.equal(first.status,200,await first.clone().text());assert.equal((await first.json()).initialHistory.count,0);
  assert.equal(h.sql.prepare('SELECT coverage_start FROM packaging_sync WHERE company_id=? AND webshop_id=?').get('company-a','shop-a1').coverage_start,startDate);
  const imports=shopifyQueries.filter(x=>x.query.includes('PackagingOrders')).length;assert.equal(imports,1);
  const second=await h.request(base,{user:'local-a',env,method:'POST',body});assert.equal(second.status,200,await second.clone().text());assert.equal(shopifyQueries.filter(x=>x.query.includes('PackagingOrders')).length,imports);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM packaging_sync WHERE company_id=? AND webshop_id=?').get('company-a','shop-a2').n,0);
 }finally{h.close();}
});

test('Tier 1 payment views preserve currency precision, provider scope, details and safe write barriers',async()=>{
 const h=harness(),base='/api/platform/tier1/shops/shop-a1';
 try{
  const day=new Date().toISOString().slice(0,10),payment={id:'gid://shopify/ShopifyPaymentsBalanceTransaction/55',type:'REFUND',test:false,transactionDate:day+'T12:00:00Z',amount:{amount:'-123',currencyCode:'JPY'},fee:{amount:'0',currencyCode:'JPY'},net:{amount:'-123',currencyCode:'JPY'},associatedOrder:null,associatedPayout:null};
  h.sql.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').run('company-a','shop-a1','refunds',payment.id,payment.transactionDate,JSON.stringify(payment));
  const result=await h.request(base+'/refunds/overview',{user:'local-a'});assert.equal(result.status,200);const body=await result.json();assert.equal(body.summary[0].gross,-123);assert.equal(body.payments[0].bookingStatus,'setup_required');
  const other=await (await h.request(base.replace('shop-a1','shop-a2')+'/refunds/overview',{user:'local-a'})).json();assert.deepEqual(other.payments,[]);
  h.sql.prepare("INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES(?,?,?,?,?,?,?)").run('company-a','shop-a1','viabill','acc','{}','unused',day);
  h.sql.prepare("INSERT INTO payment_records(company_id,webshop_id,provider,kind,external_id,occurred_at,payload_json,paid) VALUES(?,?,?,?,?,?,?,1)").run('company-a','shop-a1','viabill','payout','entry-1',day,JSON.stringify({id:'viabill:acc:entry-1',entryUUID:'entry-1',date:day,currency:'DKK',amountMinor:321,entries:[]}));
  const detail=await h.request(base+'/viabill/records?kind=payout&id=viabill:acc:entry-1',{user:'local-a'});assert.equal(detail.status,200);assert.equal((await detail.json()).record.amountMinor,321);
  assert.equal((await h.request(base.replace('shop-a1','shop-a2')+'/viabill/records?kind=payout&id=viabill:acc:entry-1',{user:'local-a'})).status,404);
  const log=await h.request(base+'/payouts/log?provider=viabill&externalId=entry-1',{user:'local-a'});assert.equal(log.status,200);const logged=await log.json();assert.equal(logged.nextOffset,null);assert.ok(Array.isArray(logged.details));assert.ok(logged.events[0].detail.includes('Ingen bogføring'));
  for(const path of ['/sales/transfer','/refunds/transfer','/payouts/transfer','/invoices/email','/flatpay/production'])assert.equal((await h.request(base+path,{user:'local-a',method:'POST',body:{}})).status,403);
  const {dataStartDate}=loader({jose,'pdf-lib':pdfLib})('platform/tier1-history.ts');
  await h.request(base+'/integrations/start-date',{user:'local-a',method:'POST',body:{provider:'shopify',startDate:day}});assert.equal(await dataStartDate(h.env,'company-a','shop-a1'),day);
 }finally{h.close();}
});

test('invoice designer isolates logos, validates uploads and previews without creating invoices',async()=>{
 const h=harness(),files=new Map(),base='/api/platform/tier1/shops/shop-a1/invoices';
 const env={PLATFORM_DOCUMENTS:{put:async(k,v)=>files.set(k,new Uint8Array(v)),get:async k=>files.has(k)?{body:files.get(k),arrayBuffer:async()=>files.get(k).slice().buffer}:null}};
 const get=path=>h.request(base+path,{user:'local-a',env});
 try{
  const initial=await(await get('/settings')).json();assert.equal(initial.revision,0);
  const settings={...initial,name:'Firma A',address:'Testvej 1',cvr:'12345678',contact:'faktura@firma.test',design:{accent:'#245b70',layout:'modern',footer:'Tak for din ordre'}};
  assert.equal((await h.request(base+'/settings',{user:'local-reader',method:'PUT',body:settings,env})).status,403);
  assert.equal((await h.request(base+'/settings',{user:'local-a',method:'PUT',body:{...settings,design:{...settings.design,accent:'red'}},env})).status,400);
  assert.equal((await h.request(base+'/settings',{user:'local-a',method:'PUT',body:settings,env})).status,200);
  assert.equal((await h.request(base+'/settings',{user:'local-a',method:'PUT',body:settings,env})).status,409);
  const before=h.sql.prepare('SELECT count(*) n FROM platform_invoices').get().n;
  const preview=await get('/preview');assert.equal(preview.status,200,await preview.clone().text());assert.equal(preview.headers.get('content-type'),'application/pdf');assert.equal((await pdfLib.PDFDocument.load(await preview.arrayBuffer())).getPageCount(),1);assert.equal(h.sql.prepare('SELECT count(*) n FROM platform_invoices').get().n,before);assert.equal(files.size,0);
  assert.equal((await h.request(base+'/preview',{user:'local-b',env})).status,404);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=','base64');
  const upload=(data,user='local-a',origin='http://127.0.0.1:8790')=>h.request(base+'/logo',{user,env,method:'PUT',rawBody:data,headers:{origin,'content-type':'image/png'}});
  assert.equal((await upload(png,'local-reader')).status,403);assert.equal((await upload(png,'local-a','https://foreign.test')).status,403);assert.equal((await upload(Buffer.from('not a png'))).status,400);
  assert.equal((await upload(png)).status,200);assert.equal(files.size,1);
  const saved=await(await get('/settings')).json();assert.equal(saved.hasLogo,true);assert.equal(saved.logo_key,undefined);assert.ok([...files.keys()][0].startsWith('companies/company-a/invoice-logos/'));
  assert.equal((await get('/logo')).status,200);assert.equal((await h.request(base.replace('shop-a1','shop-b1')+'/logo',{user:'local-b',env})).status,404);
  assert.equal((await get('/preview')).status,200);
  assert.equal((await h.request(base+'/logo',{user:'local-a',env,method:'DELETE',headers:{origin:'http://127.0.0.1:8790'}})).status,200);assert.equal((await(await get('/settings')).json()).hasLogo,false);assert.equal((await get('/preview')).status,200);
  assert.equal(files.size,1,'old objects remain available to preserved invoices');
  const firstLogo=await h.request(base.replace('shop-a1','shop-b1')+'/logo',{user:'local-b',env,method:'PUT',rawBody:png,headers:{origin:'http://127.0.0.1:8790','content-type':'image/png'}});assert.equal(firstLogo.status,200);assert.equal(h.sql.prepare("SELECT address FROM invoice_settings WHERE company_id='company-b'").get().address,'');
 }finally{h.close();}
});

test('Tier 1 sender setup uses standard fallback, hides secrets and leaves local custom test unverified',async()=>{
 const h=harness(),base='/api/platform/tier1/shops/shop-a1/invoices/sender',env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)};
 try{
  const initial=await(await h.request(base,{user:'local-a'})).json();assert.equal(initial.status,'standard');
  const body={senderName:'Firma',replyTo:'reply@firma.test',customFrom:'faktura@firma.test',accountId:'a'.repeat(32),apiToken:'synthetic-token-123456789'};
  assert.equal((await h.request(base,{user:'local-reader',method:'PUT',body,env})).status,403);
  const response=await h.request(base,{user:'local-a',method:'PUT',body,env});assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.status,'pending');assert.equal(saved.effectiveFrom,initial.standardFrom);assert.equal(saved.apiToken,undefined);assert.equal(saved.credentialsSaved,true);
  const sent=await h.request(base+'/test',{user:'local-a',method:'POST',body:{mode:'custom',requestId:crypto.randomUUID()},env});assert.equal(sent.status,200);assert.equal((await sent.json()).status,'preview');assert.equal((await(await h.request(base,{user:'local-a',env})).json()).status,'pending');
  assert.equal((await h.request(base,{user:'local-b',env})).status,404);
 }finally{h.close();}
});


test('platform edited orders use current quantities and totals without changing legacy validation',()=>{
 const check=loader()('platform/order-check.ts').checkInvoice;
 const order=fixture(),money=amount=>({shopMoney:{amount:String(amount),currencyCode:'DKK'}});
 order.edited=true;
 const line=order.lineItems.nodes[0];line.quantity=2;line.currentQuantity=1;
 line.originalUnitPriceSet=money(125);line.priceAfterAllDiscountsBeforeTaxesSet=money(90);line.taxLines[0].priceSet=money(45);
 order.totalPriceSet=money(275);order.totalTaxSet=money(55);
 order.lineItems.nodes.push({...structuredClone(line),id:'removed',currentQuantity:0});
 order.shippingLines.nodes.push({...structuredClone(order.shippingLines.nodes[0]),id:'removed-shipping',isRemoved:true});
 const result=check(order);assert.equal(result.gross,16250);assert.equal(result.tax,3250);assert.equal(result.lines.length,2);assert.equal(result.lines[0].quantity,1);
 assert.equal(order.lineItems.nodes.length,2);assert.equal(order.edited,true);
 assert.throws(()=>loader()('lib/invoice-check.ts').checkInvoice(order),/ændret/);
 order.currentTotalTaxSet=money(32.51);assert.throws(()=>check(order),/stemmer ikke/);
 order.currentTotalTaxSet=money(32.50);order.totalRefundedSet=money(1);assert.throws(()=>check(order),/refunderet/);
});

test('order validation refetches fresh data and bounds retries before document writes',async()=>{
 let reads=0;
 const modules=loader({fetch:async()=>{const order=fixture();reads++;if(reads===1)order.billingAddress.address1='';return Response.json({data:{order}});}});
 const {loadCompleteOrder}=modules('platform/invoice-source.ts'),{checkInvoice}=modules('platform/order-check.ts');
 const order=await loadCompleteOrder(fixture().id,{shop:'a1.myshopify.com',accessToken:'synthetic'},checkInvoice);
 assert.equal(reads,2);assert.equal(order.billingAddress.address1,'Testvej 1');
 let failures=0;
 const failing=loader({fetch:async()=>{failures++;const order=fixture();order.currentTotalPriceSet.shopMoney.amount='1';return Response.json({data:{order}});}});
 await assert.rejects(()=>failing('platform/invoice-source.ts').loadCompleteOrder(fixture().id,{shop:'a1.myshopify.com',accessToken:'synthetic'},failing('platform/order-check.ts').checkInvoice),/stemmer ikke/);
 assert.equal(failures,3);
});

test('changed paginated order is reloaded from scratch with a bounded read retry',async()=>{
 let starts=0;
 const modules=loader({fetch:async(url,options)=>{
  const {query}=JSON.parse(options.body),order=fixture();
  if(query.includes('query InvoiceOrder(')){starts++;if(starts===1)order.lineItems.pageInfo={hasNextPage:true,endCursor:'page1'};}
  else if(query.includes('MoreInvoiceLines'))order.updatedAt='2026-09-05T08:00:00Z';
  return Response.json({data:{order}});
 }});
 const order=await modules('platform/invoice-source.ts').loadCompleteOrder(fixture().id,{shop:'a1.myshopify.com',accessToken:'synthetic'},modules('platform/order-check.ts').checkInvoice);
 assert.equal(starts,2);assert.equal(order.lineItems.nodes.length,1);
});

test('edited invoice generates once from refreshed current data',async()=>{
 const h=await invoiceHarness();try{
  h.order.edited=true;
  Object.assign(h.order.lineItems.nodes[0],{originalUnitPriceSet:{shopMoney:{amount:'125',currencyCode:'DKK'}},priceAfterAllDiscountsBeforeTaxesSet:{shopMoney:{amount:'90',currencyCode:'DKK'}}});
  await h.call('sync',{webshopId:'shop-a1'});
  const response=await h.call('generate',h.input('shop-a1'));assert.equal(response.status,200,await response.text());
  assert.equal((await h.call('generate',h.input('shop-a1'))).status,200);assert.equal(h.objects.size,1);
 }finally{h.close();}
});

test('onboarding dates are independent, scoped and never inferred from history', async () => {
 const h=harness();try{
 const base='/api/platform/tier1/shops/shop-a1/integrations/start-date';
 let r=await h.request(base+'?provider=shopify',{user:'local-a'});assert.equal((await r.json()).bookingStartDate,'');
 r=await h.request(base,{user:'local-a',method:'POST',body:{provider:'shopify',startDate:'2020-01-01',bookingStartDate:'2030-01-01'}});assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).bookingStartDate,'2030-01-01');
 r=await h.request(base.replace('shop-a1','shop-a2')+'?provider=shopify',{user:'local-a'});assert.equal((await r.json()).bookingStartDate,'');
 r=await h.request(base,{user:'local-b',method:'POST',body:{provider:'shopify',startDate:'2020-01-01',bookingStartDate:'2026-01-01'}});assert.equal(r.status,404);
 r=await h.request(base,{user:'local-a',method:'POST',body:{provider:'shopify',startDate:'2020-01-01',bookingStartDate:'2026-02-30'}});assert.equal(r.status,400);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM accounting_reconciliations').get().n,0);
 }finally{h.close();}
});

test('booking boundaries use Danish event dates and receipts override changed dates', () => {
 const {onboardingStatus:status}=loader({jose})('platform/booking-onboarding.ts');
 assert.equal(status('2026-03-28T22:59:59Z','2026-03-29','2026-03-29'),'historical');
 assert.equal(status('2026-03-28T23:00:00Z','2026-03-29','2026-03-29'),'reconciliation_required');
 assert.equal(status('2026-03-29T22:00:00Z','2026-03-30','2026-03-30'),'reconciliation_required');
 assert.equal(status('2026-03-30','2026-03-29','2026-04-01'),'historical');
 assert.equal(status('2026-03-30','','2026-04-01'),'setup_required');
 assert.equal(status('2020-01-01','','',{voucher_status:'Booked',source_json:'same'},'same'),'booked');
 assert.equal(status('2020-01-01','','',{voucher_status:'Booked',source_json:'same'},'changed'),'booked_changed');
 assert.equal(status('2020-01-01','','',{voucher_status:'Draft',source_json:'same'},'same'),'draft');
});

test('Dinero reconciliation is explicit, read-only, tenant scoped and immutable', async()=>{
 const calls=[],guid='11111111-1111-4111-8111-111111111111';
 let status='Booked',timestamp='v1';
 const h=harness(jose,async(url,options)=>{calls.push([String(url),options.method]);if(String(url).includes('/oauth/token'))return Response.json({access_token:'synthetic'});assert.equal(options.method,'GET');assert.equal(String(url),'https://api.dinero.dk/v1/123/vouchers/manuel/'+guid);return Response.json({Guid:guid,Status:status,Timestamp:timestamp,VoucherDate:'2026-09-01',VoucherNumber:17,ExternalReference:'example:order:123',Lines:[{Description:'Order 123',AmountInclVatValue:125,Currency:'DKK'}]});});
 try{
 const env={PLATFORM_CREDENTIALS_KEY:'ab'.repeat(32)};
 const encrypted=await loader()('platform/connections.ts').seal({...h.env,...env},['company-a','dinero','123'],{organizationId:'123',clientId:'test',clientSecret:'test',apiKey:'test'});
 h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run('company-a','123',encrypted,'r1','[]');
 const payload=JSON.stringify({id:'gid://shopify/Order/123',name:'#123',createdAt:'2026-09-01T12:00:00Z',currentTotalPriceSet:{shopMoney:{amount:'125.00',currencyCode:'DKK'}}});
 for(const shop of ['shop-a1','shop-a2'])h.sql.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').run('company-a',shop,'orders','gid://shopify/Order/123','2026-09-01T12:00:00Z',payload);
 const path='/api/platform/tier1/shops/shop-a1/integrations/reconciliation';
 const body={action:'preview',provider:'shopify',module:'orders',externalId:'gid://shopify/Order/123',guid};
 const request=(b,user='local-a',p=path)=>h.request(p,{user,method:'POST',env,body:b});
 assert.equal((await request(body,'local-b')).status,404);assert.equal((await request(body,'local-reader')).status,403);assert.equal(calls.length,0);
 status='Draft';let draft=await (await request(body)).json();assert.equal((await request({...body,action:'confirm',confirmation:draft.confirmation,confirmMatch:true})).status,409);status='Booked';
 let r=await request(body);assert.equal(r.status,200,await r.clone().text());let preview=await r.json();assert.equal(h.sql.prepare('SELECT count(*) n FROM accounting_reconciliations').get().n,0);
 assert.equal((await request({...body,action:'confirm',confirmation:preview.confirmation,confirmMatch:true},'local-a',path.replace('shop-a1','shop-a2'))).status,409);
 timestamp='v2';assert.equal((await request({...body,action:'confirm',confirmation:preview.confirmation,confirmMatch:true})).status,409);
 r=await request(body);preview=await r.json();
 h.sql.prepare("UPDATE operation_snapshots SET payload_json=? WHERE webshop_id='shop-a1'").run('{"changed":true}');assert.equal((await request({...body,action:'confirm',confirmation:preview.confirmation,confirmMatch:true})).status,409);h.sql.prepare("UPDATE operation_snapshots SET payload_json=? WHERE webshop_id='shop-a1'").run(payload);
 h.sql.exec("UPDATE accounting_connections SET revision='r2'");assert.equal((await request({...body,action:'confirm',confirmation:preview.confirmation,confirmMatch:true})).status,409);
 r=await request(body);preview=await r.json();r=await request({...body,action:'confirm',confirmation:preview.confirmation,confirmMatch:true});assert.equal(r.status,200,await r.clone().text());
 r=await request({...body,action:'confirm',confirmation:preview.confirmation,confirmMatch:true});assert.equal(r.status,409);
 const second=await (await request(body,'local-a',path.replace('shop-a1','shop-a2'))).json();r=await request({...body,action:'confirm',confirmation:second.confirmation,confirmMatch:true},'local-a',path.replace('shop-a1','shop-a2'));assert.equal(r.status,409);
 assert.equal(h.sql.prepare('SELECT count(*) n FROM accounting_reconciliations').get().n,1);
 const statusFor=await loader({jose})('platform/booking-onboarding.ts').bookingStatuses(h.env,'company-a','shop-a1');assert.equal(statusFor('shopify','orders',body.externalId,'2026-09-01',payload),'booked');assert.equal(statusFor('shopify','orders',body.externalId,'2026-09-01','changed'),'booked_changed');
 const other=await loader({jose})('platform/booking-onboarding.ts').bookingStatuses(h.env,'company-a','shop-a2');assert.equal(other('shopify','orders',body.externalId,'2026-09-01',payload),'setup_required');
 assert.ok(calls.every(([url,method])=>method==='GET'||url.endsWith('/oauth/token')));
 }finally{h.close();}
});


test('production receipts serialize contenders, isolate tenants and never reopen uncertain or completed writes',async()=>{
 const h=harness();try{
  const {saveReceipt,readReceipt}=loader()('platform/production-receipts.ts');
  const key={company:'company-a',shop:'shop-a1',provider:'shopify',module:'orders',externalId:'overlap',destination:'123'};
  const first=await saveReceipt(h.env,key,null,'prepared',{amount:100});
  const races=await Promise.allSettled([saveReceipt(h.env,key,first,'creating',{amount:100}),saveReceipt(h.env,key,first,'creating',{amount:100})]);
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  const current=await readReceipt(h.env,key);
  const uncertain=await saveReceipt(h.env,key,current,'uncertain',current.payload);
  await assert.rejects(()=>saveReceipt(h.env,key,uncertain,'creating',{}),/genstartes/);
  await assert.rejects(()=>saveReceipt(h.env,key,null,'prepared',{}),/allerede/);
  const other=await saveReceipt(h.env,{...key,shop:'shop-a2'},null,'prepared',{amount:200});
  assert.equal(other.payload.amount,200);assert.equal((await readReceipt(h.env,key)).payload.amount,100);
  const booked=await saveReceipt(h.env,key,uncertain,'booked',{guid:'verified'});
  await assert.rejects(()=>saveReceipt(h.env,key,booked,'prepared',{}),/genstartes/);
 }finally{h.close();}
});

test('customer invoice delivery enforces production, tenant ownership and durable no-resend after acceptance or timeout',async()=>{
 const h=await invoiceHarness();try{
  await h.call('sync',{webshopId:'shop-a1'});await h.call('generate',h.input('shop-a1'));
  const invoiceId=h.sql.prepare("SELECT id FROM platform_invoices WHERE webshop_id='shop-a1'").get().id;
  const {sendCustomerInvoice}=loader({jose,'pdf-lib':pdfLib})('platform/mail.ts');
  const actor={id:'local-a',email:'a@example.test',platformAdmin:false};let sends=0,fail=false,message;
  const env={...h.env,PLATFORM_ENV:'production',PLATFORM_CUSTOMER_EMAIL:'enabled',PLATFORM_MAIL_FROM:'faktura@webshoptoolbox.dk',PLATFORM_MAIL_TEST:{send:async m=>{sends++;message=m;if(fail)throw Error('network lost after accept');return {messageId:'synthetic-receipt'};}}};
  const attachment={content:new ArrayBuffer(8),filename:'invoice.pdf',type:'application/pdf',disposition:'attachment'};
  const send=(overrides={},shop='shop-a1',who=actor)=>sendCustomerInvoice({...env,...overrides},who,'company-a',shop,invoiceId,'customer@example.test','Faktura','Vedhæftet',attachment);
  await assert.rejects(()=>send({PLATFORM_ENV:'remote-test'}),/ikke aktiveret/);
  await assert.rejects(()=>send({PLATFORM_CUSTOMER_EMAIL:'blocked'}),/ikke aktiveret/);
  await assert.rejects(()=>send({},'shop-a2'),/faktura findes ikke/);
  await assert.rejects(()=>send({},'shop-a1',{...actor,id:'local-b'}));
  await assert.rejects(()=>send({},'shop-a1',{...actor,support:{adminId:'local-admin'}}));
  assert.equal(sends,0);
  const results=await Promise.allSettled([send(),send()]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(sends,1);
  assert.equal((await(await send()).json()).existing,true);assert.equal(sends,1);assert.equal(message.to,'customer@example.test');assert.equal(message.from.name,h.settings.name);
  // A different real invoice whose send times out must never be sent again.
  h.sql.prepare("DELETE FROM production_receipts WHERE module='email'").run();fail=true;
  await assert.rejects(()=>send(),/uafklaret/);await assert.rejects(()=>send(),/uafklaret/);assert.equal(sends,2);
  assert.equal(h.sql.prepare("SELECT phase FROM production_receipts WHERE module='email'").get().phase,'uncertain');
 }finally{h.close();}
});


async function productionSaleHarness(){
 const h=await invoiceHarness(),shop='shop-a1',orderId=h.order.id;
 await h.call('sync',{webshopId:shop});await h.call('generate',h.input(shop));
 const mapping={clearing:'55000',goodsVat:'1000',shippingVat:'1100',goodsNoVat:'1200',shippingNoVat:'1300',vatCode:'U25',noVatCode:'NONE'};
 const chart=[['55000',''],['1000','U25'],['1100','U25'],['1200',''],['1300','']].map(([number,vatCode])=>({number,name:number,vatCode,kind:'entry',hidden:false}));
 h.sql.prepare('INSERT INTO accounting_mapping(company_id,accounts_json) VALUES(?,?)').run('company-a',JSON.stringify(mapping));
 h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run('company-a','123','synthetic','revision1',JSON.stringify(chart));
 h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run('company-a',shop,JSON.stringify({automation:{salesBookDinero:true,inventory:false}}),'revision1');
 for(const provider of ['shopify','dinero'])h.sql.prepare('INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)').run('company-a',shop,provider,'2026-09-01');
 h.sql.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').run('company-a',shop,'orders',orderId,h.order.createdAt,JSON.stringify(h.order));
 let posts=0,books=0,failCreate=false,failBook=false,remote,sourceReads=0;
 const guid='12345678-1234-1234-1234-123456789abc',fileGuid='abcdefab-1234-1234-1234-123456789abc';
 const client=async(path,method,body)=>{
  if(method==='GET')return structuredClone(remote);
  if(path==='files')return {FileGuid:fileGuid};
  if(path==='vouchers/manuel'){
   posts++;const receipt=JSON.parse(h.sql.prepare("SELECT payload_json FROM production_receipts WHERE module='orders'").get().payload_json);
   remote={...body,Guid:guid,Status:'Draft',Timestamp:'t1',Lines:body.Lines.map((line,i)=>({...line,AmountExclVatValue:receipt.expected[i].net/100,VatAmountValue:receipt.expected[i].tax/100,AmountInclVatValue:receipt.expected[i].gross/100}))};
   if(failCreate)throw Error('create response lost');return {Guid:guid};
  }
  if(path.endsWith('/book')){books++;remote.Status='Booked';remote.VoucherNumber=42;remote.Timestamp='t2';if(failBook)throw Error('book response lost');return remote;}
  throw Error('Unexpected request');
 };
 const load=loader({jose,'pdf-lib':pdfLib,'./connections':{unseal:async()=>({organizationId:'123'})},'./invoice-source':{shopAccess:async()=>({}),loadCompleteOrder:async()=>{sourceReads++;return structuredClone(h.order);}},'./dinero-read':{readDineroAccounts:async()=>chart},'./dinero-write':{dineroClient:async()=>client}});
 const handle=load('platform/production-sales.ts').handleProductionSale;
 const env={...h.env,PLATFORM_ENV:'production',PLATFORM_EXTERNAL_WRITES:'enabled'},actor={id:'local-a',email:'a@example.test',platformAdmin:false};
 const call=(action,version,overrides={})=>handle(new Request('https://portal.example.test/sales',{method:'POST',headers:{origin:'https://portal.example.test','content-type':'application/json'},body:JSON.stringify({kind:'sale',externalId:orderId,action,version,confirmed:true})}),{...env,...overrides},actor,'company-a',shop);
 return {...h,call,orderId,shop,env,get posts(){return posts;},get books(){return books;},get sourceReads(){return sourceReads;},failCreate:()=>{failCreate=true;},failBook:()=>{failBook=true;},changeOrder:()=>{h.order.billingAddress.name='Changed';},receipt:()=>h.sql.prepare("SELECT * FROM production_receipts WHERE module='orders'").get()};
}

test('production sale books once, reuses verified receipt and rejects stale, test and historical attempts',async()=>{
 const h=await productionSaleHarness();try{
  await assert.rejects(()=>h.call('inspect',null,{PLATFORM_ENV:'remote-test'}),/ikke aktiveret/);
  const inspected=await(await h.call('inspect')).json();assert.equal(inspected.phase,'prepared');assert.equal(h.posts,0);
  await assert.rejects(()=>h.call('retry','stale'),/godkend/);
  const results=await Promise.allSettled([h.call('retry',inspected.version),h.call('retry',inspected.version)]);
  assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(h.posts,1);assert.equal(h.books,1);assert.equal(h.receipt().phase,'booked');
  h.changeOrder();assert.equal((await(await h.call('inspect')).json()).phase,'booked');assert.equal(h.posts,1);
 }finally{h.close();}
 const changed=await productionSaleHarness();try{
  const inspected=await(await changed.call('inspect')).json();changed.changeOrder();
  await assert.rejects(()=>changed.call('retry',inspected.version),/faktura-PDF/);assert.equal(changed.posts,0);
 }finally{changed.close();}
 const historical=await productionSaleHarness();try{
  historical.sql.prepare("UPDATE booking_start_dates SET start_date='2026-09-10'").run();
  await assert.rejects(()=>historical.call('inspect'),/bogføringsperiode/);assert.equal(historical.posts,0);
 }finally{historical.close();}
});

test('production sale never recreates uncertain create and recovers known booked GUID by reading',async()=>{
 const lost=await productionSaleHarness();try{
  const inspected=await(await lost.call('inspect')).json();lost.failCreate();
  await assert.rejects(()=>lost.call('retry',inspected.version),/uafklaret/);assert.equal(lost.receipt().phase,'uncertain');
  await assert.rejects(()=>lost.call('inspect'),/uafklaret/);assert.equal(lost.posts,1);assert.equal(lost.books,0);
 }finally{lost.close();}
 const booked=await productionSaleHarness();try{
  const inspected=await(await booked.call('inspect')).json();booked.failBook();
  await assert.rejects(()=>booked.call('retry',inspected.version),/uafklaret/);assert.equal(booked.receipt().phase,'uncertain');
  assert.equal((await(await booked.call('inspect')).json()).phase,'booked');assert.equal(booked.posts,1);assert.equal(booked.books,1);
 }finally{booked.close();}
});


test('reconciliation and production claims cannot win for the same source, in either order',async()=>{
 const h=harness();try{
  const {saveReceipt}=loader()('platform/production-receipts.ts');
  const key={company:'company-a',shop:'shop-a1',provider:'shopify',module:'orders',externalId:'123',destination:'123'};
  const reconcile=id=>h.sql.prepare("INSERT INTO accounting_reconciliations(company_id,webshop_id,provider,module,external_id,organization_id,voucher_guid,voucher_status,source_json,evidence_json,actor_id) VALUES(?,?,?,?,?,?,?,'Booked','{}','{}','local-a')").run('company-a','shop-a1','shopify','orders',id,'123','guid-'+id);
  const prepared=await saveReceipt(h.env,key,null,'prepared',{});reconcile('123');
  await assert.rejects(()=>saveReceipt(h.env,key,prepared,'creating',{}),/afstemt/);
  const other={...key,externalId:'456'},pending=await saveReceipt(h.env,other,null,'prepared',{});
  await saveReceipt(h.env,other,pending,'creating',{});assert.throws(()=>reconcile('456'),/allerede/);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM accounting_reconciliations').get().n,1);
 }finally{h.close();}
});


test('production scheduler is off in DEV, leases each shop and continues other orders after failure',async()=>{
 const h=harness();try{
  const automation={sales:true,payments:false,refunds:false,payouts:false,inventory:false,invoiceEmails:false,salesBookDinero:true};
  for(const [company,shop] of [['company-a','shop-a1'],['company-b','shop-b1']]){
   h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run(company,shop,JSON.stringify({automation,syncIntervalMinutes:5}),'r1');
   for(const provider of ['shopify','dinero'])h.sql.prepare('INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)').run(company,shop,provider,'2026-09-01');
   for(const id of ['1','2','3'])h.sql.prepare('INSERT INTO operation_snapshots(company_id,webshop_id,module,external_id,occurred_at,payload_json) VALUES(?,?,?,?,?,?)').run(company,shop,'orders','gid://shopify/Order/'+id,'2026-09-02T10:00:00Z','{}');
  }
  const calls=[],imports=[];
  const load=loader({jose,'pdf-lib':pdfLib,
   './operations':{handleOperations:async(req,env,actor,company,shop,module)=>{imports.push([company,shop,module,(await req.json()).after]);return Response.json({hasNextPage:true,endCursor:'page2'});}},
   './invoices':{handleInvoices:async(req,env,actor,company,action)=>{const b=await req.json();if(b.externalId.endsWith('/1'))throw new Error('synthetic source failure');return Response.json({invoice:{date:'2026-09-02T10:00:00Z'}});}},
   './production-sales':{handleProductionSale:async(req,env,actor,company,shop)=>{calls.push([company,shop,actor.id,(await req.json()).externalId]);return Response.json({phase:'booked'});}},
  });
  const run=load('platform/production-jobs.ts').runProductionJobs;
  assert.equal((await run(h.env)).status,'disabled');assert.equal(imports.length,0);
  const env={...h.env,PLATFORM_ENV:'production',PLATFORM_EXTERNAL_WRITES:'enabled'};
  await Promise.all([run(env),run(env)]);
  assert.equal(imports.length,2);assert.equal(calls.length,4);
  assert.deepEqual(calls.map(x=>[x[0],x[2]]).sort(),[['company-a','local-a'],['company-a','local-a'],['company-b','local-b'],['company-b','local-b']]);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM production_attempts WHERE failures=1').get().n,2);
  assert.equal(h.sql.prepare("SELECT count(*) n FROM operation_runs WHERE status='failed'").get().n,2);
  await run(env);assert.equal(imports.length,2);
  h.sql.prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'").run();await run(env);
  assert.equal(imports.length,4);assert.equal(imports[2][3],'page2');assert.equal(calls.length,4);
  h.sql.prepare("INSERT INTO public_signups(company_id,user_id,cvr,terms_version,accepted_at,trial_ends_at,template_version) VALUES('company-a','local-a','12345678','test',0,1,1)").run();
  h.sql.prepare("UPDATE production_jobs SET next_run_at=0 WHERE job='runtime'").run();await run(env);assert.equal(imports.length,5);assert.equal(imports[4][0],'company-b');
  await assert.rejects(()=>load('platform/auth.ts').requireCompany(h.env.PLATFORM_DB,{id:'local-a',platformAdmin:false},'company-a'),/Prøveperioden/);
 }finally{h.close();}
});

test('production runtime exposes capabilities only after authentication and retains DEV write denial',async()=>{
 const h=harness();try{
  const base='/api/platform/tier1/shops/shop-a1';
  assert.equal((await h.request(base+'/runtime',{auth:false})).status,401);
  assert.equal((await h.request(base+'/runtime',{user:'local-b'})).status,404);
  const dev=await(await h.request(base+'/runtime',{user:'local-a'})).json();assert.equal(dev.bookkeeping,false);assert.equal(dev.customerEmail,false);
  for(const path of ['/bookkeeping/manual','/invoices/email'])assert.equal((await h.request(base+path,{user:'local-a',method:'POST',body:{}})).status,403);
 }finally{h.close();}
});


test('production proposals validate current Shopify payouts, numeric refund references and scoped Flatpay settlement',async()=>{
 const h=harness();try{
  const a={bank:'55000',clearing:'55110',fees:'7220',shopifyPaymentsClearing:'55100',flatpayClearing:'55105',refundGoodsVat:'2000',vatCode:'U25',noVatCode:'NONE'};
  const chart=[55000,55110,7220,55100,55105,2000].map(n=>({number:String(n),name:String(n),hidden:false,vatCode:n===2000?'U25':'',kind:'entry'}));
  for(const provider of ['shopify','flatpay','dinero'])h.sql.prepare('INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)').run('company-a','shop-a1',provider,'2026-09-01');
  h.sql.prepare('INSERT INTO payment_connections(company_id,webshop_id,provider,identity,metadata_json,credentials_encrypted,start_date) VALUES(?,?,?,?,?,?,?)').run('company-a','shop-a1','flatpay','identity',JSON.stringify({merchantID:'m',agreementId:'a',agreementNumber:'11'}),'encrypted','2026-09-01');
  const {payoutSummaryFields}=loader()('platform/payout-calculations.ts');
  const summary=Object.fromEntries(payoutSummaryFields.map(f=>[f,{amount:'0.00',currencyCode:'DKK'}]));summary.chargesGross.amount='100.00';summary.chargesFee.amount='2.00';
  const payout={id:'gid://shopify/ShopifyPaymentsPayout/1',issuedAt:'2026-09-02T12:00:00Z',status:'PAID',transactionType:'DEPOSIT',net:{amount:'98.00',currencyCode:'DKK'},summary};
  const refund={id:'gid://shopify/ShopifyPaymentsBalanceTransaction/2',type:'REFUND',test:false,transactionDate:'2026-09-02T12:00:00Z',amount:{amount:'-100.00',currencyCode:'DKK'},associatedOrder:{id:'gid://shopify/Order/4',name:'#4'},sourceOrderTransactionId:'99999999999999999'};
  const money=v=>({shopMoney:{amount:v,currencyCode:'DKK'}}),connection=nodes=>({nodes,pageInfo:{hasNextPage:false}});
  const details={id:'refund',processedAt:'2026-09-02T12:00:00Z',refundLineItems:connection([{subtotalSet:money('80.00'),totalTaxSet:money('20.00')}]),refundShippingLines:connection([]),orderAdjustments:connection([]),transactions:connection([{id:'gid://shopify/OrderTransaction/'+refund.sourceOrderTransactionId,kind:'REFUND',status:'SUCCESS',test:false,amountSet:money('100.00')}])};
  const payment={paymentID:'12345',merchantID:'m',agreementNumber:'11',paidDate:'2026-09-02T12:00:00Z',currency:'DKK',payoutAmount:98,settlements:'56789'};
  const settlement={settlementNumber:'56789',merchantID:'m',agreementNumber:'11',currency:'DKK',transactions:'1',grossPurchase:100,grossSettlement:100,netPurchase:100,netSettlement:98,payout:98,feeAmount:2,deduction:2,refundAmount:0,chargeback:0,rollingReserve:0,rollingRelease:0,addedSum:0,deductedSum:0,balanceTransfer:0,reversals:0};
  const objects=new Map(),env={...h.env,PLATFORM_DOCUMENTS:{put:async(key,bytes)=>objects.set(key,bytes),get:async key=>objects.has(key)?{size:8,etag:key,arrayBuffer:async()=>objects.get(key).buffer}:null}};
  const ctx={env,company:'company-a',shop:'shop-a1',credentials:{organizationId:'123'},mapping:{accounts_json:JSON.stringify(a)},prefs:{preferences_json:JSON.stringify({automation:{payoutsBookDinero:true,refundsBookDinero:true,attachments:true}})},sourceRow:{payload_json:JSON.stringify(payment)}};
  let calls=0;
  const api=loader({jose,'pdf-lib':pdfLib,
   './production-booking':{handleProductionBooking:async(req,e,actor,company,shop,kind,module,provider,pattern,prepare)=>{const b=await req.json();assert.match(b.externalId,pattern);return prepare({...ctx,id:b.externalId});}},
   './dinero-read':{readDineroAccounts:async()=>chart},
   './invoice-source':{shopAccess:async()=>({shop:'a.myshopify.com'}),orderQuery:async(access,query)=>{calls++;return query.includes('Payout')?{node:payout}:query.includes('RefundDetails')?{order:{refunds:[details]}}:{node:refund};}},
   './payout-source':{fetchPayoutTransactions:async()=>[]},'./payout-pdf':{buildPayoutReport:async()=>new Uint8Array(8)},
   './connections':{unseal:async()=>({username:'synthetic',password:'synthetic'})},
   './flatpay-read':{flatpayRead:async(c,resource)=>resource==='payments'?[payment]:resource==='settlements'?[settlement]:[{transactionID:'9',settlementNumber:'56789',merchantID:'m',agreementID:'a',purchaseDate:'2026-09-02',transactionCode:'Purchase',currency:'DKK',grossAmount:100,fees:2,netAmount:98}]},
  })('platform/production-proposals.ts');
  const run=(kind,externalId)=>api.handleProductionOther(new Request('https://portal.example.test',{method:'POST',body:JSON.stringify({externalId})}),env,{},'company-a','shop-a1',kind);
  const p=await run('payout',payout.id);assert.deepEqual(p.snapshot.voucher.Lines.map(x=>x.Amount),[100,2,98]);assert.ok(p.file);assert.match(p.snapshot.pdfKey,/companies\/company-a\/webshops\/shop-a1/);
  const r=await run('refund',refund.id);assert.deepEqual(r.snapshot.expected.map(x=>x.gross),[-10000,10000]);assert.match(r.snapshot.voucher.ExternalReference,/^wtb:shop-a1:refund:/);
  const f=await run('flatpay','12345');assert.deepEqual(f.snapshot.voucher.Lines.map(x=>x.Amount),[100,2,98]);assert.ok(f.file);
  settlement.chargeback=1;await assert.rejects(()=>run('flatpay','12345'));
  refund.sourceOrderTransactionId='another';await assert.rejects(()=>run('refund',refund.id));
  payout.summary.chargesGross.amount='101.00';await assert.rejects(()=>run('payout',payout.id));assert.ok(calls>=5);
 }finally{h.close();}
});


test('production stocktake claims once before Shopify, retains uncertain writes and validates current quantity',async()=>{
 for(const lost of [false,true]){const h=harness();try{
 const mapping=JSON.stringify({inventory:'5500',inventoryAdjustment:'2000'}),chart=[5500,2000].map(n=>({number:String(n),hidden:false,vatCode:'',kind:'entry'}));
 h.sql.prepare('INSERT INTO accounting_connections(company_id,organization_id,credentials_encrypted,revision,chart_json) VALUES(?,?,?,?,?)').run('company-a','123','synthetic','r1',JSON.stringify(chart));
 h.sql.prepare('INSERT INTO accounting_mapping(company_id,accounts_json) VALUES(?,?)').run('company-a',mapping);
 h.sql.prepare('INSERT INTO tier1_preferences VALUES(?,?,?,?)').run('company-a','shop-a1',JSON.stringify({automation:{inventoryBookDinero:true}}),'r1');
 for(const p of ['shopify','dinero'])h.sql.prepare('INSERT INTO booking_start_dates(company_id,webshop_id,provider,start_date) VALUES(?,?,?,?)').run('company-a','shop-a1',p,'2026-01-01');
 const id=crypto.randomUUID(),version=crypto.randomUUID(),change={inventoryItemId:'gid://shopify/InventoryItem/1',locationId:'gid://shopify/Location/1',compareQuantity:5,quantity:3,unitCostMinor:1000};
 const voucher={VoucherDate:new Date().toISOString().slice(0,10),ExternalReference:'test-stocktake',Lines:[{Description:'Inventory',AccountNumber:2000,BalancingAccountNumber:5500,Amount:20,AccountVatCode:'none',BalancingAccountVatCode:'none'}]};
 const payload={changes:[change],account:{organizationId:'123',revision:'r1',mapping,inventory:5500,adjustment:2000},voucher,adjustmentMinor:-2000,expiresAt:Date.now()+600000};
 h.sql.prepare("INSERT INTO stocktakes(company_id,webshop_id,id,version,phase,payload_json,created_by) VALUES(?,?,?,?,'prepared',?,'local-a')").run('company-a','shop-a1',id,version,JSON.stringify(payload));
 let quantity=4,mutations=0,posts=0,books=0,remote;const guid='12345678-1234-1234-1234-123456789abc';
 const api=loader({jose,'pdf-lib':pdfLib,'./connections':{unseal:async()=>({organizationId:'123'})},'./invoice-source':{shopAccess:async()=>({shop:'test.myshopify.com',accessToken:'synthetic'})},'./inventory-source':{readInventory:async()=>({rows:[{...change,quantity,currency:'DKK'}]})},'./dinero-read':{readDineroAccounts:async()=>chart},'./dinero-write':{dineroClient:async()=>async(path,method,body)=>{if(method==='GET')return remote;if(path.endsWith('/book')){books++;remote.Status='Booked';return remote;}posts++;remote={...body,Guid:guid,Timestamp:'v1',Status:'Draft',Lines:body.Lines.map(l=>({...l,AmountExclVatValue:20,VatAmountValue:0,AmountInclVatValue:20}))};return {Guid:guid};}},fetch:async(url,options)=>{mutations++;const b=JSON.parse(options.body);assert.equal(b.variables.input.quantities[0].changeFromQuantity,5);assert.equal(b.variables.key,id);assert.equal(h.sql.prepare("SELECT phase FROM production_receipts").get().phase,'creating');if(lost)throw Error('lost response');return Response.json({data:{inventorySetQuantities:{inventoryAdjustmentGroup:{createdAt:'now'},userErrors:[]}}});}})('platform/production-stocktake.ts');
 const env={...h.env,PLATFORM_ENV:'production',PLATFORM_EXTERNAL_WRITES:'enabled'},actor={id:'local-a',platformAdmin:false},input={id,version,confirmation:true};
 await assert.rejects(()=>api.commitStocktake(h.env,actor,'company-a','shop-a1',input),/ikke aktiveret/);
 await assert.rejects(()=>api.commitStocktake(env,actor,'company-a','shop-a1',input),/kostpris/);assert.equal(mutations,0);quantity=5;
 const results=await Promise.allSettled([api.commitStocktake(env,actor,'company-a','shop-a1',input),api.commitStocktake(env,actor,'company-a','shop-a1',input)]);
 assert.equal(mutations,1);assert.equal(posts,lost?0:1);assert.equal(books,lost?0:1);assert.equal(h.sql.prepare('SELECT phase FROM production_receipts').get().phase,lost?'uncertain':'booked');
 if(lost)await assert.rejects(()=>api.commitStocktake(env,actor,'company-a','shop-a1',input),/afklaring/);else assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(mutations,1);
 }finally{h.close();}}
});

test('production packaging submits approved current scoped quantities once; lost response never resends',async()=>{
 for(const lost of [false,true]){const h=harness();try{
 h.sql.prepare('INSERT INTO emballage_connections(company_id,webshop_id,identity,credentials_encrypted,context_json,config_json) VALUES(?,?,?,?,?,?)').run('company-a','shop-a1','123','synthetic','{}',JSON.stringify({startDate:'2026-01-01',responsibility:'packaging',mappings:{'1':{household:'home',commercial:'business'}}}));
 let quantity=1000,posts=0;
 const report={id:1,status:'draft',accepts_writes:true,period:{start_date:'2026-04-01',end_date:'2026-06-30'},responsibility:{code:'packaging',product_area:{slug:'packaging'}}};
 const api=loader({jose,'pdf-lib':pdfLib,'./connections':{unseal:async()=>({apiKey:'synthetic'})},'./tier1-history':{dataStartDate:async()=> '2026-01-01'},'./packaging':{handlePackaging:async()=>Response.json({period:{householdGrams:quantity,commercialGrams:2000},sync:{coverage_start:'2026-01-01',coverage_end:'2026-09-01'}})},'./emballage-read':{isSubmitted:s=>s==='submitted',eiReports:async()=>[report],eiRequest:async(key,path,method,body,idempotency,env)=>{if(method==='POST'){posts++;assert.equal(env.PLATFORM_ENV,'production');assert.ok(idempotency);assert.equal(body.answers.home,1);if(lost)throw Error('lost response');return {data:{submission_number:'R1',completed_at:'now',report_status:'submitted'}};}return {data:path==='/me'?{organisation:{id:123,name:'Test'},api_key:{is_test:false}}:{form_version_id:1,fields:[{name:'home',type:'number',unit:'kg',required:true},{name:'business',type:'number',unit:'kg',required:true}]}};}}})('platform/production-emballage.ts');
 const actor={id:'local-a',platformAdmin:false},env={...h.env,PLATFORM_ENV:'production',PLATFORM_EXTERNAL_WRITES:'enabled'},req=new Request('https://portal.example.test/emballage'),call=input=>api.productionEmballage(req,env,actor,'company-a','shop-a1',{quarter:'2026-Q2',...input});
 await assert.rejects(()=>api.productionEmballage(req,h.env,actor,'company-a','shop-a1',{action:'preview',quarter:'2026-Q2'}),/ikke aktiveret/);
 const preview=await(await call({action:'preview'})).json();quantity=1100;await assert.rejects(()=>call({action:'submit',token:preview.token}),/ændret/);assert.equal(posts,0);quantity=1000;
 await Promise.allSettled([call({action:'submit',token:preview.token}),call({action:'submit',token:preview.token})]);assert.equal(posts,1);assert.equal(h.sql.prepare('SELECT phase FROM production_receipts').get().phase,lost?'uncertain':'accepted');
 if(lost)await assert.rejects(()=>call({action:'submit',token:preview.token}),/afklaring/);else assert.equal((await(await call({action:'submit',token:preview.token})).json()).receipt.submission_number,'R1');assert.equal(posts,1);
 }finally{h.close();}}
});
