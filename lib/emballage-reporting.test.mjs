import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture, loader } from './automation-test-fixture.mjs';
const logic = loader()('lib/emballage-reporting.ts');
const config = {
  startDate: '2025-01-01',
  responsibility: 'packaging',
  cvrSource: 'attribute',
  cvrField: 'CVR',
  mappings: { 7: { household: 'home', commercial: 'business' } },
};
const schema = {
  form_version_id: 7,
  fields: [
    { name: 'home', type: 'number', unit: 'kg', required: true },
    { name: 'business', type: 'number', unit: 'kg', required: true },
  ],
};
const q = logic.recentQuarters()[0];
const row = {
  eventId: 'one',
  date: q.start,
  quantity: 2,
  weightGrams: 125,
  reportable: 'yes',
  audience: 'household',
};
test('five completed quarters handle Danish midnight and year boundaries', () => {
  const quarters = logic.recentQuarters(new Date('2026-03-31T22:30:00Z'));
  assert.equal(quarters.length, 5);
  assert.equal(quarters[0].id, '2026-Q1');
  assert.equal(quarters[4].id, '2025-Q1');
  assert.throws(() =>
    logic.validateEIConfig({ ...config, startDate: '2026-02-01' }),
  );
});
test('CVR field controls customer classification without confusing supplier CVR', () => {
  assert.equal(
    logic.orderAudience(
      { customAttributes: [{ key: 'CVR', value: '12345678' }] },
      config,
    ),
    'commercial',
  );
  assert.equal(
    logic.orderAudience({ customAttributes: [] }, config),
    'household',
  );
  assert.equal(logic.orderAudience({}, config), 'unknown');
  assert.equal(
    logic.orderAudience(
      { reportingCvr: { value: '12345678' } },
      { ...config, cvrSource: 'metafield' },
    ),
    'commercial',
  );
});
test('quarter totals include manual entries and block unknown weights or classification', () => {
  const t = logic.quarterTotals(
    [row, { ...row, eventId: 'old', date: '2000-01-01' }],
    [
      {
        date: q.start,
        weightGrams: 50,
        reportable: 'yes',
        audience: 'commercial',
      },
    ],
    q.start,
    q.end,
  );
  assert.equal(t.householdGrams, 250);
  assert.equal(t.commercialGrams, 50);
  assert.equal(t.unresolved, 0);
  for (const change of [
    { weightGrams: null },
    { reportable: 'unknown' },
    { audience: undefined },
  ])
    assert.equal(
      logic.quarterTotals([{ ...row, ...change }], [], q.start, q.end)
        .unresolved,
      1,
    );
});
test('schema mappings use exact kg fields and reject changed or incomplete contracts', () => {
  assert.deepEqual(
    logic.mappedAnswers(schema, config.mappings['7'], {
      householdGrams: 250,
      commercialGrams: 50,
    }),
    { home: 0.25, business: 0.05 },
  );
  assert.throws(() => logic.mappedAnswers(schema, undefined, {}));
  assert.throws(() =>
    logic.mappedAnswers(
      {
        ...schema,
        fields: [
          ...schema.fields,
          { name: 'terms', type: 'checkbox', required: true },
        ],
      },
      config.mappings['7'],
      {},
    ),
  );
  assert.throws(() =>
    logic.mappedAnswers(
      { ...schema, fields: schema.fields.map((f) => ({ ...f, unit: 'ton' })) },
      config.mappings['7'],
      {},
    ),
  );
});
function fixture(testMode = false) {
  const h = databaseFixture(),
    writes = [];
  let remoteStatus = 'draft',
    timeout = false;
  const report = {
    id: 42,
    status: 'draft',
    accepts_writes: true,
    period: { start_date: q.start, end_date: q.end, label: q.label },
    responsibility: { code: 'packaging', product_area: { slug: 'packaging' } },
  };
  h.set('emballage_config', config);
  h.set('packaging:snapshot:one', row);
  h.set('packaging:reporting-coverage', {
    start: config.startDate,
    end: q.end,
    cvrField: 'CVR',
    cvrSource: 'attribute',
  });
  const api = loader({
    '@/db/database': { prepareDatabase: async () => h.db },
    '@/db/credentials': {
      loadCredentials: async () => ({
        apiKey: 'esk_test.secret',
        organisationId: '17',
      }),
    },
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      let data;
      if (path.endsWith('/me'))
        data = {
          organisation: { id: 17, name: 'Example' },
          api_key: { is_test: testMode },
        };
      else if (path.endsWith('/reports'))
        data = [
          {
            ...report,
            status: remoteStatus,
            accepts_writes: remoteStatus === 'draft',
          },
        ];
      else if (path.endsWith('/schema')) data = schema;
      else if (path.endsWith('/submit')) {
        writes.push(options);
        if (timeout) throw Error('secret must never leak');
        if (!testMode) remoteStatus = 'submitted';
        data = {
          submission_number: 'SUB-42',
          completed_at: new Date().toISOString(),
          report_status: testMode ? 'draft' : 'submitted',
        };
      } else throw Error('Unexpected endpoint ' + path);
      return Response.json({ data, meta: { next_cursor: null } });
    },
  })('db/emballage.ts');
  return {
    ...h,
    api,
    writes,
    setTimeout: (value) => (timeout = value),
    setStatus: (value) => (remoteStatus = value),
  };
}
test('preview sends nothing; confirmed submit sends exact answers and stores receipt', async () => {
  const h = fixture();
  const p = await h.api.prepareEIReport(q.id);
  assert.equal(h.writes.length, 0);
  const result = await h.api.submitEIReport(q.id, p.token);
  assert.equal(result.testMode, false);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(JSON.parse(h.writes[0].body), {
    answers: { home: 0.25, business: 0 },
  });
  assert.equal(
    h.sql.prepare('SELECT state FROM emballage_submissions').get().state,
    'submitted',
  );
  assert.equal((await h.api.reportingOverview()).quarters[0].submitted, true);
  await assert.rejects(
    () => h.api.submitEIReport(q.id, p.token),
    /allerede indberettet/,
  );
  assert.equal(h.writes.length, 1);
});
test('stale preview and missing coverage block all writes', async () => {
  const h = fixture(),
    p = await h.api.prepareEIReport(q.id);
  h.set('packaging:snapshot:one', { ...row, quantity: 3 });
  await assert.rejects(() => h.api.submitEIReport(q.id, p.token), /ændret/);
  assert.equal(h.writes.length, 0);
  h.set('packaging:reporting-coverage', { start: '2099-01-01' });
  await assert.rejects(() => h.api.prepareEIReport(q.id), /historikken/);
});
test('timeout retries preserve the idempotency key and immutable payload', async () => {
  const h = fixture(),
    p = await h.api.prepareEIReport(q.id);
  h.setTimeout(true);
  await assert.rejects(
    () => h.api.submitEIReport(q.id, p.token),
    /kunne ikke kontaktes/,
  );
  h.set('packaging:snapshot:one', { ...row, quantity: 3 });
  const changed = await h.api.prepareEIReport(q.id);
  await assert.rejects(
    () => h.api.submitEIReport(q.id, changed.token),
    /afventer afklaring/,
  );
  h.set('packaging:snapshot:one', row);
  h.setTimeout(false);
  await h.api.submitEIReport(q.id, p.token);
  assert.equal(h.writes.length, 2);
  assert.equal(
    h.writes[0].headers['Idempotency-Key'],
    h.writes[1].headers['Idempotency-Key'],
  );
});
test('concurrent clicks serialize submission; test receipt never marks report submitted', async () => {
  const h = fixture(true),
    p = await h.api.prepareEIReport(q.id);
  const results = await Promise.allSettled([
    h.api.submitEIReport(q.id, p.token),
    h.api.submitEIReport(q.id, p.token),
  ]);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  assert.equal(h.writes.length, 1);
  assert.equal((await h.api.reportingOverview()).quarters[0].submitted, false);
  assert.equal(
    h.sql.prepare('SELECT state FROM emballage_submissions').get().state,
    'tested',
  );
});
test('API rejects redirects and untrusted paths without exposing credential-bearing responses', async () => {
  let calls = 0;
  const api = loader({
    fetch: async () => {
      calls++;
      return Response.json(
        { code: 'authentication_failed', message: 'esk_test.secret' },
        { status: 401 },
      );
    },
  })('lib/emballage-api.ts');
  await assert.rejects(
    () => api.eiRequest('esk_test.secret', '/me'),
    (e) => !e.message.includes('secret') && e.status === 401,
  );
  await assert.rejects(
    () => api.eiRequest('esk_test.secret', '//elsewhere.test'),
    /Ugyldigt/,
  );
  assert.equal(calls, 1);
});

test('credentials remain encrypted and provider selection is automatic', async () => {
  const h = databaseFixture(),
    old = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.CREDENTIALS_ENCRYPTION_KEY = btoa('x'.repeat(32));
  try {
    const credentials = loader({
      './database': { prepareDatabase: async () => h.db, database: () => h.db },
    })('db/credentials.ts');
    await credentials.saveCredentials(
      'emballage',
      { apiKey: 'esk_fixture.private', organisationId: '17' },
      'Example',
    );
    assert.ok(
      !JSON.stringify(h.get('emballage_credentials')).includes('private'),
    );
    assert.equal(
      (await credentials.loadCredentials('emballage', true)).apiKey,
      'esk_fixture.private',
    );
    const selection = loader()('db/integration-selection.ts');
    assert.ok(
      (await selection.integrationSelection(h.db)).connected.includes(
        'emballage',
      ),
    );
    assert.equal(
      await selection.selectIntegration(h.db, 'emballage', false),
      false,
    );
  } finally {
    if (old === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = old;
  }
});
test('reporting endpoint rejects foreign origin before any work', async () => {
  const route = loader({
    'next/server': {
      NextResponse: { json: (data, options) => ({ data, ...options }) },
    },
    '@/db/emballage': {},
    '@/db/database': {},
    '@/app/api/shopify/packaging/route': {},
  })('app/api/emballage/reporting/route.ts');
  const r = await route.POST(
    new Request('https://integration.test/api/emballage/reporting', {
      method: 'POST',
      headers: {
        origin: 'https://foreign.test',
        'content-type': 'application/json',
      },
      body: '{}',
    }),
  );
  assert.equal(r.status, 403);
});

test('full packaging import preserves historic weights and classifies CVR and test orders',async()=>{
 const h=databaseFixture();h.set('packaging:snapshot:line',{...row,eventId:'line',weightGrams:40,quantity:2,reportable:'yes',snapshottedAt:'2025-01-01'});
 const query=async(_access,queryText)=>{
   if(queryText.includes('PackagingHistoryAccess'))return {currentAppInstallation:{accessScopes:[{handle:'read_all_orders'}]}};
   if(queryText.includes('PackagingOrders'))return {orders:{nodes:[{id:'order',name:'#1',test:false,customAttributes:[{key:'CVR',value:'12345678'}],fulfillments:[{id:'fulfillment',createdAt:q.start+'T12:00:00Z',status:'SUCCESS',fulfillmentLineItems:{nodes:[{id:'line',quantity:2,lineItem:{title:'P',variant:{id:'v',title:'V',product:{id:'p',title:'P'}}}}],pageInfo:{hasNextPage:false}}}]}],pageInfo:{hasNextPage:false}}};
   if(queryText.includes('PackagingProducts'))return {nodes:[{id:'p',title:'P',packagingWeight:{value:'999'},packagingReportable:{value:'yes'}}]};
   throw Error('Unexpected Shopify query');
 };
 const route=loader({'next/server':{NextResponse:{}},'@/db/database':{database:()=>h.db},'@/db/shopify':{getShopifyAccess:async()=>({})},'@/db/shopify-order':{orderQuery:query},'@/db/errors':{},'@/db/emballage':{getEIConfig:async()=>config}})('app/api/shopify/packaging/route.ts');
 await route.syncPackaging(config.startDate,q.end,true);
 assert.equal(h.get('packaging:snapshot:line').weightGrams,40);
 assert.equal(h.get('packaging:snapshot:line').audience,'commercial');
 assert.equal(h.get('packaging:reporting-coverage').start,config.startDate);
 assert.equal(logic.quarterTotals([{...row,test:true}],[],q.start,q.end).householdGrams,0);
});
