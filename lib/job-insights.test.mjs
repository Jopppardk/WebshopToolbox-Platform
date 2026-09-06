import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('alle planlagte integrationsjobs registreres individuelt', () => {
  const worker = read('../worker-entry.ts');
  for (const key of ['shopify-orders', 'shopify-packaging', 'dinero-sales', 'invoice-email', 'shopify-refunds', 'dinero-refunds', 'shopify-payouts', 'dinero-payouts']) {
    assert.match(worker, new RegExp(`runTrackedJob\\('${key}'`));
  }
  assert.match(read('../db/schema.ts'), /CREATE TABLE IF NOT EXISTS job_runs/);
  assert.match(read('../drizzle/0002_job_runs.sql'), /idx_job_runs_tenant_started/);
});

test('Indsigt har opsummering, seneste jobstatus og kørselslog', () => {
  const page = read('../app/page.tsx'), component = read('../components/job-insights.tsx'), route = read('../app/api/admin/insights/route.ts');
  assert.match(page, />Indsigt</);
  assert.match(page, /view === 'insights'/);
  assert.match(component, /Kørsler seneste 24 timer/);
  assert.match(component, /Aktuelle jobs/);
  assert.match(component, /Jobhistorik/);
  assert.match(route, /ROW_NUMBER\(\) OVER \(PARTITION BY job_key/);
  assert.match(route, /LIMIT 100/);
});
