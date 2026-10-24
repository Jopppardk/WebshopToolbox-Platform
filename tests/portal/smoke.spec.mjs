// Portal smoke test: logs in as the fixture user, opens every page of the customer portal and the key dialogs,
// and fails on any uncaught browser error or a page that does not render. Local data only (tests/portal/fixtures.sql).
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.__errors = errors;
  // Customer login against the local test environment, which returns the one-time code in its response.
  // It runs inside the page, so the browser keeps the login cookies exactly as for a real user.
  await page.goto('/login');
  const login = await page.evaluate(async () => {
    const post = (path, body) =>
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const start = await (
      await post('/auth/start', { email: 'a@example.test' })
    ).json();
    if (!start.previewCode) return 'no preview code: ' + JSON.stringify(start);
    const verify = await post('/auth/verify', {
      challenge: start.challenge,
      code: start.previewCode,
    });
    return verify.ok ? 'ok' : 'verify ' + verify.status;
  });
  expect(login).toBe('ok');
  await page.goto('/');
});
test.afterEach(async ({ page }) => {
  expect(page.__errors, 'no uncaught errors in the browser').toEqual([]);
});

const nav = (page, name) =>
  page
    .getByRole('navigation')
    .getByRole('button', { name, exact: true })
    .or(page.getByRole('button', { name, exact: true }))
    .first();

// Also checks that views load on first use (Performance brings the chart library) and that built files may be cached.
// One login per test: the login is rate limited.
test('every page of the portal renders', async ({ page }) => {
  const scripts = [];
  page.on('response', (response) => {
    if (response.url().endsWith('.js'))
      scripts.push({
        url: response.url(),
        cache: response.headers()['cache-control'],
      });
  });
  await page.reload();
  await expect(page.locator('main')).toContainText(
    /Dashboard|Forbind din virksomhed/,
  );
  // One card per webshop with today's activity and shipments, each read from its own webshop.
  const card = (name) => page.getByRole('article', { name, exact: true });
  for (const name of ['Webshop A1', 'Webshop A2']) {
    await expect(card(name)).toContainText('Udbetalinger');
    await expect(card(name)).toContainText('Forsendelser');
    await expect(card(name)).toContainText('Afventer afhentning');
  }
  await expect(card('Webshop A1')).toContainText('Valgt');
  await expect(card('Webshop A2')).toContainText('Skift hertil');
  // Økonomi: a card per webshop (Shopify) and one for the whole company (Dinero).
  for (const name of ['Webshop A1', 'Webshop A2'])
    await expect(card('Økonomi for ' + name)).toContainText('Lagerværdi');
  await expect(card('Økonomi for Testvirksomhed A')).toContainText(
    'Samlet for alle webshops',
  );
  await expect(card('Økonomi for Testvirksomhed A')).toContainText(
    'Omsætning år til dato',
  );
  await expect(card('Økonomi for Testvirksomhed A')).toContainText(
    'Overskud år til dato',
  );
  await expect(card('Økonomi for Webshop A1')).not.toContainText('Overskud');
  // "Kræver handling" lists the fixture's failed sale and opens Salg.
  const attention = page.getByRole('region', { name: /Kræver handling/ });
  await expect(attention).toContainText('Fejlede poster · 1');
  await expect(attention).toContainText('Ordre #2701');
  await expect(attention).toContainText('Momsen stemmer ikke.');
  // "Prøv igen nu" is shown on the failed post (disabled locally, where bookkeeping is blocked).
  await expect(
    attention.getByRole('button', { name: 'Prøv igen nu' }),
  ).toBeVisible();
  // "Afvis" takes it off the list after a confirmation; "Vis afviste" → "Fortryd" puts it back.
  await attention.getByRole('button', { name: 'Afvis', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Afvis' }).click();
  await expect(attention).toContainText('Intet kræver din handling lige nu.');
  await attention.getByRole('button', { name: 'Vis afviste (1)' }).click();
  await expect(attention).toContainText('Afvist');
  await attention.getByRole('button', { name: 'Fortryd' }).click();
  await expect(attention).toContainText('Fejlede poster · 1');
  await attention.getByRole('button', { name: /Ordre #2701/ }).click();
  await expect(page.locator('main')).toContainText('#2683');
  expect(
    scripts.some((script) => /\/performance-[\w-]+\.js$/.test(script.url)),
    'Performance is not loaded up front',
  ).toBe(false);
  expect(
    scripts.find((script) => /\/react-[\w-]+\.js$/.test(script.url))?.cache,
  ).toBe('private, max-age=31536000, immutable');
  const pages = [
    ['Dashboard', /Dashboard|Forbind din virksomhed/],
    ['Salg', /Salg/],
    ['Tilbagebetalinger', /Tilbagebetalinger/],
    ['Udbetalinger', /Udbetalinger/],
    ['Lager', /Lager/],
    ['Fakturaer', /Fakturaer/],
    ['Udbetalingsrapporter', /Udbetalingsrapporter/],
    ['Performance', /Performance/],
    ['Forsendelser', /Forsendelser/],
    ['Emballage', /Emballage/],
    ['Produktfeeds', /Produktfeeds/],
    ['Eksempel', /Forbindelsen til appen virker/],
    ['Webshop-synkronisering', /mindst to webshops forbundet til Shopify/],
    ['Support', /Support/],
    ['Indstillinger', /Indstillinger|Generelt/],
  ];
  for (const [name, heading] of pages) {
    const loaded =
      name === 'Performance' &&
      page.waitForResponse((response) =>
        /\/performance-[\w-]+\.js$/.test(response.url()),
      );
    await nav(page, name).click();
    if (loaded)
      expect((await loaded).ok(), 'Performance loads when opened').toBe(true);
    await expect(page.locator('main'), name).toContainText(heading);
    // Each page with data has exactly one "Opdatér" (refresh-button.tsx), no other ways to fetch.
    if (withRefresh.includes(name))
      await expect(
        page
          .locator('main')
          .getByRole('button', { name: 'Opdatér', exact: true }),
        name,
      ).toHaveCount(1);
  }
  // Headings name the webshop the page shows.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Indstillinger for Webshop A1',
  );
  await nav(page, 'Produktfeeds').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Produktfeeds for Webshop A1',
  );
  // Performance: the webshop's own charts come first, the company's bookkeeping last.
  await nav(page, 'Performance').click();
  const sections = page.locator('main section[aria-labelledby]');
  await expect(sections.nth(0)).toContainText('Webshop · Webshop A1');
  await expect(sections.nth(0)).toContainText('Salg pr. dag');
  await expect(sections.nth(0)).toContainText('Besøg');
  await expect(sections.nth(1)).toContainText(/Virksomhed · /);
  await expect(sections.nth(1)).toContainText('Omsætning');
  // Every month of the year can be chosen for Salg pr. dag, also those that have not begun.
  await expect(
    page.getByLabel('Måned for salg pr. dag').locator('option'),
  ).toHaveCount(12);
  // Emballage has a card per webshop, like the dashboard.
  await nav(page, 'Emballage').click();
  for (const name of ['Webshop A1', 'Webshop A2'])
    await expect(page.getByRole('article', { name })).toContainText(
      'Indberetningspligtig',
    );
});
const withRefresh = [
  'Dashboard',
  'Salg',
  'Tilbagebetalinger',
  'Udbetalinger',
  'Lager',
  'Fakturaer',
  'Performance',
  'Forsendelser',
  'Emballage',
];

test('Salg: one view per order with invoice, booking, refund and log', async ({
  page,
}) => {
  await nav(page, 'Salg').click();
  await page.getByRole('button', { name: '#2683' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Ordre #2683');
  for (const text of [
    'Faktura (PDF)',
    'Bogført i Dinero',
    '412',
    '2683-K1',
    'Kreditnota (PDF)',
    'Log',
  ])
    await expect(dialog).toContainText(text);
});

test('Indstillinger: the Swedish tab mirrors Danmark, and Tilføj webshop opens the Shopify connection', async ({
  page,
}) => {
  await nav(page, 'Indstillinger').click();
  await page.getByRole('tab', { name: 'Faktura-afsendelse' }).click();
  await page.getByRole('tab', { name: /Sverige/ }).click();
  for (const text of [
    'Fakturér og bogfør ordrer herfra',
    '1. Design din faktura',
    '2. Mailtekst',
    'Kreditnota',
    '3. Afsender og testmail',
  ])
    await expect(page.locator('main')).toContainText(text);
  // Saving the design first and then the mail text once failed with "ændret i en anden fane".
  await page.getByRole('button', { name: 'Gem fakturadesign' }).click();
  await expect(page.locator('main')).toContainText(/gemt/i);
  await page.getByRole('button', { name: 'Gem mailtekst' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Gemt.' }).first(),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText(
    'ændret i en anden fane',
  );
  // Sverige belongs to the webshop; the page heading names it.
  await expect(page.getByRole('note', { name: 'Du retter' })).toContainText(
    'Du retter Sverige for Webshop A1.',
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Faktura-afsendelse for Webshop A1',
  );
  // Danmark: the webshop can have its own invoice settings, and go back to the company's. A bar says which
  // invoice is edited and which webshops it reaches.
  await page.getByRole('tab', { name: /Danmark/ }).click();
  const profile = page.getByRole('region', {
    name: 'Fakturaopsætning for webshoppen',
  });
  const editing = page.getByRole('note', { name: 'Du retter' });
  await expect(editing).toContainText('Du retter den fælles faktura.');
  await expect(profile).toContainText('Bruges af Webshop A1 og Webshop A2.');
  await profile
    .getByRole('radio', { name: /Egen faktura for Webshop A1/ })
    .click();
  await expect(editing).toContainText('Du retter fakturaen for Webshop A1.');
  await expect(editing).toContainText('gælder kun Webshop A1');
  await expect(page.locator('main')).toContainText(
    'Gælder kun denne webshops nye fakturaer.',
  );
  await profile.getByRole('radio', { name: /Fælles faktura/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Brug fælles opsætning' })
    .click();
  await expect(editing).toContainText('Du retter den fælles faktura.');
  // Tilføj webshop: from Integrationer straight to the Shopify connection, and back.
  // In this test because logins are rate limited.
  await nav(page, 'Indstillinger').click();
  await page.getByRole('tab', { name: /Integrationer/ }).click();
  await page.getByRole('button', { name: 'Tilføj webshop' }).click();
  const region = page.getByRole('region', { name: 'Ny webshop' });
  await expect(region).toContainText('Tilføj en ny webshop');
  await expect(page.getByLabel('Shopify butiksadresse')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Test og opret webshop' }),
  ).toBeVisible();
  await region.getByRole('button', { name: 'Fortryd' }).click();
  const selector = page
    .locator('header')
    .getByRole('button', { name: /^Webshop:/ });
  await expect(selector).toHaveAccessibleName('Webshop: Webshop A1');
  // Fortryd returns to the webshop the user came from, also when it is not the first.
  const choose = async (name) => {
    await selector.click();
    await page.getByRole('menuitem', { name }).click();
  };
  await choose(/Webshop A2/);
  await expect(selector).toHaveAccessibleName('Webshop: Webshop A2');
  await choose('Tilføj webshop');
  await expect(selector).toHaveAccessibleName('Webshop: Ny webshop');
  await page
    .getByRole('region', { name: 'Ny webshop' })
    .getByRole('button', { name: 'Fortryd' })
    .click();
  await expect(selector).toHaveAccessibleName('Webshop: Webshop A2');
  // The webshop selector is also in the menu on small screens.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /menu/i }).first().click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: /^Webshop:/ }),
  ).toBeVisible();
});
