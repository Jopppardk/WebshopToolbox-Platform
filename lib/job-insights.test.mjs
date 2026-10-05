import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixture, loader } from './automation-test-fixture.mjs';

function setup() {
  const h = databaseFixture();
  const now = Date.now(), until = new Date(now).toISOString();
  const add = (id, key, stamp, tenant = 'sablen.dk') => h.sql.prepare('INSERT INTO job_runs(id,tenant,job_key,job_name,status,started_at) VALUES(?,?,?,?,?,?)').run(id,tenant,key,key,key === 'refunds' ? 'failed' : 'succeeded',stamp);
  for (let i=0;i<205;i++) add(String(i).padStart(4,'0'), i%2 ? 'sales' : 'refunds', new Date(now-1000).toISOString());
  h.sql.prepare("UPDATE job_runs SET status='running' WHERE id='0000'").run();
  h.sql.prepare("UPDATE job_runs SET status='skipped' WHERE id='0002'").run();
  add('old','refunds',new Date(now-86400001).toISOString());
  add('foreign','refunds',until,'other');
  const GET = loader({ 'next/server': { NextResponse: { json: (data, options = {}) => ({ data, status: options.status || 200 }) } }, '@/db/database': { prepareDatabase: async () => h.db } })('app/api/admin/insights/route.ts').GET;
  const get = (params = {}) => GET(new Request('https://example.test/api/admin/insights?' + new URLSearchParams({until,...params})));
  return {...h,get,add,until};
}

test('job history returns a full day in stable pages of 100 without overlaps', async () => {
  const h=setup(); try {
    const a=await h.get(); assert.equal(a.data.pagination.total,205); assert.equal(a.data.runs.length,100);
    h.add('new','sales',new Date(Date.parse(h.until)+1).toISOString());
    const b=await h.get({page:'2'}), c=await h.get({page:'3'});
    assert.equal(b.data.runs.length,100); assert.equal(c.data.runs.length,5);
    const ids=[...a.data.runs,...b.data.runs,...c.data.runs].map(x=>x.id);
    assert.equal(new Set(ids).size,205); assert.ok(!ids.includes('old')); assert.ok(!ids.includes('foreign')); assert.ok(!ids.includes('new'));
  } finally { h.sql.close(); }
});

test('status filtering happens before pagination and preserves global summary', async () => {
  const h=setup(); try {
    const a=await h.get({status:'failed'}), b=await h.get({status:'failed',page:'2'});
    assert.equal(a.data.pagination.total,101); assert.equal(b.data.runs.length,1);
    assert.ok([...a.data.runs,...b.data.runs].every(x=>x.status==='failed'));
    assert.equal(a.data.summary.total,205);
    for (const [status, count] of [['succeeded',102],['running',1],['skipped',1]]) {
      const result=await h.get({status}); assert.equal(result.data.pagination.total,count); assert.ok(result.data.runs.every(x=>x.status===status));
    }
    assert.equal((await h.get({status:'missing'})).status,400);
    assert.equal((await h.get()).data.pagination.total,205);
  } finally { h.sql.close(); }
});

test('invalid job history pagination and dates are rejected', async () => {
  const h=setup(); try {
    for (const params of [{page:'0'},{page:'1.5'},{page:'100001'},{until:'invalid'},{until:'2020-01-01T00:00:00.000Z'}]) assert.equal((await h.get(params)).status,400);
  } finally { h.sql.close(); }
});
