import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture, loader } from './automation-test-fixture.mjs';

function harness() {
  const h = databaseFixture();
  h.order = {
    id: 'gid://shopify/Order/123',
    email: 'customer@example.invalid',
    name: '#123',
    fulfillments: [{}],
  };
  h.record(
    'invoice',
    h.order.id,
    { order: h.order, r2Key: 'fixture.pdf', invoiceFingerprint: 'same' },
    undefined,
    'generated',
  );
  h.sends = 0;
  h.failOrder = false;
  h.failPdf = false;
  h.send = async () => ({ messageId: 'fixture-message' });
  const overrides = {
    'next/server': {
      NextResponse: {
        json: (data, options = {}) => ({ data, status: options.status || 200 }),
      },
    },
    'cloudflare:workers': {
      env: {
        INVOICES: {
          get: async () => {
            if (h.failPdf) throw Error('PDF failed');
            return { arrayBuffer: async () => new ArrayBuffer(1) };
          },
        },
        INVOICE_EMAIL: {
          send: async () => {
            h.sends++;
            return h.send();
          },
        },
      },
    },
    '@/db/database': { prepareDatabase: async () => h.db },
    '@/db/errors': { recordFailure: async () => {} },
    '@/db/shopify-order': {
      loadCompleteOrder: async () => {
        if (h.failOrder) throw Error('source unavailable');
        return h.order;
      },
    },
    '@/lib/admin-settings': { validateSettings: (x) => x },
    '@/lib/invoice-check': {
      InvoiceCheckError: class extends Error {},
      invoiceFingerprint: async () => 'same',
    },
    '@/lib/invoice-email': {
      invoiceFilename: () => 'fixture.pdf',
      renderInvoiceEmail: () => ({
        invoice: {},
        subject: 'fixture',
        text: 'fixture',
      }),
    },
  };
  h.post = () =>
    loader(overrides)('app/api/invoices/email/route.ts').POST({
      headers: new Headers({
        origin: 'https://fixture.invalid',
        'content-type': 'application/json',
        'cf-access-authenticated-user-email': 'rene@sablen.dk',
      }),
      nextUrl: { origin: 'https://fixture.invalid' },
      json: async () => ({ externalId: h.order.id }),
    });
  h.delivery = () =>
    h.sql.prepare('SELECT * FROM invoice_email_deliveries').get();
  return h;
}

test('accepted email with failed receipt remains blocked across subsequent requests', async () => {
  const h = harness();
  h.faults.beforeRun = (query) => {
    if (query.includes("SET status='sent'")) throw Error('receipt failed');
  };
  assert.equal((await h.post()).status, 503);
  assert.equal(h.delivery().status, 'sending');
  assert.match(h.delivery().error_message, /genafsendelse er blokeret/);
  assert.equal((await h.post()).status, 409);
  assert.equal(h.sends, 1);
});

test('timeout, missing receipt and even failure to record the error cannot reopen a send', async () => {
  for (const send of [
    async () => {
      throw Error('timeout after acceptance');
    },
    async () => ({}),
  ]) {
    const h = harness();
    h.send = send;
    h.faults.beforeRun = (query) => {
      if (query.includes('SET error_message='))
        throw Error('database unavailable');
    };
    assert.equal((await h.post()).status, 503);
    assert.equal(h.delivery().status, 'sending');
    assert.equal((await h.post()).status, 409);
    assert.equal(h.sends, 1);
  }
});

test('concurrent requests share one durable claim and send only once', async () => {
  const h = harness();
  const results = await Promise.all([h.post(), h.post(), h.post()]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 2);
  assert.equal(h.sends, 1);
  assert.equal(h.delivery().status, 'sent');
  assert.equal(h.delivery().provider_message_id, 'fixture-message');
  assert.equal((await h.post()).status, 409);
});

test('failure before claiming leaves no delivery and allows a later corrected request', async () => {
  const h = harness();
  h.failPdf = true;
  assert.equal((await h.post()).status, 503);
  assert.equal(h.delivery(), undefined);
  assert.equal(h.sends, 0);
  h.failPdf = false;
  assert.equal((await h.post()).status, 200);
  assert.equal(h.sends, 1);
});

test('historical failed deliveries are not blindly retried', async () => {
  const h = harness();
  h.sql
    .prepare(
      "INSERT INTO invoice_email_deliveries(id,external_id,recipient,delivery_mode,status) VALUES(?,?,?,'customer','failed')",
    )
    .run('invoice-email:customer:' + h.order.id, h.order.id, h.order.email);
  assert.equal((await h.post()).status, 409);
  assert.equal(h.sends, 0);
  assert.equal(h.delivery().status, 'failed');
});

test('a request failing validation cannot change another in-flight delivery', async () => {
  const h = harness();
  let release, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  h.send = async () => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return { messageId: 'fixture-message' };
  };
  const sending = h.post();
  await started;
  h.failOrder = true;
  assert.equal((await h.post()).status, 503);
  assert.equal(h.delivery().status, 'sending');
  release();
  assert.equal((await sending).status, 200);
  assert.equal(h.sends, 1);
});
