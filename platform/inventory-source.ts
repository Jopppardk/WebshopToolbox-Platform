import { orderQuery, shopAccess, type Access } from './invoice-source';
import { HttpError, type PlatformEnv } from './types';
import {
  inventoryValueMinor,
  type InventoryRow,
} from './inventory-calculations';
type Page = {
  inventoryItems: {
    nodes: Array<{
      id: string;
      tracked: boolean;
      unitCost: null | { amount: string; currencyCode: string };
      variant: null | {
        title: string;
        sku: string;
        product: { title: string; status: string };
      };
      inventoryLevels: {
        nodes: Array<{
          location: { id: string; name: string; isActive: boolean };
          quantities: Array<{ name: string; quantity: number }>;
        }>;
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};
const lagerMessage =
  'Shopify kunne ikke hente lagerdata. Kontrollér read_inventory, read_products og adgang til kostpriser.';
// On ACCESS_DENIED the scopes Shopify actually granted this installation are read and named, so a scope
// that is set in the app but not yet approved in the store (a new app version) can be told apart.
async function inventoryPage(
  access: Access,
  query: string,
  variables: Record<string, unknown>,
) {
  try {
    return await orderQuery<Page>(access, query, variables, lagerMessage);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/\(Shopify: ACCESS_DENIED/.test(error.message)
    )
      throw error;
    const granted = await orderQuery<{
      currentAppInstallation: { accessScopes: Array<{ handle: string }> };
    }>(
      access,
      'query InventoryAccess{currentAppInstallation{accessScopes{handle}}}',
      {},
      lagerMessage,
    )
      .then((d) =>
        (d.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle),
      )
      .catch(() => null);
    if (!granted) throw error;
    const missing = ['read_inventory', 'read_products'].filter(
      // A write_ scope includes its read_ access, and Shopify may then list only the write_ handle.
      (s) =>
        !granted.includes(s) && !granted.includes(s.replace('read_', 'write_')),
    );
    throw new HttpError(
      409,
      error.message +
        (missing.length
          ? `. Butikken ${access.shop} har ikke godkendt ${missing.join(' og ')} for appen. Er adgangen tilføjet i appen, skal den nye app-version udgives og godkendes i butikken.`
          : `. Butikken ${access.shop} har godkendt read_inventory og read_products for appen.`),
    );
  }
}
export async function readInventory(
  env: PlatformEnv,
  company: string,
  shop: string,
) {
  const access = await shopAccess(env, company, shop);
  const rows: InventoryRow[] = [],
    locations = new Map<string, string>();
  // Tracked items Shopify gives no quantity or cost for; shown on Lager instead of failing the read.
  const incomplete: Array<{
    inventoryItemId: string;
    product: string;
    variant: string;
    sku: string;
    location: string;
    reason: string;
  }> = [];
  let after: string | null = null;
  const seen = new Set<string>();
  for (let page = 0; page < 25; page++) {
    const data: Page = await inventoryPage(
      access,
      `query InventoryStatus($after:String) { inventoryItems(first:100,after:$after) { nodes { id tracked unitCost { amount currencyCode } variant { title sku product { title status } } inventoryLevels(first:100) { nodes { location { id name isActive } quantities(names:["on_hand"]) { name quantity } } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } }`,
      { after },
    );
    for (const item of data.inventoryItems.nodes) {
      if (
        !item.tracked ||
        !item.variant ||
        item.variant.product.status !== 'ACTIVE'
      )
        continue;
      if ((item.inventoryLevels as any).pageInfo?.hasNextPage !== false)
        throw new HttpError(409, 'Lagerets lokationer er ufuldstændige.');
      for (const level of item.inventoryLevels.nodes) {
        if (!level.location.isActive) continue;
        locations.set(level.location.id, level.location.name);
        const quantity = level.quantities.find(
            (q) => q.name === 'on_hand',
          )?.quantity,
          amount = Number(item.unitCost?.amount);
        const noQuantity = !Number.isSafeInteger(quantity),
          noCost = !item.unitCost || !Number.isFinite(amount) || amount < 0;
        if (noQuantity || noCost) {
          incomplete.push({
            inventoryItemId: item.id,
            product: item.variant.product.title,
            variant: item.variant.title,
            sku: item.variant.sku || '',
            location: level.location.name,
            reason:
              noQuantity && noCost
                ? 'Mangler lagerantal og kostpris'
                : noQuantity
                  ? 'Mangler lagerantal'
                  : 'Mangler kostpris',
          });
          continue;
        }
        rows.push({
          inventoryItemId: item.id,
          locationId: level.location.id,
          product: item.variant.product.title,
          variant: item.variant.title,
          sku: item.variant.sku || '',
          quantity: quantity!,
          unitCostMinor: Math.round(amount * 100),
          currency: item.unitCost!.currencyCode,
        });
      }
    }
    if (!data.inventoryItems.pageInfo.hasNextPage) break;
    after = data.inventoryItems.pageInfo.endCursor;
    if (!after || seen.has(after) || page === 24)
      throw new HttpError(
        409,
        'Shopify-lageret er for stort til en sikker samlet indlæsning.',
      );
    seen.add(after);
  }
  const keys = rows.map((r) =>
    JSON.stringify([r.inventoryItemId, r.locationId]),
  );
  if (
    new Set(keys).size !== keys.length ||
    !Number.isSafeInteger(inventoryValueMinor(rows))
  )
    throw new HttpError(409, 'Ugyldige eller gentagne lagerlinjer.');
  rows.sort(
    (a, b) =>
      a.product.localeCompare(b.product, 'da') ||
      a.variant.localeCompare(b.variant, 'da'),
  );
  incomplete.sort(
    (a, b) =>
      a.product.localeCompare(b.product, 'da') ||
      a.variant.localeCompare(b.variant, 'da') ||
      a.location.localeCompare(b.location, 'da'),
  );
  return {
    rows,
    locations: [...locations].map(([id, name]) => ({ id, name })),
    totalValueMinor: inventoryValueMinor(rows),
    incomplete,
    fetchedAt: new Date().toISOString(),
  };
}
