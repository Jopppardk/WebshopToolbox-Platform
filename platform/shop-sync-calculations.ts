// Webshop-synkronisering (shop-sync.ts): what to send to Shopify, as plain functions without network or database.

// ---- Stock, both ways ----
// The goods exist once. What the target sold since the last sync (last − target now) is taken from the source, and
// the target then gets the source's quantity. Every stock write is a compare-and-set (changeFromQuantity), so a
// quantity that moved meanwhile is never overwritten; the next run starts again from the new numbers.
export type Pending = {
  side: 'source' | 'target';
  // The quantity before and after the write, and what last_quantity becomes when it is known to have happened.
  from: number;
  to: number;
  last: number;
  key: string;
};
export function stockStep(last: number | null, source: number, target: number) {
  // First link: nothing has been sold through the target yet, so it simply gets the source's quantity.
  const sold = last === null ? 0 : last - target,
    next = source - sold;
  return {
    sold,
    sourceTo: sold !== 0 ? next : null,
    targetTo: target !== next ? next : null,
    next,
  };
}
// A write without a certain answer is looked up before anything new is sent: the quantity shows whether it happened.
// Anything else (it moved for another reason too) cannot be told apart and is left for a person to check.
export function resolvePending(pending: Pending, now: number) {
  if (now === pending.to && pending.to !== pending.from) return 'applied';
  if (now === pending.from) return 'not-applied';
  return 'unknown';
}

// ---- Products ----
export type SourceVariant = {
  id: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryPolicy: string;
  taxable: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  inventoryItem: {
    id: string;
    tracked: boolean;
    requiresShipping: boolean;
    unitCost: { amount: string } | null;
    measurement: { weight: { unit: string; value: number } | null } | null;
    inventoryLevel: {
      quantities: Array<{ name: string; quantity: number }>;
    } | null;
  };
};
export type SourceProduct = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: string;
  category: { id: string } | null;
  seo: { title: string | null; description: string | null };
  options: Array<{
    name: string;
    position: number;
    optionValues: Array<{ name: string }>;
  }>;
  media: {
    nodes: Array<{ image?: { url: string; altText: string | null } | null }>;
  };
  variants: {
    nodes: SourceVariant[];
    pageInfo: { hasNextPage: boolean };
  };
  weight: { value: string } | null;
  reportable: { value: string } | null;
};
export type TargetVariant = {
  id: string;
  selectedOptions: Array<{ name: string; value: string }>;
  inventoryItem: {
    id: string;
    inventoryLevel: {
      quantities: Array<{ name: string; quantity: number }>;
    } | null;
  };
};

export const syncTag = (sourceProductId: string) =>
  'wtb-sync-' + (sourceProductId.match(/(\d+)$/)?.[1] ?? '');
export const available = (
  level: { quantities: Array<{ name: string; quantity: number }> } | null,
) => {
  const value = level?.quantities.find((q) => q.name === 'available')?.quantity;
  return Number.isSafeInteger(value) ? (value as number) : null;
};
const optionKey = (options: Array<{ name: string; value: string }>) =>
  JSON.stringify(options.map((o) => [o.name, o.value]));

export async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export const images = (product: SourceProduct) =>
  product.media.nodes
    .filter((m) => m.image?.url)
    .map((m) => ({ url: m.image!.url, alt: m.image!.altText || '' }));

// The fields that are copied. A change in any of them (not in stock) sends the product again.
export function productData(
  product: SourceProduct,
  options: { prices: boolean; sourceName: string },
) {
  return {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: [...product.tags].sort(),
    status: options.prices ? product.status : null,
    category: product.category?.id ?? null,
    seo: product.seo,
    options: product.options.map((o) => ({
      name: o.name,
      values: o.optionValues.map((v) => v.name),
    })),
    variants: product.variants.nodes.map((v) => ({
      options: v.selectedOptions,
      sku: v.sku,
      barcode: v.barcode,
      price: options.prices ? v.price : null,
      compareAtPrice: options.prices ? v.compareAtPrice : null,
      inventoryPolicy: v.inventoryPolicy,
      taxable: v.taxable,
      tracked: v.inventoryItem.tracked,
      requiresShipping: v.inventoryItem.requiresShipping,
      cost: v.inventoryItem.unitCost?.amount ?? null,
      weight: v.inventoryItem.measurement?.weight ?? null,
    })),
    packaging: {
      weight: product.weight?.value ?? null,
      reportable: product.reportable?.value ?? null,
    },
    sourceName: options.sourceName,
  };
}

// productSet input. A new product gets the source's quantity at the target location in the same call; afterwards
// stock is only changed by the stock step. Existing target variants are matched on their options, so they keep
// their id and inventory item (a variant without a match would be deleted and created again by productSet).
export function productSetInput(
  product: SourceProduct,
  options: {
    prices: boolean;
    sourceName: string;
    create: boolean;
    files: boolean;
    targetLocationId: string;
    targetVariants: TargetVariant[];
  },
) {
  const data = productData(product, options);
  const existing = new Map(
    options.targetVariants.map((v) => [optionKey(v.selectedOptions), v.id]),
  );
  const metafields = [
    {
      namespace: 'webshoptoolbox',
      key: 'synkroniseret_fra',
      type: 'single_line_text_field',
      value: options.sourceName,
    },
    ...(data.packaging.weight !== null
      ? [
          {
            namespace: 'custom',
            key: 'emballage_vaegt_gram',
            type: 'number_integer',
            value: data.packaging.weight,
          },
        ]
      : []),
    ...(data.packaging.reportable !== null
      ? [
          {
            namespace: 'custom',
            key: 'emballage_indberetning',
            type: 'boolean',
            value: data.packaging.reportable,
          },
        ]
      : []),
  ];
  return {
    title: data.title,
    descriptionHtml: data.descriptionHtml,
    vendor: data.vendor,
    productType: data.productType,
    tags: [...data.tags, syncTag(product.id)],
    // Without prices a new product waits as a draft until prices are set in the target; its status is never changed.
    ...(options.prices
      ? { status: product.status }
      : options.create
        ? { status: 'DRAFT' }
        : {}),
    ...(options.create ? { handle: product.handle } : {}),
    ...(data.category ? { category: data.category } : {}),
    seo: {
      title: product.seo.title || null,
      description: product.seo.description || null,
    },
    metafields,
    productOptions: product.options.map((o) => ({
      name: o.name,
      position: o.position,
      values: o.optionValues.map((v) => ({ name: v.name })),
    })),
    ...(options.files
      ? {
          files: images(product).map((image) => ({
            originalSource: image.url,
            alt: image.alt,
            contentType: 'IMAGE',
          })),
        }
      : {}),
    variants: product.variants.nodes.map((v, position) => {
      const id = existing.get(optionKey(v.selectedOptions)),
        quantity = available(v.inventoryItem.inventoryLevel);
      const weight = v.inventoryItem.measurement?.weight;
      return {
        ...(id ? { id } : {}),
        position: position + 1,
        optionValues: v.selectedOptions.map((o) => ({
          optionName: o.name,
          name: o.value,
        })),
        sku: v.sku,
        barcode: v.barcode,
        ...(options.prices
          ? { price: v.price, compareAtPrice: v.compareAtPrice }
          : {}),
        inventoryPolicy: v.inventoryPolicy,
        taxable: v.taxable,
        inventoryItem: {
          tracked: v.inventoryItem.tracked,
          requiresShipping: v.inventoryItem.requiresShipping,
          ...(v.inventoryItem.unitCost
            ? { cost: v.inventoryItem.unitCost.amount }
            : {}),
          ...(weight ? { measurement: { weight } } : {}),
        },
        ...(options.create && v.inventoryItem.tracked && quantity !== null
          ? {
              inventoryQuantities: [
                {
                  locationId: options.targetLocationId,
                  name: 'available',
                  quantity,
                },
              ],
            }
          : {}),
      };
    }),
  };
}

// Source and target variants that belong together after a productSet (matched on their options).
export function pairVariants(source: SourceVariant[], target: TargetVariant[]) {
  const byOptions = new Map(
    target.map((v) => [optionKey(v.selectedOptions), v]),
  );
  return source.flatMap((v) => {
    const t = byOptions.get(optionKey(v.selectedOptions));
    return t ? [{ source: v, target: t }] : [];
  });
}

export const intervals = [15, 30, 60, 180, 360, 720, 1440] as const;
export const gid = (kind: string) =>
  new RegExp(`^gid://shopify/${kind}/\\d{1,30}$`);
