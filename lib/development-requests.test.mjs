import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Udvikling kan oprette forslag og følge status i D1', () => {
  const page = read('../app/page.tsx');
  const component = read('../components/development-requests.tsx');
  const route = read('../app/api/admin/feature-requests/route.ts');
  const schema = read('../drizzle/0003_feature_requests.sql');
  assert.match(page, /view === 'development'/);
  assert.match(page, />\s*Udvikling\s*</);
  assert.match(component, /Nyt forslag/);
  assert.match(component, /Forslagsoversigt/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS feature_requests/);
});
