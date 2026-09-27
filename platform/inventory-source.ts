import {orderQuery,shopAccess} from './invoice-source';
import {HttpError,type PlatformEnv} from './types';
import {inventoryValueMinor,type InventoryRow} from './inventory-calculations';
type Page = { inventoryItems: { nodes: Array<{ id: string; tracked: boolean; unitCost: null | { amount: string; currencyCode: string }; variant: null | { title: string; sku: string; product: { title: string; status: string } }; inventoryLevels: { nodes: Array<{ location: { id: string; name: string; isActive: boolean }; quantities: Array<{ name: string; quantity: number }> }> } }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
export async function readInventory(env:PlatformEnv,company:string,shop:string) {
  const access = await shopAccess(env,company,shop);
  const rows: InventoryRow[] = [], locations = new Map<string, string>();
  let after: string | null = null;const seen=new Set<string>();
  for (let page = 0; page < 25; page++) {
    const data: Page = await orderQuery<Page>(access, `query InventoryStatus($after:String) { inventoryItems(first:100,after:$after) { nodes { id tracked unitCost { amount currencyCode } variant { title sku product { title status } } inventoryLevels(first:100) { nodes { location { id name isActive } quantities(names:["on_hand"]) { name quantity } } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } }`, { after }, 'Shopify kunne ikke hente lagerdata. Kontrollér read_inventory, read_products og adgang til kostpriser.');
    for (const item of data.inventoryItems.nodes) {
      if (!item.tracked || !item.variant || item.variant.product.status !== 'ACTIVE') continue;
      if((item.inventoryLevels as any).pageInfo?.hasNextPage!==false)throw new HttpError(409,'Lagerets lokationer er ufuldstændige.');
      for (const level of item.inventoryLevels.nodes) {
        if (!level.location.isActive) continue;
        locations.set(level.location.id, level.location.name);
        const quantity = level.quantities.find(q => q.name === 'on_hand')?.quantity, amount = Number(item.unitCost?.amount);
        if (!Number.isSafeInteger(quantity) || !Number.isFinite(amount) || amount < 0 || !item.unitCost) continue;
        rows.push({ inventoryItemId: item.id, locationId: level.location.id, product: item.variant.product.title, variant: item.variant.title, sku: item.variant.sku || '', quantity: quantity!, unitCostMinor: Math.round(amount * 100), currency: item.unitCost.currencyCode });
      }
    }
    if (!data.inventoryItems.pageInfo.hasNextPage) break;
    after = data.inventoryItems.pageInfo.endCursor;
    if (!after || seen.has(after) || page === 24) throw new HttpError(409,'Shopify-lageret er for stort til en sikker samlet indlæsning.');seen.add(after);
  }
  const keys=rows.map(r=>JSON.stringify([r.inventoryItemId,r.locationId]));if(new Set(keys).size!==keys.length||!Number.isSafeInteger(inventoryValueMinor(rows)))throw new HttpError(409,'Ugyldige eller gentagne lagerlinjer.');
  rows.sort((a, b) => a.product.localeCompare(b.product, 'da') || a.variant.localeCompare(b.variant, 'da'));
  return { rows, locations: [...locations].map(([id, name]) => ({ id, name })), totalValueMinor: inventoryValueMinor(rows), fetchedAt: new Date().toISOString() };
}
