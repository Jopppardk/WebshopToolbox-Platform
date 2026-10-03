export type InventoryRow = {
  inventoryItemId: string;
  locationId: string;
  product: string;
  variant: string;
  sku: string;
  quantity: number;
  unitCostMinor: number;
  currency: string;
};

export const inventoryValueMinor = (rows: InventoryRow[]) =>
  rows.reduce(
    (sum, row) => sum + Math.max(0, row.quantity) * row.unitCostMinor,
    0,
  );

export function validateStocktakeChanges(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    throw new Error('Vælg mellem 1 og 100 ændrede lagerlinjer.');
  const seen = new Set<string>();
  return value.map((raw) => {
    const item = raw as Record<string, unknown>;
    const inventoryItemId = String(item.inventoryItemId || '');
    const locationId = String(item.locationId || '');
    const quantity = Number(item.quantity);
    const compareQuantity = Number(item.compareQuantity);
    if (
      !/^gid:\/\/shopify\/InventoryItem\/\d+$/.test(inventoryItemId) ||
      !/^gid:\/\/shopify\/Location\/\d+$/.test(locationId)
    )
      throw new Error('En lagerlinje har et ugyldigt Shopify-ID.');
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 0 ||
      quantity > 10_000_000 ||
      !Number.isSafeInteger(compareQuantity)
    )
      throw new Error('Et lagerantal er ugyldigt.');
    const key = `${inventoryItemId}:${locationId}`;
    if (seen.has(key))
      throw new Error('Den samme lagerlinje er angivet flere gange.');
    seen.add(key);
    return { inventoryItemId, locationId, quantity, compareQuantity };
  });
}
