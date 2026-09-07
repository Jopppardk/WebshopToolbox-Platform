import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Udvikling kan oprette forslag og følge status i D1', () => {
  const page = read('../app/page.tsx');
  const component = read('../components/development-requests.tsx');
  const route = read('../app/api/admin/feature-requests/route.ts');
  const schema = read('../drizzle/0003_feature_requests.sql');
  const seed = read('../drizzle/0004_seed_feature_requests.sql');
  const numbering = read('../drizzle/0005_feature_request_numbers.sql');
  assert.match(page, /view === 'development'/);
  assert.match(page, />\s*Udvikling\s*</);
  assert.match(component, /Nyt forslag/);
  assert.match(component, /Forslagsoversigt/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /ensureReferenceNumbers/);
  assert.match(route, /referenceNumber/);
  assert.match(component, /#\{item\.reference_number\}/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS feature_requests/);
  assert.match(numbering, /CREATE TABLE IF NOT EXISTS feature_request_numbers/);
  assert.match(numbering, /UNIQUE \(tenant, reference_number\)/);
  for (const title of [
    'Integration til ViaBill',
    'Integration til Flatpay',
    'Integration til Emballageindberetning.dk',
    'Salgsanalyse-side',
  ])
    assert.match(seed, new RegExp(title.replace('.', '\\.')));
});
