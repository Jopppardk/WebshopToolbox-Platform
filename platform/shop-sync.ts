// Custom app "Webshop-synkronisering": chosen collections and products from a source webshop are created in a target
// webshop of the same company and kept in sync (texts, images, variants, prices, packaging fields and stock).
// Stock goes both ways (shop-sync-calculations.ts): what the target sold is taken from the source. Synced target
// products are left out of the target's inventory value (inventory-source.ts), so the goods are counted once.
//
// External writes: Shopify writes only happen where productionWrites is on (production); elsewhere a run shows what
// it would do. A create without a certain answer is found by its tag before anything is sent again, and a stock
// write without a certain answer is resolved from the quantity before the variant is touched again.
import { requireCompany, requireWebshop } from './auth';
import { jsonBody } from './invitations';
import { orderQuery, shopAccess, type Access } from './invoice-source';
import { productionWrites } from './production-policy';
import { logUnexpected } from './error-log';
import {
  available,
  fingerprint,
  gid,
  images,
  intervals,
  pairVariants,
  productData,
  productSetInput,
  resolvePending,
  stockStep,
  syncTag,
  type Pending,
  type SourceProduct,
  type TargetVariant,
} from './shop-sync-calculations';
import { asText } from './tier1/src/lib/format';
import { HttpError, reply, type Actor, type PlatformEnv } from './types';

export const shopSyncAppId = 'webshop-sync';
type Settings = {
  company_id: string;
  source_webshop_id: string;
  target_webshop_id: string;
  source_location_id: string;
  target_location_id: string;
  interval_minutes: number;
  enabled: number;
  selection_json: string;
  revision: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: number;
  last_result_json: string | null;
};
type Selection = {
  collections: Array<{ id: string; title: string }>;
  products: Array<{ id: string; title: string }>;
};
type ProductRow = {
  source_product_id: string;
  target_product_id: string | null;
  state: 'creating' | 'linked' | 'removed';
  title: string;
  fingerprint: string;
  files_fingerprint: string;
  synced_at: string | null;
  error: string | null;
};
type VariantRow = {
  source_variant_id: string;
  source_product_id: string;
  source_item_id: string;
  target_item_id: string;
  last_quantity: number | null;
  pending_json: string | null;
  state: 'ok' | 'uncertain';
};
type Outcome<T> =
  | { outcome: 'ok'; data: T }
  | { outcome: 'failed'; message: string }
  | { outcome: 'uncertain' };
const message =
  'Shopify kunne ikke læse produkterne til synkroniseringen. Kontrollér read_products, read_inventory og read_locations.';
const writeCap = 40,
  runMs = 120000,
  lockSeconds = 300,
  // A create without a certain answer is looked up by its tag; Shopify's search needs a moment to know a new product.
  creatingWaitMs = 5 * 60000;

// Shopify writes (orderQuery refuses mutations by design). Shopify refusing (an HTTP 4xx, GraphQL errors or user
// errors) means nothing was changed; a lost connection, a timeout or a 5xx is uncertain.
async function mutate<T>(
  access: Access,
  query: string,
  variables: Record<string, unknown>,
  field: string,
): Promise<Outcome<T>> {
  let response: Response;
  try {
    response = await fetch(
      `https://${access.shop}/admin/api/2026-07/graphql.json`,
      {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(25000),
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': access.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      },
    );
  } catch {
    return { outcome: 'uncertain' };
  }
  if (response.status >= 500) return { outcome: 'uncertain' };
  const result = (await response.json().catch(() => null)) as {
    data?: Record<string, { userErrors?: Array<{ message?: string }> } | null>;
    errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  } | null;
  if (!result)
    return {
      outcome: response.ok ? 'uncertain' : 'failed',
      message: 'Shopify svarede ikke.',
    } as Outcome<T>;
  if (!response.ok || result.errors?.length) {
    const code = result.errors?.[0]?.extensions?.code;
    return {
      outcome: 'failed',
      message:
        response.status === 403 || code === 'ACCESS_DENIED'
          ? 'Shopify-appen mangler adgang (write_products og write_inventory).'
          : `Shopify afviste ændringen${code ? ` (${asText(code).slice(0, 40)})` : ''}.`,
    };
  }
  const payload = result.data?.[field];
  if (!payload) return { outcome: 'uncertain' };
  if (Array.isArray(payload.userErrors) && payload.userErrors.length)
    return {
      outcome: 'failed',
      message: `Shopify: ${asText(payload.userErrors[0].message || '').slice(0, 200)}`,
    };
  return { outcome: 'ok', data: payload as T };
}

const productFields = `id handle title descriptionHtml vendor productType tags status category { id } seo { title description }
  options { name position optionValues { name } }
  media(first: 50) { nodes { ... on MediaImage { image { url altText } } } }
  variants(first: 100) { nodes { id sku barcode price compareAtPrice inventoryPolicy taxable selectedOptions { name value }
    inventoryItem { id tracked requiresShipping unitCost { amount } measurement { weight { unit value } }
      inventoryLevel(locationId: $location) { quantities(names: ["available"]) { name quantity } } } } pageInfo { hasNextPage } }
  weight: metafield(namespace: "custom", key: "emballage_vaegt_gram") { value }
  reportable: metafield(namespace: "custom", key: "emballage_indberetning") { value }`;
const targetVariantFields = `variants(first: 100) { nodes { id selectedOptions { name value }
  inventoryItem { id inventoryLevel(locationId: $location) { quantities(names: ["available"]) { name quantity } } } } }`;

async function sourceProducts(access: Access, ids: string[], location: string) {
  const out = new Map<string, SourceProduct>();
  for (let i = 0; i < ids.length; i += 25) {
    const d = await orderQuery<{ nodes: Array<SourceProduct | null> }>(
      access,
      `query SyncProducts($ids: [ID!]!, $location: ID!) { nodes(ids: $ids) { ... on Product { ${productFields} } } }`,
      { ids: ids.slice(i, i + 25), location },
      message,
    );
    for (const node of d.nodes)
      if (node?.id) {
        if (node.variants.pageInfo.hasNextPage)
          throw new HttpError(
            409,
            `"${node.title}" har over 100 varianter og kan ikke synkroniseres.`,
          );
        out.set(node.id, node);
      }
  }
  return out;
}
async function targetProducts(access: Access, ids: string[], location: string) {
  const out = new Map<string, TargetVariant[]>();
  for (let i = 0; i < ids.length; i += 25) {
    const d = await orderQuery<{
      nodes: Array<{ id: string; variants: { nodes: TargetVariant[] } } | null>;
    }>(
      access,
      `query SyncTargets($ids: [ID!]!, $location: ID!) { nodes(ids: $ids) { ... on Product { id ${targetVariantFields} } } }`,
      { ids: ids.slice(i, i + 25), location },
      message,
    );
    for (const node of d.nodes)
      if (node?.id) out.set(node.id, node.variants.nodes);
  }
  return out;
}
type SourceCollection = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  image: { url: string; altText: string | null } | null;
  productIds: string[];
};
async function sourceCollection(
  access: Access,
  id: string,
): Promise<SourceCollection | null> {
  const productIds: string[] = [];
  let after: string | null = null,
    head: Omit<SourceCollection, 'productIds'> | null = null;
  for (let page = 0; page < 8; page++) {
    const d: {
      collection:
        | null
        | (Omit<SourceCollection, 'productIds'> & {
            products: {
              nodes: Array<{ id: string }>;
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
            };
          });
    } = await orderQuery(
      access,
      'query SyncCollection($id: ID!, $after: String) { collection(id: $id) { id handle title descriptionHtml image { url altText } products(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } } }',
      { id, after },
      message,
    );
    if (!d.collection) return null;
    const { products, ...rest } = d.collection;
    head = rest;
    productIds.push(...products.nodes.map((n) => n.id));
    if (!products.pageInfo.hasNextPage) return { ...head, productIds };
    after = products.pageInfo.endCursor;
  }
  throw new HttpError(
    409,
    'En kollektion har over 2.000 produkter og kan ikke synkroniseres samlet.',
  );
}
async function collectionProductIds(access: Access, id: string) {
  const ids = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 8; page++) {
    const d: {
      collection: null | {
        products: {
          nodes: Array<{ id: string }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    } = await orderQuery(
      access,
      'query SyncTargetCollection($id: ID!, $after: String) { collection(id: $id) { products(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } } }',
      { id, after },
      message,
    );
    if (!d.collection) return null;
    for (const n of d.collection.products.nodes) ids.add(n.id);
    if (!d.collection.products.pageInfo.hasNextPage) return ids;
    after = d.collection.products.pageInfo.endCursor;
  }
  return ids;
}
async function shopCurrency(access: Access) {
  const d = await orderQuery<{ shop: { currencyCode: string } }>(
    access,
    'query SyncShop { shop { currencyCode } }',
    {},
    message,
  );
  return d.shop.currencyCode;
}

export async function loadSettings(env: PlatformEnv, company: string) {
  return env.PLATFORM_DB.prepare(
    'SELECT * FROM shop_sync_settings WHERE company_id=?',
  )
    .bind(company)
    .first<Settings>();
}
const selectionOf = (s: Settings): Selection => JSON.parse(s.selection_json);
async function webshopNames(env: PlatformEnv, company: string) {
  const rows = await env.PLATFORM_DB.prepare(
    'SELECT id,name FROM webshops WHERE company_id=?',
  )
    .bind(company)
    .all<{ id: string; name: string }>();
  return new Map(rows.results.map((r) => [r.id, r.name]));
}

// Target products that are copies from another webshop: left out of the inventory value (inventory-source.ts).
export async function syncedTargetProducts(
  env: PlatformEnv,
  company: string,
  shop: string,
) {
  const rows = await env.PLATFORM_DB.prepare(
    `SELECT p.target_product_id,w.name FROM shop_sync_products p JOIN webshops w ON w.company_id=p.company_id AND w.id=p.source_webshop_id
     WHERE p.company_id=? AND p.target_webshop_id=? AND p.target_product_id IS NOT NULL`,
  )
    .bind(company, shop)
    .all<{ target_product_id: string; name: string }>();
  return new Map(rows.results.map((r) => [r.target_product_id, r.name]));
}

export type SyncResult = {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  created: number;
  updated: number;
  removed: number;
  stock: number;
  collections: number;
  waiting: number;
  errors: string[];
  actions: string[];
  prices: boolean;
};

// One run for a company. dryRun reads everything and writes nothing (neither to Shopify nor to the database).
export async function syncCompany(
  env: PlatformEnv,
  company: string,
  dryRun: boolean,
): Promise<SyncResult> {
  const db = env.PLATFORM_DB,
    settings = await loadSettings(env, company);
  if (!settings) throw new HttpError(409, 'Gem opsætningen først.');
  const deadline = Date.now() + runMs,
    names = await webshopNames(env, company),
    sourceName = names.get(settings.source_webshop_id) || 'kildewebshoppen',
    result: SyncResult = {
      dryRun,
      startedAt: new Date().toISOString(),
      finishedAt: '',
      created: 0,
      updated: 0,
      removed: 0,
      stock: 0,
      collections: 0,
      waiting: 0,
      errors: [],
      actions: [],
      prices: false,
    };
  const note = (text: string) => {
    if (result.actions.length < 200) result.actions.push(text);
  };
  const fail = (text: string) => {
    if (result.errors.length < 50) result.errors.push(text);
  };
  const [source, target] = await Promise.all([
    shopAccess(env, company, settings.source_webshop_id),
    shopAccess(env, company, settings.target_webshop_id),
  ]);
  const [sourceCurrency, targetCurrency] = await Promise.all([
    shopCurrency(source),
    shopCurrency(target),
  ]);
  // Prices are only copied between webshops with the same currency.
  const prices = sourceCurrency === targetCurrency;
  result.prices = prices;
  const selection = selectionOf(settings);
  const collections = new Map<string, SourceCollection>();
  for (const c of selection.collections) {
    const found = await sourceCollection(source, c.id);
    if (found) collections.set(c.id, found);
    else fail(`Kollektionen "${c.title}" findes ikke længere i ${sourceName}.`);
  }
  const wanted = new Set<string>(selection.products.map((p) => p.id));
  for (const c of collections.values())
    for (const id of c.productIds) wanted.add(id);
  if (wanted.size > 1000)
    throw new HttpError(
      409,
      'Højst 1.000 produkter kan synkroniseres. Vælg færre kollektioner.',
    );
  const products = await sourceProducts(
    source,
    [...wanted],
    settings.source_location_id,
  );
  const rows = new Map(
    (
      await db
        .prepare('SELECT * FROM shop_sync_products WHERE company_id=?')
        .bind(company)
        .all<ProductRow>()
    ).results.map((r) => [r.source_product_id, r]),
  );
  const variants = new Map(
    (
      await db
        .prepare('SELECT * FROM shop_sync_variants WHERE company_id=?')
        .bind(company)
        .all<VariantRow>()
    ).results.map((r) => [r.source_variant_id, r]),
  );
  // Removed links are read too: a product chosen again is linked to the product it already has in the target.
  const linked = [...rows.values()].filter(
    (r) => r.state !== 'creating' && r.target_product_id,
  );
  const targets = await targetProducts(
    target,
    linked.map((r) => r.target_product_id!),
    settings.target_location_id,
  );
  let writes = 0;
  const now = () => new Date().toISOString();
  const saveProduct = (row: ProductRow) =>
    dryRun
      ? Promise.resolve()
      : db
          .prepare(
            `INSERT INTO shop_sync_products(company_id,source_webshop_id,source_product_id,target_webshop_id,target_product_id,state,title,fingerprint,files_fingerprint,synced_at,error)
             VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id,source_product_id) DO UPDATE SET target_product_id=excluded.target_product_id,state=excluded.state,
             title=excluded.title,fingerprint=excluded.fingerprint,files_fingerprint=excluded.files_fingerprint,synced_at=excluded.synced_at,error=excluded.error`,
          )
          .bind(
            company,
            settings.source_webshop_id,
            row.source_product_id,
            settings.target_webshop_id,
            row.target_product_id,
            row.state,
            row.title,
            row.fingerprint,
            row.files_fingerprint,
            row.synced_at,
            row.error,
          )
          .run();

  // ---- Products ----
  for (const [id, product] of products) {
    if (Date.now() > deadline || writes >= writeCap) {
      result.waiting++;
      continue;
    }
    let row: ProductRow = rows.get(id) ?? {
      source_product_id: id,
      target_product_id: null,
      state: 'creating',
      title: product.title,
      fingerprint: '',
      files_fingerprint: '',
      synced_at: null,
      error: null,
    };
    row.title = product.title;
    const isNew = !rows.has(id);
    const fp = await fingerprint(productData(product, { prices, sourceName })),
      filesFp = await fingerprint(images(product));
    if (!isNew && row.state === 'creating') {
      if (
        row.synced_at &&
        Date.now() - Date.parse(row.synced_at) < creatingWaitMs
      ) {
        result.waiting++;
        continue;
      }
      const found = await orderQuery<{
        products: { nodes: Array<{ id: string }> };
      }>(
        target,
        'query SyncFind($q: String!) { products(first: 2, query: $q) { nodes { id } } }',
        { q: `tag:'${syncTag(id)}'` },
        message,
      );
      if (found.products.nodes.length > 1) {
        row.error = `"${product.title}" findes flere gange i modtagerwebshoppen. Slet de ekstra, og prøv igen.`;
        fail(row.error);
        await saveProduct(row);
        continue;
      }
      if (found.products.nodes[0]) {
        // The earlier create did happen: link it and send the full product as an update.
        row = {
          ...row,
          state: 'linked',
          target_product_id: found.products.nodes[0].id,
          fingerprint: '',
          files_fingerprint: '',
        };
        targets.set(
          row.target_product_id!,
          (
            await targetProducts(
              target,
              [row.target_product_id!],
              settings.target_location_id,
            )
          ).get(row.target_product_id!) ?? [],
        );
      }
    }
    // Chosen again: sent in full, so the status and texts are the source's again.
    if (row.state === 'removed')
      row = { ...row, state: 'linked', fingerprint: '' };
    if (row.state !== 'linked' || !row.target_product_id) {
      writes++;
      if (dryRun) {
        note(
          `Opretter "${product.title}" i ${names.get(settings.target_webshop_id)}.`,
        );
        result.created++;
        continue;
      }
      row = { ...row, state: 'creating', synced_at: now(), error: null };
      await saveProduct(row);
      const created = await mutate<{
        product: { id: string; variants: { nodes: TargetVariant[] } };
      }>(
        target,
        `mutation SyncCreate($input: ProductSetInput!, $location: ID!) { productSet(input: $input, synchronous: true) { product { id ${targetVariantFields} } userErrors { field message } } }`,
        {
          input: productSetInput(product, {
            prices,
            sourceName,
            create: true,
            files: true,
            targetLocationId: settings.target_location_id,
            targetVariants: [],
          }),
          location: settings.target_location_id,
        },
        'productSet',
      );
      if (created.outcome === 'uncertain') {
        fail(
          `"${product.title}": Shopify svarede ikke sikkert. Kontrolleres ved næste kørsel.`,
        );
        continue;
      }
      if (created.outcome === 'failed') {
        row.error = created.message;
        fail(`"${product.title}": ${created.message}`);
        await saveProduct(row);
        continue;
      }
      row = {
        ...row,
        state: 'linked',
        target_product_id: created.data.product.id,
        fingerprint: fp,
        files_fingerprint: filesFp,
        synced_at: now(),
        error: null,
      };
      await saveProduct(row);
      result.created++;
      // The new product got the source's quantity, so that is what the target has "after the last sync".
      await linkVariants(product, created.data.product.variants.nodes, true);
      continue;
    }
    let targetVariants = targets.get(row.target_product_id);
    if (!targetVariants) {
      row.error = `"${product.title}" findes ikke længere i modtagerwebshoppen. Fjern den fra valget, eller slet koblingen.`;
      fail(row.error);
      await saveProduct(row);
      continue;
    }
    if (row.fingerprint !== fp || row.files_fingerprint !== filesFp) {
      writes++;
      if (dryRun) {
        note(`Opdaterer "${product.title}".`);
        result.updated++;
      } else {
        const updated = await mutate<{
          product: { id: string; variants: { nodes: TargetVariant[] } };
        }>(
          target,
          `mutation SyncUpdate($input: ProductSetInput!, $identifier: ProductSetIdentifiers, $location: ID!) { productSet(input: $input, identifier: $identifier, synchronous: true) { product { id ${targetVariantFields} } userErrors { field message } } }`,
          {
            identifier: { id: row.target_product_id },
            input: productSetInput(product, {
              prices,
              sourceName,
              create: false,
              files: row.files_fingerprint !== filesFp,
              targetLocationId: settings.target_location_id,
              targetVariants,
            }),
            location: settings.target_location_id,
          },
          'productSet',
        );
        if (updated.outcome !== 'ok') {
          // An update sends the whole product again, so it is simply retried at the next run.
          row.error =
            updated.outcome === 'failed'
              ? updated.message
              : 'Shopify svarede ikke sikkert; prøves igen.';
          fail(`"${product.title}": ${row.error}`);
          await saveProduct(row);
          continue;
        }
        targetVariants = updated.data.product.variants.nodes;
        row = {
          ...row,
          fingerprint: fp,
          files_fingerprint: filesFp,
          synced_at: now(),
          error: null,
        };
        await saveProduct(row);
        result.updated++;
      }
    } else if (row.error && !dryRun) {
      row.error = null;
      await saveProduct(row);
    }
    await linkVariants(product, targetVariants, false);
    await syncStock(product, targetVariants);
  }

  async function linkVariants(
    product: SourceProduct,
    targetVariants: TargetVariant[],
    created: boolean,
  ) {
    if (dryRun) return;
    const statements = pairVariants(product.variants.nodes, targetVariants)
      .filter(
        (p) =>
          !variants.has(p.source.id) ||
          variants.get(p.source.id)!.target_item_id !==
            p.target.inventoryItem.id,
      )
      .map((p) => {
        const last =
          created && p.source.inventoryItem.tracked
            ? available(p.source.inventoryItem.inventoryLevel)
            : null;
        variants.set(p.source.id, {
          source_variant_id: p.source.id,
          source_product_id: product.id,
          source_item_id: p.source.inventoryItem.id,
          target_item_id: p.target.inventoryItem.id,
          last_quantity: last,
          pending_json: null,
          state: 'ok',
        });
        return db
          .prepare(
            `INSERT INTO shop_sync_variants(company_id,source_variant_id,source_product_id,source_item_id,target_item_id,last_quantity,pending_json,state)
             VALUES(?,?,?,?,?,?,NULL,'ok') ON CONFLICT(company_id,source_variant_id) DO UPDATE SET source_item_id=excluded.source_item_id,
             target_item_id=excluded.target_item_id,last_quantity=excluded.last_quantity,pending_json=NULL,state='ok',error=NULL`,
          )
          .bind(
            company,
            p.source.id,
            product.id,
            p.source.inventoryItem.id,
            p.target.inventoryItem.id,
            last,
          );
      });
    if (statements.length) await db.batch(statements);
  }

  async function syncStock(
    product: SourceProduct,
    targetVariants: TargetVariant[],
  ) {
    const saveVariant = (v: VariantRow, error: string | null = null) =>
      db
        .prepare(
          'UPDATE shop_sync_variants SET last_quantity=?,pending_json=?,state=?,error=? WHERE company_id=? AND source_variant_id=?',
        )
        .bind(
          v.last_quantity,
          v.pending_json,
          v.state,
          error,
          company,
          v.source_variant_id,
        )
        .run();
    type Line = { row: VariantRow; s: number; t: number; title: string };
    const lines: Line[] = [];
    for (const pair of pairVariants(product.variants.nodes, targetVariants)) {
      if (!pair.source.inventoryItem.tracked) continue;
      const row = variants.get(pair.source.id),
        s = available(pair.source.inventoryItem.inventoryLevel),
        t = available(pair.target.inventoryItem.inventoryLevel);
      const title =
        product.title +
        (pair.source.selectedOptions.length &&
        pair.source.selectedOptions[0].value !== 'Default Title'
          ? ' · ' + pair.source.selectedOptions.map((o) => o.value).join(' / ')
          : '');
      if (!row) {
        if (dryRun && s !== null && t !== null && s !== t)
          note(`Lager "${title}": modtageren får ${s} (har ${t}).`);
        continue;
      }
      if (row.state === 'uncertain') continue;
      if (s === null || t === null) {
        fail(
          `Lager "${title}": varen er ikke på den valgte lokation i ${s === null ? 'kildewebshoppen' : 'modtagerwebshoppen'}.`,
        );
        continue;
      }
      if (row.pending_json) {
        const pending = JSON.parse(row.pending_json) as Pending;
        const state = resolvePending(
          pending,
          pending.side === 'source' ? s : t,
        );
        if (state === 'unknown') {
          if (!dryRun) {
            row.state = 'uncertain';
            await saveVariant(
              row,
              'En lagerændring blev sendt uden sikkert svar, og antallet har ændret sig siden. Kontrollér lageret, og nulstil varen.',
            );
          }
          fail(
            `Lager "${title}": kræver kontrol (ukendt udfald af en tidligere ændring).`,
          );
          continue;
        }
        if (state === 'applied') row.last_quantity = pending.last;
        row.pending_json = null;
        if (!dryRun) await saveVariant(row);
        // The pending write moved the quantity it was about; this run continues from the next read.
        if (state === 'applied') continue;
      }
      lines.push({ row, s, t, title });
    }
    const steps = lines.map((l) => ({
      ...l,
      step: stockStep(l.row.last_quantity, l.s, l.t),
    }));
    const toSource = steps.filter((x) => x.step.sourceTo !== null);
    if (dryRun) {
      for (const x of steps) {
        if (x.step.sourceTo !== null)
          note(
            `Lager "${x.title}": ${x.step.sold > 0 ? `${x.step.sold} solgt` : `${-x.step.sold} retur`} i modtageren; kilden går fra ${x.s} til ${x.step.next}.`,
          );
        if (x.step.targetTo !== null)
          note(
            `Lager "${x.title}": modtageren går fra ${x.t} til ${x.step.next}.`,
          );
      }
      result.stock += steps.filter(
        (x) => x.step.sourceTo !== null || x.step.targetTo !== null,
      ).length;
      return;
    }
    const write = async (side: 'source' | 'target', items: typeof steps) => {
      if (!items.length) return 'ok' as const;
      const key = crypto.randomUUID(),
        access = side === 'source' ? source : target,
        location =
          side === 'source'
            ? settings!.source_location_id
            : settings!.target_location_id;
      for (const x of items) {
        const from = side === 'source' ? x.s : x.t;
        x.row.pending_json = JSON.stringify({
          side,
          from,
          to: x.step.next,
          last: side === 'source' ? x.t : x.step.next,
          key,
        } satisfies Pending);
      }
      // The intent is saved before Shopify is asked, so a lost answer is resolved from the quantities next time.
      await db.batch(
        items.map((x) =>
          db
            .prepare(
              'UPDATE shop_sync_variants SET pending_json=? WHERE company_id=? AND source_variant_id=?',
            )
            .bind(x.row.pending_json, company, x.row.source_variant_id),
        ),
      );
      const done = await mutate(
        access,
        'mutation SyncStock($input: InventorySetQuantitiesInput!, $key: String!) { inventorySetQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { createdAt } userErrors { code message } } }',
        {
          key,
          input: {
            name: 'available',
            reason: 'correction',
            referenceDocumentUri: `logistics://webshoptoolbox.dk/${company}/webshop-sync/${key}`,
            quantities: items.map((x) => ({
              inventoryItemId:
                side === 'source' ? x.row.source_item_id : x.row.target_item_id,
              locationId: location,
              quantity: x.step.next,
              changeFromQuantity: side === 'source' ? x.s : x.t,
            })),
          },
        },
        'inventorySetQuantities',
      );
      if (done.outcome === 'uncertain') {
        fail(
          `Lager for "${product.title}": Shopify svarede ikke sikkert. Kontrolleres ved næste kørsel.`,
        );
        return 'uncertain' as const;
      }
      for (const x of items) {
        if (done.outcome === 'ok')
          x.row.last_quantity = (
            JSON.parse(x.row.pending_json!) as Pending
          ).last;
        x.row.pending_json = null;
      }
      await db.batch(
        items.map((x) =>
          db
            .prepare(
              'UPDATE shop_sync_variants SET last_quantity=?,pending_json=NULL WHERE company_id=? AND source_variant_id=?',
            )
            .bind(x.row.last_quantity, company, x.row.source_variant_id),
        ),
      );
      if (done.outcome === 'failed') {
        // Usually a quantity that moved while the run read it; the next run starts again from the new numbers.
        fail(
          `Lager for "${product.title}" (${side === 'source' ? 'kilden' : 'modtageren'}): ${done.message}`,
        );
        return 'failed' as const;
      }
      result.stock += items.length;
      return 'ok' as const;
    };
    if ((await write('source', toSource)) !== 'ok') return;
    // After the source took the target's sales, the target gets the source's (new) quantity.
    await write(
      'target',
      steps.filter((x) => x.t !== x.step.next),
    );
    const quiet = steps.filter(
      (x) =>
        x.step.sourceTo === null &&
        x.t === x.step.next &&
        x.row.last_quantity !== x.t,
    );
    if (quiet.length)
      await db.batch(
        quiet.map((x) =>
          db
            .prepare(
              'UPDATE shop_sync_variants SET last_quantity=? WHERE company_id=? AND source_variant_id=?',
            )
            .bind(x.t, company, x.row.source_variant_id),
        ),
      );
  }

  // ---- No longer chosen, or gone in the source: set to draft in the target and stop syncing. ----
  for (const row of rows.values()) {
    if (
      row.state !== 'linked' ||
      !row.target_product_id ||
      products.has(row.source_product_id)
    )
      continue;
    if (Date.now() > deadline || writes >= writeCap) break;
    writes++;
    if (dryRun) {
      note(
        `Sætter "${row.title}" til kladde i modtageren (ikke længere valgt).`,
      );
      result.removed++;
      continue;
    }
    const done = await mutate(
      target,
      'mutation SyncDraft($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id } userErrors { field message } } }',
      { product: { id: row.target_product_id, status: 'DRAFT' } },
      'productUpdate',
    );
    if (done.outcome !== 'ok') {
      fail(
        `"${row.title}" kunne ikke sættes til kladde: ${done.outcome === 'failed' ? done.message : 'Shopify svarede ikke sikkert.'}`,
      );
      continue;
    }
    await db.batch([
      db
        .prepare(
          "UPDATE shop_sync_products SET state='removed',synced_at=?,error=NULL WHERE company_id=? AND source_product_id=?",
        )
        .bind(now(), company, row.source_product_id),
      db
        .prepare(
          'DELETE FROM shop_sync_variants WHERE company_id=? AND source_product_id=?',
        )
        .bind(company, row.source_product_id),
    ]);
    result.removed++;
  }

  // ---- Collections: created (or an existing one with the same handle reused) and given the synced products. ----
  const collectionRows = new Map(
    (
      await db
        .prepare('SELECT * FROM shop_sync_collections WHERE company_id=?')
        .bind(company)
        .all<{
          source_collection_id: string;
          target_collection_id: string | null;
          fingerprint: string;
        }>()
    ).results.map((r) => [r.source_collection_id, r]),
  );
  const productTargets = new Map(
    (
      await db
        .prepare(
          "SELECT source_product_id,target_product_id FROM shop_sync_products WHERE company_id=? AND state='linked' AND target_product_id IS NOT NULL",
        )
        .bind(company)
        .all<{ source_product_id: string; target_product_id: string }>()
    ).results.map((r) => [r.source_product_id, r.target_product_id]),
  );
  for (const c of collections.values()) {
    if (Date.now() > deadline) break;
    const input = {
      title: c.title,
      descriptionHtml: c.descriptionHtml,
      ...(c.image
        ? { image: { src: c.image.url, altText: c.image.altText || '' } }
        : {}),
    };
    const fp = await fingerprint(input);
    let targetId = collectionRows.get(c.id)?.target_collection_id ?? null;
    const saveCollection = (
      id: string | null,
      error: string | null,
      fpValue: string,
    ) =>
      dryRun
        ? Promise.resolve()
        : db
            .prepare(
              `INSERT INTO shop_sync_collections(company_id,source_collection_id,target_collection_id,title,fingerprint,synced_at,error) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(company_id,source_collection_id) DO UPDATE SET target_collection_id=excluded.target_collection_id,title=excluded.title,fingerprint=excluded.fingerprint,synced_at=excluded.synced_at,error=excluded.error`,
            )
            .bind(company, c.id, id, c.title, fpValue, now(), error)
            .run();
    if (!targetId) {
      // Also resolves a create that got no certain answer: it has the source's handle.
      const existing = await orderQuery<{
        collectionByIdentifier: { id: string } | null;
      }>(
        target,
        'query SyncCollectionHandle($handle: String!) { collectionByIdentifier(identifier: { handle: $handle }) { id } }',
        { handle: c.handle },
        message,
      );
      if (existing.collectionByIdentifier) {
        targetId = existing.collectionByIdentifier.id;
        await saveCollection(targetId, null, '');
      } else if (dryRun) {
        note(`Opretter kollektionen "${c.title}".`);
        result.collections++;
        continue;
      } else {
        const created = await mutate<{ collection: { id: string } }>(
          target,
          'mutation SyncCollectionCreate($input: CollectionInput!) { collectionCreate(input: $input) { collection { id } userErrors { field message } } }',
          { input: { ...input, handle: c.handle } },
          'collectionCreate',
        );
        if (created.outcome !== 'ok') {
          fail(
            `Kollektionen "${c.title}": ${created.outcome === 'failed' ? created.message : 'Shopify svarede ikke sikkert. Kontrolleres ved næste kørsel.'}`,
          );
          if (created.outcome === 'failed')
            await saveCollection(null, created.message, '');
          continue;
        }
        targetId = created.data.collection.id;
        await saveCollection(targetId, null, fp);
        result.collections++;
      }
    }
    if (
      collectionRows.get(c.id)?.fingerprint !== fp &&
      collectionRows.has(c.id) &&
      collectionRows.get(c.id)!.target_collection_id
    ) {
      if (dryRun) note(`Opdaterer kollektionen "${c.title}".`);
      else {
        const updated = await mutate(
          target,
          'mutation SyncCollectionUpdate($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id } userErrors { field message } } }',
          { input: { id: targetId, ...input } },
          'collectionUpdate',
        );
        if (updated.outcome === 'ok') {
          await saveCollection(targetId, null, fp);
          result.collections++;
        } else
          fail(
            `Kollektionen "${c.title}": ${updated.outcome === 'failed' ? updated.message : 'Shopify svarede ikke sikkert; prøves igen.'}`,
          );
      }
    }
    const members = await collectionProductIds(target, targetId);
    if (!members) {
      fail(
        `Kollektionen "${c.title}" findes ikke længere i modtagerwebshoppen.`,
      );
      if (!dryRun)
        await db
          .prepare(
            'UPDATE shop_sync_collections SET target_collection_id=NULL WHERE company_id=? AND source_collection_id=?',
          )
          .bind(company, c.id)
          .run();
      continue;
    }
    const missing = c.productIds
      .map((id) => productTargets.get(id))
      .filter((id): id is string => !!id && !members.has(id));
    if (!missing.length) continue;
    if (dryRun) {
      note(
        `Tilføjer ${missing.length} produkter til kollektionen "${c.title}".`,
      );
      continue;
    }
    for (let i = 0; i < missing.length; i += 250) {
      const added = await mutate(
        target,
        'mutation SyncCollectionAdd($id: ID!, $productIds: [ID!]!) { collectionAddProducts(id: $id, productIds: $productIds) { collection { id } userErrors { field message } } }',
        { id: targetId, productIds: missing.slice(i, i + 250) },
        'collectionAddProducts',
      );
      if (added.outcome === 'failed')
        fail(`Kollektionen "${c.title}": ${added.message}`);
    }
  }
  result.finishedAt = now();
  return result;
}

// ---- Runs: "Synkronisér nu" and the automatic run (worker.ts → runCustomApps). ----
async function run(env: PlatformEnv, company: string, dryRun: boolean) {
  const db = env.PLATFORM_DB,
    at = Math.floor(Date.now() / 1000);
  if (dryRun) return syncCompany(env, company, true);
  const locked = await db
    .prepare(
      'UPDATE shop_sync_settings SET lock_until=? WHERE company_id=? AND lock_until<=?',
    )
    .bind(at + lockSeconds, company, at)
    .run();
  if (!locked.meta.changes)
    throw new HttpError(
      409,
      'Synkroniseringen kører allerede. Prøv igen om lidt.',
    );
  let result: SyncResult;
  try {
    result = await syncCompany(env, company, false);
  } catch (error) {
    const text =
      error instanceof HttpError
        ? error.message
        : `Synkroniseringen fejlede. Fejl-ID: ${logUnexpected({ company, app: shopSyncAppId }, error)}`;
    result = {
      dryRun: false,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      created: 0,
      updated: 0,
      removed: 0,
      stock: 0,
      collections: 0,
      waiting: 0,
      errors: [text],
      actions: [],
      prices: false,
    };
  }
  const settings = await loadSettings(env, company);
  await db
    .prepare(
      'UPDATE shop_sync_settings SET lock_until=0,last_run_at=?,next_run_at=?,last_result_json=? WHERE company_id=?',
    )
    .bind(
      result.finishedAt,
      Math.floor(Date.now() / 1000) + (settings?.interval_minutes ?? 60) * 60,
      JSON.stringify(result),
      company,
    )
    .run();
  return result;
}
export async function runDueShopSyncs(env: PlatformEnv) {
  if (!productionWrites(env)) return 0;
  const at = Math.floor(Date.now() / 1000);
  const due = (
    await env.PLATFORM_DB.prepare(
      `SELECT s.company_id FROM shop_sync_settings s JOIN custom_apps a ON a.company_id=s.company_id AND a.app_id=?
       JOIN companies c ON c.id=s.company_id WHERE s.enabled=1 AND c.status='active' AND s.next_run_at<=? AND s.lock_until<=? LIMIT 5`,
    )
      .bind(shopSyncAppId, at, at)
      .all<{ company_id: string }>()
  ).results;
  for (const { company_id } of due)
    await run(env, company_id, false).catch((error) =>
      console.error('Webshop-synkronisering fejlede', company_id, error),
    );
  return due.length;
}

// ---- Tier 1: /custom-apps/webshop-sync/... ----
export async function handleShopSync({
  request,
  env,
  actor,
  company,
  path,
}: {
  request: Request;
  env: PlatformEnv;
  actor: Actor;
  company: string;
  path: string;
}) {
  const db = env.PLATFORM_DB,
    url = new URL(request.url),
    get = request.method === 'GET';
  const manager = async () => {
    await requireCompany(db, actor, company, true);
  };
  const webshops = async () =>
    (
      await db
        .prepare(
          "SELECT id,name FROM webshops w WHERE company_id=? AND status='active' AND EXISTS(SELECT 1 FROM webshop_connections k WHERE k.company_id=w.company_id AND k.webshop_id=w.id AND k.provider='shopify') ORDER BY name,id",
        )
        .bind(company)
        .all<{ id: string; name: string }>()
    ).results;
  const shopParam = async () => {
    const shop = url.searchParams.get('shop') || '';
    if (!/^[\w-]{1,80}$/.test(shop))
      throw new HttpError(400, 'Vælg en webshop.');
    await requireWebshop(db, actor, company, shop);
    return shop;
  };
  if (path === '/settings' && get) {
    const settings = await loadSettings(env, company);
    const membership = actor.platformAdmin
      ? null
      : await db
          .prepare(
            'SELECT role FROM company_memberships WHERE company_id=? AND user_id=?',
          )
          .bind(company, actor.id)
          .first<{ role: string }>();
    return reply({
      settings: settings
        ? {
            sourceWebshopId: settings.source_webshop_id,
            targetWebshopId: settings.target_webshop_id,
            sourceLocationId: settings.source_location_id,
            targetLocationId: settings.target_location_id,
            intervalMinutes: settings.interval_minutes,
            enabled: !!settings.enabled,
            selection: selectionOf(settings),
            revision: settings.revision,
            lastRunAt: settings.last_run_at,
            nextRunAt: settings.next_run_at
              ? new Date(settings.next_run_at * 1000).toISOString()
              : null,
            lastResult: settings.last_result_json
              ? JSON.parse(settings.last_result_json)
              : null,
          }
        : null,
      webshops: await webshops(),
      canManage: !actor.support && membership?.role === 'admin',
      writes: productionWrites(env),
      intervals,
    });
  }
  if (path === '/locations' && get) {
    const shop = await shopParam(),
      access = await shopAccess(env, company, shop);
    const scopes = (
      await orderQuery<{
        currentAppInstallation: { accessScopes: Array<{ handle: string }> };
      }>(
        access,
        'query SyncScopes { currentAppInstallation { accessScopes { handle } } }',
        {},
        message,
      )
    ).currentAppInstallation.accessScopes.map((s) => s.handle);
    const has = (scope: string) =>
      scopes.includes(scope) ||
      scopes.includes(scope.replace('read_', 'write_'));
    if (!has('read_locations'))
      return reply({
        locations: [],
        scopes,
        error:
          'Appen i denne webshop mangler read_locations, så lokationerne kan ikke vises.',
      });
    const d = await orderQuery<{
      locations: {
        nodes: Array<{ id: string; name: string; isActive: boolean }>;
      };
    }>(
      access,
      'query SyncLocations { locations(first: 50) { nodes { id name isActive } } }',
      {},
      message,
    );
    return reply({
      locations: d.locations.nodes
        .filter((l) => l.isActive)
        .map(({ id, name }) => ({ id, name })),
      scopes,
    });
  }
  if (path === '/catalog' && get) {
    const shop = await shopParam(),
      access = await shopAccess(env, company, shop),
      q = asText(url.searchParams.get('q') || '')
        .trim()
        .slice(0, 80);
    const d = await orderQuery<{
      collections: {
        nodes: Array<{
          id: string;
          title: string;
          productsCount: { count: number } | null;
        }>;
      };
      products: { nodes: Array<{ id: string; title: string; status: string }> };
    }>(
      access,
      'query SyncCatalog($q: String) { collections(first: 250, sortKey: TITLE) { nodes { id title productsCount { count } } } products(first: 50, query: $q, sortKey: TITLE) { nodes { id title status } } }',
      { q: q ? `title:*${q.replace(/["'\\:*()]/g, ' ')}*` : null },
      message,
    );
    return reply({
      collections: d.collections.nodes.map((c) => ({
        id: c.id,
        title: c.title,
        products: c.productsCount?.count ?? null,
      })),
      products: d.products.nodes,
    });
  }
  if (path === '/settings' && request.method === 'PUT') {
    await manager();
    const b = await jsonBody(request, 64000);
    const source = asText(b.sourceWebshopId || ''),
      target = asText(b.targetWebshopId || ''),
      sourceLocation = asText(b.sourceLocationId || ''),
      targetLocation = asText(b.targetLocationId || ''),
      interval = Number(b.intervalMinutes);
    if (!source || !target || source === target)
      throw new HttpError(400, 'Vælg to forskellige webshops.');
    await requireWebshop(db, actor, company, source);
    await requireWebshop(db, actor, company, target);
    if (
      !gid('Location').test(sourceLocation) ||
      !gid('Location').test(targetLocation)
    )
      throw new HttpError(400, 'Vælg en lagerlokation i begge webshops.');
    if (!(intervals as readonly number[]).includes(interval))
      throw new HttpError(400, 'Vælg et gyldigt interval.');
    const pick = (value: unknown, kind: string) => {
      if (!Array.isArray(value) || value.length > 500)
        throw new HttpError(
          400,
          'Ugyldigt valg af kollektioner eller produkter.',
        );
      const seen = new Set<string>();
      return value.map((raw) => {
        const item = raw as Record<string, unknown>,
          id = asText(item?.id || ''),
          title = asText(item?.title || '').slice(0, 200);
        if (!gid(kind).test(id) || seen.has(id))
          throw new HttpError(
            400,
            'Ugyldigt valg af kollektioner eller produkter.',
          );
        seen.add(id);
        return { id, title };
      });
    };
    const selection = b.selection as Record<string, unknown> | undefined;
    const value: Selection = {
      collections: pick(selection?.collections ?? [], 'Collection'),
      products: pick(selection?.products ?? [], 'Product'),
    };
    const current = await loadSettings(env, company);
    if (current && b.revision !== current.revision)
      throw new HttpError(
        409,
        'Opsætningen er ændret i en anden fane. Genindlæs siden.',
      );
    // Changing the source or target webshop would leave the links pointing at the old ones.
    if (
      current &&
      (current.source_webshop_id !== source ||
        current.target_webshop_id !== target) &&
      (await db
        .prepare('SELECT 1 FROM shop_sync_products WHERE company_id=? LIMIT 1')
        .bind(company)
        .first())
    )
      throw new HttpError(
        409,
        'Webshoppene kan ikke skiftes, efter der er synkroniseret produkter. Kontakt support.',
      );
    if (
      current &&
      current.source_location_id !== sourceLocation &&
      (await db
        .prepare('SELECT 1 FROM shop_sync_variants WHERE company_id=? LIMIT 1')
        .bind(company)
        .first())
    )
      throw new HttpError(
        409,
        'Lagerlokationen kan ikke skiftes, efter der er synkroniseret lager. Kontakt support.',
      );
    if (
      current &&
      current.target_location_id !== targetLocation &&
      (await db
        .prepare('SELECT 1 FROM shop_sync_variants WHERE company_id=? LIMIT 1')
        .bind(company)
        .first())
    )
      throw new HttpError(
        409,
        'Lagerlokationen kan ikke skiftes, efter der er synkroniseret lager. Kontakt support.',
      );
    const revision = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO shop_sync_settings(company_id,source_webshop_id,target_webshop_id,source_location_id,target_location_id,interval_minutes,enabled,selection_json,revision,updated_by)
         VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET source_webshop_id=excluded.source_webshop_id,target_webshop_id=excluded.target_webshop_id,
         source_location_id=excluded.source_location_id,target_location_id=excluded.target_location_id,interval_minutes=excluded.interval_minutes,enabled=excluded.enabled,
         selection_json=excluded.selection_json,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP,next_run_at=0`,
      )
      .bind(
        company,
        source,
        target,
        sourceLocation,
        targetLocation,
        interval,
        b.enabled === true ? 1 : 0,
        JSON.stringify(value),
        revision,
        actor.id,
      )
      .run();
    return reply({ ok: true, revision });
  }
  if (path === '/status' && get) {
    const [products, collections, uncertain] = await Promise.all([
      db
        .prepare(
          'SELECT source_product_id,target_product_id,state,title,synced_at,error FROM shop_sync_products WHERE company_id=? ORDER BY title,source_product_id',
        )
        .bind(company)
        .all(),
      db
        .prepare(
          'SELECT source_collection_id,target_collection_id,title,synced_at,error FROM shop_sync_collections WHERE company_id=? ORDER BY title',
        )
        .bind(company)
        .all(),
      db
        .prepare(
          "SELECT v.source_variant_id,v.source_product_id,p.title,v.error FROM shop_sync_variants v JOIN shop_sync_products p ON p.company_id=v.company_id AND p.source_product_id=v.source_product_id WHERE v.company_id=? AND v.state='uncertain'",
        )
        .bind(company)
        .all(),
    ]);
    return reply({
      products: products.results,
      collections: collections.results,
      uncertain: uncertain.results,
    });
  }
  if (path === '/run' && request.method === 'POST') {
    await manager();
    await jsonBody(request);
    return reply({ result: await run(env, company, !productionWrites(env)) });
  }
  if (path === '/reset' && request.method === 'POST') {
    await manager();
    const b = await jsonBody(request),
      variant = asText(b.sourceVariantId || '');
    if (!gid('ProductVariant').test(variant))
      throw new HttpError(400, 'Vælg en variant.');
    // After a person has checked the stock, the target simply gets the source's quantity at the next run.
    const done = await db
      .prepare(
        "UPDATE shop_sync_variants SET state='ok',pending_json=NULL,last_quantity=NULL,error=NULL WHERE company_id=? AND source_variant_id=? AND state='uncertain'",
      )
      .bind(company, variant)
      .run();
    if (!done.meta.changes)
      throw new HttpError(404, 'Varen venter ikke på kontrol.');
    return reply({ ok: true });
  }
  throw new HttpError(404, 'Funktionen findes ikke i appen.');
}
