// Portal smoke test: logs in as the fixture user, opens every page of the customer portal and the key dialogs,
// and fails on any uncaught browser error or a page that does not render. Local data only (tests/portal/fixtures.sql).
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.__errors = errors;
  // Customer login against the local test environment, which returns the one-time code in its response.
  // It runs inside the page, so the browser keeps the login cookies exactly as for a real user.
  await page.goto('/login');
  const login = await page.evaluate(async () => {
    const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const start = await (await post('/auth/start', { email: 'a@example.test' })).json();
    if (!start.previewCode) return 'no preview code: ' + JSON.stringify(start);
    const verify = await post('/auth/verify', { challenge: start.challenge, code: start.previewCode });
    return verify.ok ? 'ok' : 'verify ' + verify.status;
  });
  expect(login).toBe('ok');
  await page.goto('/');
});
test.afterEach(async ({ page }) => { expect(page.__errors, 'no uncaught errors in the browser').toEqual([]); });

const nav = (page, name) => page.getByRole('navigation').getByRole('button', { name, exact: true }).or(page.getByRole('button', { name, exact: true })).first();

test('every page of the portal renders', async ({ page }) => {
  const pages = [['Dashboard', /Dashboard|Forbind din virksomhed/], ['Salg', /Salg/], ['Tilbagebetalinger', /Tilbagebetalinger/], ['Udbetalinger', /Udbetalinger/], ['Lager', /Lager/],
    ['Fakturaer', /Fakturaer/], ['Udbetalingsrapporter', /Udbetalingsrapporter/], ['Performance', /Performance/], ['Forsendelser', /Forsendelser/], ['Emballage', /Emballage/],
    ['Produktfeeds', /Produktfeeds/], ['Support', /Support/], ['Indstillinger', /Indstillinger|Generelt/]];
  for (const [name, heading] of pages) {
    await nav(page, name).click();
    await expect(page.locator('main'), name).toContainText(heading);
  }
});

test('Salg: one view per order with invoice, booking, refund and log', async ({ page }) => {
  await nav(page, 'Salg').click();
  await page.getByRole('button', { name: '#2683' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Ordre #2683');
  for (const text of ['Faktura (PDF)', 'Bogført i Dinero', '412', '2683-K1', 'Kreditnota (PDF)', 'Log']) await expect(dialog).toContainText(text);
});

test('Faktura-afsendelse: the Swedish tab mirrors Danmark and its mail text saves', async ({ page }) => {
  await nav(page, 'Indstillinger').click();
  await page.getByRole('tab', { name: 'Faktura-afsendelse' }).click();
  await page.getByRole('tab', { name: /Sverige/ }).click();
  for (const text of ['Fakturér og bogfør ordrer herfra', '1. Design din faktura', '2. Mailtekst', 'Kreditnota', '3. Afsender og testmail']) await expect(page.locator('main')).toContainText(text);
  // Saving the design first and then the mail text once failed with "ændret i en anden fane".
  await page.getByRole('button', { name: 'Gem fakturadesign' }).click();
  await expect(page.locator('main')).toContainText(/gemt/i);
  await page.getByRole('button', { name: 'Gem mailtekst' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gemt.' }).first()).toBeVisible();
  await expect(page.locator('main')).not.toContainText('ændret i en anden fane');
});
