import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../db/errors.ts', import.meta.url), 'utf8');
test('fejlmail sendes kun efter en ny deduplikeret fejl og indeholder ingen upstream-detaljer', () => {
  assert.match(source, /inserted\.meta\.changes !== 1/);
  assert.match(source, /setting_key='error_notifications'/);
  assert.match(source, /INVOICE_EMAIL\.send/);
  assert.match(source, /Handlingen mislykkedes/);
  assert.match(source, /details_json/);
  assert.match(source, /occurrenceCount/);
  assert.match(source, /sanitizeDiagnostic/);
  assert.doesNotMatch(source, /error\.message/);
});
