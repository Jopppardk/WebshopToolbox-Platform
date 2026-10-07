// Tier 0 smoke test: signs in as the local fixture platform admin (local test login, synthetic data only) and
// goes through the companies, the operations overview and run log, support login to the customer portal and
// back, the integration catalog and the portal settings. Fails on any uncaught browser error.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { SignJWT } from 'jose';

// The same local test session as `node scripts/platform.mjs local-session`, signed with the secret in .dev.vars
// that the smoke server (scripts/portal-smoke-server.mjs) uses.
async function localAdminToken() {
  const secret = readFileSync('.dev.vars', 'utf8').match(
    /^PLATFORM_LOCAL_SECRET=(\w+)/m,
  )?.[1];
  if (!secret) throw Error('.dev.vars mangler PLATFORM_LOCAL_SECRET');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('urn:webshop-toolbox:local-test')
    .setSubject('local-admin')
    .setAudience('platform-local')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret));
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.__errors = errors;
  await page.goto('/local-login');
  const token = await localAdminToken();
  const status = await page.evaluate(async (token) => {
    const response = await fetch('/local-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      redirect: 'manual',
    });
    return response.type === 'opaqueredirect' ? 303 : response.status;
  }, token);
  expect([200, 303]).toContain(status);
  await page.goto('/admin/');
  await expect(page.locator('#title')).toHaveText('Virksomheder');
});
test.afterEach(async ({ page }) => {
  expect(page.__errors, 'no uncaught errors in the browser').toEqual([]);
});

const tab = (page, name) =>
  page.locator('aside').getByRole('button', { name, exact: true });

test('companies, operations overview with run log, integrations and portal settings render', async ({
  page,
}) => {
  const content = page.locator('#content');
  await expect(content).toContainText('Testvirksomhed A');
  await content
    .getByRole('row', { name: /Testvirksomhed A/ })
    .getByRole('button', { name: 'Åbn →' })
    .click();
  await expect(content).toContainText('a@example.test');

  await tab(page, 'Indsigt').click();
  await expect(content).toContainText('Driftsoverblik');
  await expect(content).toContainText('Ingen åbne driftsproblemer.');
  const shops = content.locator('table').filter({ hasText: 'Automatik' });
  await expect(shops).toContainText('Testvirksomhed A · Webshop A1');
  await shops
    .getByRole('row', { name: /Webshop A1/ })
    .getByRole('button', { name: 'Kørselslog' })
    .click();
  // The fixture run stands for twelve quiet runs in a row (collapseRepeat).
  await expect(content).toContainText('12 kørsler uden ændringer siden');

  await tab(page, 'Integrationer').click();
  await expect(page.locator('#title')).toHaveText('Integrationer');
  await tab(page, 'Portalindstillinger').click();
  await expect(page.locator('#title')).toHaveText('Portalindstillinger');
});

test('support login opens the customer portal as the customer and ends again', async ({
  page,
}) => {
  const content = page.locator('#content');
  await content
    .getByRole('row', { name: /Testvirksomhed A/ })
    .getByRole('button', { name: 'Åbn →' })
    .click();
  await content
    .getByRole('row', { name: /a@example\.test/ })
    .getByRole('button', { name: 'Log ind som bruger' })
    .click();
  const dialog = page.locator('#editor');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Kort årsag til supportadgang').fill('Røgtest');
  await dialog.getByRole('button', { name: 'Gem' }).click();
  await page.waitForURL('**/admin/kundeportal/');
  await expect(page.locator('main')).toContainText(
    /Dashboard|Forbind din virksomhed/,
  );
  await page
    .getByRole('button', { name: 'Afslut supportadgang' })
    .first()
    .click();
  await page.waitForURL(/\/admin\/$/);
  await expect(page.locator('#title')).toHaveText('Virksomheder');
});
