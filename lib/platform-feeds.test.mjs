// Product feeds.
import {
  test,
  assert,
  loader,
  feedSettings,
  feedFixture,
  testShopConnections,
} from './platform-harness.mjs';

test('product feeds isolate tenants and overlapping IDs; PartnerAds preserves pricing, selection and public revocation', async () => {
  const h = feedFixture();
  try {
    await testShopConnections(h, h.env);
    assert.equal((await h.call('', 'GET', undefined, 'shop-b1')).status, 404);
    assert.equal(
      (await h.call('', 'POST', feedSettings, 'shop-a1', 'local-reader'))
        .status,
      403,
    );
    assert.equal(
      (await h.call('', 'POST', feedSettings, 'shop-a1', 'local-admin')).status,
      403,
    );
    const response = await h.call('', 'POST', feedSettings);
    assert.equal(response.status, 201, await response.clone().text());
    let f = await response.json();
    const publicPath = new URL(f.url).pathname;
    assert.match(publicPath, /^\/feeds\/[a-z0-9-]+\/partnerads\.xml$/);
    const tokenPath = () =>
      '/feeds/' +
      h.sql
        .prepare('SELECT public_token FROM product_feeds WHERE id=?')
        .get(f.id).public_token +
      '.xml';
    assert.equal(
      (await h.request(publicPath, { auth: false, env: h.env })).status,
      404,
    );
    assert.equal(
      (await h.call('/' + f.id + '/refresh', 'POST', { revision: f.revision }))
        .status,
      200,
    );
    let xml = await h.call('/' + f.id + '/preview');
    assert.equal(xml.status, 200);
    const body = await xml.text();
    assert.equal((body.match(/<produkt>/g) || []).length, 2);
    assert.match(body, /<variantid>1<\/variantid>/);
    assert.match(body, /<gammelpris>99.00<\/gammelpris>/);
    assert.match(body, /<fragtomk>0<\/fragtomk>/);
    assert.match(body, /<fragtomk>39.00<\/fragtomk>/);
    assert.match(body, /Sabel &amp; glas/);
    assert.doesNotMatch(body, /bad\(\)|<script>/);
    assert.equal(
      (await h.call('/' + f.id + '/preview', 'GET', undefined, 'shop-a2'))
        .status,
      404,
    );
    const second = await (
      await h.call('', 'POST', feedSettings, 'shop-a2')
    ).json();
    assert.equal(
      (
        await h.call(
          '/' + second.id + '/refresh',
          'POST',
          { revision: 1 },
          'shop-a2',
        )
      ).status,
      200,
    );
    assert.equal(h.objects.size, 2);
    assert.ok([...h.objects.keys()].some((k) => k.includes('/shop-a2/')));
    assert.equal(
      (
        await h.call('/' + f.id, 'PUT', {
          ...feedSettings,
          enabled: true,
          revision: f.revision,
        })
      ).status,
      200,
    );
    h.sql.exec('UPDATE product_feeds SET last_attempt=0');
    xml = await h.request(publicPath, { auth: false, env: h.env });
    assert.equal(xml.status, 200, await xml.clone().text());
    assert.match(xml.headers.get('content-type'), /application\/xml/);
    assert.match(xml.headers.get('x-robots-tag'), /noindex/);
    // No page policy on the feed, so browsers show it as an XML tree like the previous feed.sablen.dk.
    assert.equal(xml.headers.get('content-security-policy'), null);
    assert.equal(xml.headers.get('x-content-type-options'), 'nosniff');
    const calls = h.state.calls;
    assert.equal(
      (await h.request(publicPath, { auth: false, env: h.env })).status,
      200,
    );
    assert.equal(h.state.calls, calls);
    f = (await (await h.call()).json()).feeds.find((x) => x.id === f.id);
    assert.equal(
      (await h.call('/' + f.id, 'PUT', { ...feedSettings, revision: 1 }))
        .status,
      409,
    );
    // The original token link keeps working next to the readable one, and can still be replaced.
    const oldToken = tokenPath();
    assert.equal(
      (await h.request(oldToken, { auth: false, env: h.env })).status,
      200,
    );
    const rotated = await (
      await h.call('/' + f.id + '/rotate', 'POST', { revision: f.revision })
    ).json();
    assert.equal(rotated.url, f.url);
    assert.equal(
      (await h.request(oldToken, { auth: false, env: h.env })).status,
      404,
    );
    assert.equal(
      (await h.request(tokenPath(), { auth: false, env: h.env })).status,
      200,
    );
    assert.equal(
      (await h.request(publicPath, { auth: false, env: h.env })).status,
      200,
    );
    assert.equal(
      (
        await h.call('/' + f.id, 'PUT', {
          ...feedSettings,
          revision: rotated.revision,
        })
      ).status,
      200,
    );
    assert.equal(
      (await h.request(publicPath, { auth: false, env: h.env })).status,
      404,
    );
  } finally {
    h.close();
  }
});
test('feed failures keep the last good snapshot; incomplete pagination never publishes and CSRF is enforced', async () => {
  const h = feedFixture();
  try {
    await testShopConnections(h, h.env);
    const f = await (await h.call('', 'POST', feedSettings)).json();
    assert.equal(
      (await h.call('/' + f.id + '/refresh', 'POST', { revision: 1 })).status,
      200,
    );
    const previous = [...h.objects.values()][0];
    h.sql.exec('UPDATE product_feeds SET last_attempt=0');
    h.state.fail = true;
    assert.equal(
      (await h.call('/' + f.id + '/refresh', 'POST', { revision: 1 })).status,
      503,
    );
    assert.equal(h.objects.size, 1);
    assert.equal(
      await (await h.call('/' + f.id + '/preview')).text(),
      previous,
    );
    // A partner fetching an outdated feed gets the last file when making it fails or is already under way.
    const publicPath = new URL(f.url).pathname;
    h.sql.exec(
      'UPDATE product_feeds SET enabled=1,generated_at=generated_at-7200,last_attempt=0',
    );
    for (const lock of [0, Math.floor(Date.now() / 1000) + 300]) {
      h.sql.exec('UPDATE product_feeds SET last_attempt=0,lock_until=' + lock);
      const served = await h.request(publicPath, { auth: false, env: h.env });
      assert.equal(served.status, 200, await served.clone().text());
      assert.equal(await served.text(), previous);
    }
    // Without any file, the reason is shown.
    h.sql.exec(
      'UPDATE product_feeds SET xml_key=NULL,lock_until=0,last_attempt=0',
    );
    const missing = await h.request(publicPath, { auth: false, env: h.env });
    assert.equal(missing.status, 503);
    h.sql.exec(
      "UPDATE product_feeds SET last_attempt=strftime('%s'),last_error='Markedspriser kunne ikke hentes.'",
    );
    assert.match(
      await (await h.request(publicPath, { auth: false, env: h.env })).text(),
      /Markedspriser kunne ikke hentes/,
    );
    h.sql.exec('UPDATE product_feeds SET enabled=0,last_error=NULL');
    h.state.fail = false;
    h.state.repeat = true;
    h.sql.exec('UPDATE product_feeds SET last_attempt=0');
    assert.equal(
      (await h.call('/' + f.id + '/refresh', 'POST', { revision: 1 })).status,
      409,
    );
    assert.equal(h.objects.size, 1);
    assert.equal(
      (
        await h.request('/api/platform/tier1/shops/shop-a1/feeds', {
          user: 'local-a',
          method: 'POST',
          body: feedSettings,
          csrfOrigin: 'https://foreign.test',
          env: h.env,
        })
      ).status,
      403,
    );
    for (const bad of [
      { service: 'other' },
      { shippingCost: 'NaN' },
      { allProducts: false, products: [], collections: [] },
    ])
      assert.equal(
        (await h.call('', 'POST', { ...feedSettings, ...bad })).status,
        400,
      );
    h.state.repeat = false;
    const catalog = await h.call('/catalog?kind=collections');
    assert.equal(catalog.status, 200);
  } finally {
    h.close();
  }
});
test('feeds paginate variants, serialize refreshes and stop public access after company deactivation', async () => {
  const h = feedFixture();
  try {
    await testShopConnections(h, h.env);
    h.state.paginate = true;
    const f = await (
      await h.call('', 'POST', { ...feedSettings, enabled: true })
    ).json();
    const results = await Promise.all([
      h.call('/' + f.id + '/refresh', 'POST', { revision: 1 }),
      h.call('/' + f.id + '/refresh', 'POST', { revision: 1 }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(h.objects.size, 1);
    const xml = await (await h.call('/' + f.id + '/preview')).text();
    assert.equal((xml.match(/<produkt>/g) || []).length, 3);
    assert.match(xml, /<variantid>4<\/variantid>/);
    h.sql.exec("UPDATE companies SET status='inactive' WHERE id='company-a'");
    assert.equal(
      (await h.request(new URL(f.url).pathname, { auth: false, env: h.env }))
        .status,
      404,
    );
  } finally {
    h.close();
  }
});

test('feed links live in a folder per webshop and a chosen file name that must be free', async () => {
  const h = feedFixture();
  try {
    await testShopConnections(h, h.env);
    // The folder follows the webshop's name in WebshopToolbox, not its Shopify domain.
    h.sql
      .prepare(
        "UPDATE webshops SET name='Sablen.dk',domain='https://other-a1.example' WHERE id IN ('shop-a1')",
      )
      .run();
    h.sql
      .prepare(
        "UPDATE webshops SET name='sablen.dk',domain='https://other-a2.example' WHERE id='shop-a2'",
      )
      .run();
    const before = await (await h.call()).json();
    assert.match(before.folderUrl, /\/feeds\/sablendk\/$/);
    assert.equal(
      h.sql.prepare('SELECT count(*) n FROM feed_folders').get().n,
      0,
      'the folder is only reserved when a feed is saved',
    );
    const f = await (
      await h.call('', 'POST', { ...feedSettings, enabled: true })
    ).json();
    assert.equal(new URL(f.url).pathname, '/feeds/sablendk/partnerads.xml');
    const check = async (name, feed) =>
      await (
        await h.call(
          '/file-name?' +
            new URLSearchParams({ name, ...(feed ? { feed } : {}) }),
        )
      ).json();
    assert.deepEqual(await check('partnerads'), {
      available: false,
      reason: 'Navnet er optaget i denne webshop.',
    });
    assert.deepEqual(await check('partnerads', f.id), { available: true });
    assert.deepEqual(await check('ny-feed'), { available: true });
    for (const bad of [
      'Stort',
      'med mellemrum',
      '-start',
      'slut-',
      'a'.repeat(61),
      'æble',
    ])
      assert.equal((await check(bad)).available, false, bad);
    const clash = await h.call('', 'POST', feedSettings);
    assert.equal(clash.status, 409);
    assert.match((await clash.json()).error, /allerede i brug/);
    for (const bad of ['Stort', '../x', 'x.xml'])
      assert.equal(
        (await h.call('', 'POST', { ...feedSettings, fileName: bad })).status,
        400,
        bad,
      );
    // Another webshop with the same domain gets its own folder; the same file name is fine there.
    const other = await (
      await h.call('', 'POST', { ...feedSettings, enabled: true }, 'shop-a2')
    ).json();
    assert.equal(
      new URL(other.url).pathname,
      '/feeds/sablendk-2/partnerads.xml',
    );
    h.sql.exec('UPDATE product_feeds SET last_attempt=0');
    assert.equal(
      (
        await h.request('/feeds/sablendk/partnerads.xml', {
          auth: false,
          env: h.env,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request('/feeds/sablendk-2/partnerads.xml', {
          auth: false,
          env: h.env,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await h.request('/feeds/sablendk/ukendt.xml', {
          auth: false,
          env: h.env,
        })
      ).status,
      404,
    );
    // Renaming moves the link; the old readable name stops working and becomes free again.
    const renamed = await h.call('/' + f.id, 'PUT', {
      ...feedSettings,
      enabled: true,
      fileName: 'ny-feed',
      revision: f.revision,
    });
    assert.equal(renamed.status, 200, await renamed.clone().text());
    assert.equal(
      new URL((await renamed.json()).url).pathname,
      '/feeds/sablendk/ny-feed.xml',
    );
    h.sql.exec('UPDATE product_feeds SET last_attempt=0');
    assert.equal(
      (
        await h.request('/feeds/sablendk/partnerads.xml', {
          auth: false,
          env: h.env,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await h.request('/feeds/sablendk/ny-feed.xml', {
          auth: false,
          env: h.env,
        })
      ).status,
      200,
    );
    assert.deepEqual(await check('partnerads'), { available: true });
    // A folder that is not reserved yet is reserved from the name as soon as the feed page lists named feeds.
    h.sql.exec('DELETE FROM feed_folders');
    assert.equal(
      new URL(
        (await (await h.call()).json()).feeds.find((x) => x.id === f.id).url,
      ).pathname,
      '/feeds/sablendk/ny-feed.xml',
    );
    const { slugify } = loader()('platform/tier1/src/lib/feed-name.ts');
    assert.equal(
      slugify('Sablen.dk – Gaver & Æbler!'),
      'sablen-dk-gaver-aebler',
    );
  } finally {
    h.close();
  }
});

test('a feed is made for one active Shopify market, with its prices, currency, language and storefront', async () => {
  const h = feedFixture();
  try {
    await testShopConnections(h, h.env);
    const markets = await (await h.call('/markets')).json();
    assert.deepEqual(
      markets.markets.map((m) => [
        m.name,
        m.countries.join(),
        m.currency,
        m.url,
        m.locale,
        m.primary,
      ]),
      [
        ['Danmark', 'DK', 'DKK', 'https://shop.test', null, true],
        ['Sverige', 'SE', 'SEK', 'https://shop.se', 'sv', false],
      ],
      'only active markets, the primary first',
    );
    assert.equal(
      (
        await h.call('', 'POST', {
          ...feedSettings,
          market: { id: 'gid://shopify/Market/3', country: 'NO' },
        })
      ).status,
      409,
      'a draft market cannot be chosen',
    );
    assert.equal(
      (
        await h.call('', 'POST', {
          ...feedSettings,
          market: { id: 'gid://shopify/Market/2', country: 'DK' },
        })
      ).status,
      409,
      'the country must belong to the market',
    );
    assert.equal(
      (
        await h.call('', 'POST', {
          ...feedSettings,
          market: { id: 'not-a-market', country: 'SE' },
        })
      ).status,
      400,
    );
    const created = await h.call('', 'POST', {
      ...feedSettings,
      fileName: 'partnerads-se',
      market: {
        id: 'gid://shopify/Market/2',
        country: 'SE',
        name: 'Forged',
        currency: 'EUR',
      },
    });
    assert.equal(created.status, 201, await created.clone().text());
    const f = await created.json();
    assert.deepEqual(
      f.market,
      {
        id: 'gid://shopify/Market/2',
        country: 'SE',
        name: 'Sverige',
        currency: 'SEK',
      },
      'name and currency come from Shopify, not the request',
    );
    assert.equal(
      (await h.call('/' + f.id + '/refresh', 'POST', { revision: f.revision }))
        .status,
      200,
    );
    const xml = await (await h.call('/' + f.id + '/preview')).text();
    assert.equal((xml.match(/<produkt>/g) || []).length, 2);
    assert.match(
      xml,
      /<produktnavn>Sabel &amp; glas på svenska<\/produktnavn>/,
    );
    assert.match(xml, /<pris>129.00<\/pris>/);
    assert.match(xml, /<gammelpris>149.00<\/gammelpris>/);
    assert.match(xml, /<pris>199.00<\/pris>/);
    assert.doesNotMatch(xml, /<pris>99.00<\/pris>/);
    assert.match(
      xml,
      /<vareurl>https:\/\/shop.se\/products\/sabel\?variant=1<\/vareurl>/,
    );
    assert.match(xml, /<lagerstatus>I lager<\/lagerstatus>/);
    // The category is the collection's name in the market's language.
    assert.match(xml, /<kategorinavn>Kollektion på svenska<\/kategorinavn>/);
    assert.doesNotMatch(xml, /<kategorinavn>Kollektion<\/kategorinavn>/);
    // A feed made before markets could be chosen keeps the primary domain and DKK.
    const old = await (await h.call('', 'POST', feedSettings)).json();
    assert.equal(old.market, null);
  } finally {
    h.close();
  }
});

test('each feed chooses how often its data is made again when it is fetched (15 minutes by default)', async () => {
  const h = feedFixture();
  try {
    await testShopConnections(h, h.env);
    assert.equal(
      (await h.call('', 'POST', { ...feedSettings, refreshMinutes: 5 })).status,
      400,
      'only the offered intervals',
    );
    const standard = await (
      await h.call('', 'POST', { ...feedSettings, enabled: true })
    ).json();
    assert.equal(standard.refreshMinutes, 15);
    const daily = await (
      await h.call('', 'POST', {
        ...feedSettings,
        fileName: 'dagligt',
        enabled: true,
        refreshMinutes: 1440,
      })
    ).json();
    assert.equal(daily.refreshMinutes, 1440);
    for (const f of [standard, daily])
      assert.equal(
        (
          await h.call('/' + f.id + '/refresh', 'POST', {
            revision: f.revision,
          })
        ).status,
        200,
      );
    // Two hours later: the standard feed is made again on fetch, the daily one is served as stored.
    h.sql.exec(
      'UPDATE product_feeds SET generated_at=generated_at-7200,last_attempt=0',
    );
    const before = h.state.calls;
    assert.equal(
      (
        await h.request(new URL(daily.url).pathname, {
          auth: false,
          env: h.env,
        })
      ).status,
      200,
    );
    assert.equal(
      h.state.calls,
      before,
      'the daily feed is not read from Shopify',
    );
    assert.equal(
      (
        await h.request(new URL(standard.url).pathname, {
          auth: false,
          env: h.env,
        })
      ).status,
      200,
    );
    assert.ok(h.state.calls > before, 'the 15-minute feed is read again');
  } finally {
    h.close();
  }
});
