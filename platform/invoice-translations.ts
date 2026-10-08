// Product names in the market's language on invoices and credit notes (e.g. Swedish for Sabeln.se). Shopify keeps
// an order's lines in the store's main language, so the product's own translation (Translate & Adapt, or any app
// using Shopify's translations) is fetched and replaces the product title in the line name; the variant part
// ("- Sort / M") is kept. A product without a translation, or a store whose app lacks read_translations, keeps the
// original names: the invoice is never held back for a missing translation.
import { orderQuery, type Access } from './invoice-source';

type Line = {
  name: string;
  variant?: null | {
    title?: string | null;
    product?: null | { id: string; title: string };
  };
};

/** Product titles in \`locale\` by product ID, for the products given; empty when translations cannot be read. */
export async function productTitles(
  access: Access,
  productIds: string[],
  locale: string,
): Promise<Map<string, string>> {
  const ids = [...new Set(productIds)].filter((id) =>
    /^gid:\/\/shopify\/Product\/\d+$/.test(id),
  );
  const titles = new Map<string, string>();
  if (!ids.length || !/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) return titles;
  try {
    for (let at = 0; at < ids.length; at += 100) {
      const data = await orderQuery<{
        translatableResourcesByIds: {
          nodes: Array<{
            resourceId: string;
            translations: Array<{ key: string; value: string | null }>;
          }>;
        };
      }>(
        access,
        'query ToolboxProductTitles($ids:[ID!]!,$locale:String!){translatableResourcesByIds(first:100,resourceIds:$ids){nodes{resourceId translations(locale:$locale){key value}}}}',
        { ids: ids.slice(at, at + 100), locale },
        'Produktnavnenes oversættelser kunne ikke hentes.',
      );
      for (const node of data.translatableResourcesByIds?.nodes ?? []) {
        const title = node.translations?.find((t) => t.key === 'title')?.value;
        if (typeof title === 'string' && title.trim())
          titles.set(node.resourceId, title.trim());
      }
    }
  } catch {
    // Without read_translations (or any read error) the original names are used.
    return new Map();
  }
  return titles;
}

/** The line name with the product title in the translation, keeping the variant part. */
export function translatedName(line: Line, titles: Map<string, string>) {
  const product = line.variant?.product,
    title = product ? titles.get(product.id) : undefined;
  if (!product || !title) return line.name;
  if (line.name.startsWith(product.title))
    return title + line.name.slice(product.title.length);
  const variant = line.variant?.title;
  return variant && variant !== 'Default Title'
    ? `${title} - ${variant}`
    : title;
}

/** The order with its product lines named in \`locale\`; other fields are untouched. */
export async function withTranslatedLines<
  T extends { lineItems: { nodes: Line[] } },
>(access: Access, order: T, locale: string): Promise<T> {
  const titles = await productTitles(
    access,
    order.lineItems.nodes
      .map((l) => l.variant?.product?.id)
      .filter((id): id is string => !!id),
    locale,
  );
  if (!titles.size) return order;
  return {
    ...order,
    lineItems: {
      ...order.lineItems,
      nodes: order.lineItems.nodes.map((l) => ({
        ...l,
        name: translatedName(l, titles),
      })),
    },
  };
}

/** A credit note's line names as on its invoice: a refund line ("Danish title - variant") gets the invoice line's
 *  translated name when that line is the same product and variant. Uses only the invoice's stored source. */
export function creditLineTitles<T extends { kind: string; title: string }>(
  lines: T[],
  invoiceLines: Line[],
): T[] {
  return lines.map((line) => {
    if (line.kind !== 'goods') return line;
    for (const source of invoiceLines) {
      const product = source.variant?.product;
      if (!product || !line.title.startsWith(product.title)) continue;
      const variant = line.title.slice(product.title.length);
      if (!source.name.endsWith(variant)) continue;
      const translated = source.name.slice(
        0,
        source.name.length - variant.length,
      );
      if (translated && translated !== product.title)
        return { ...line, title: translated + variant };
    }
    return line;
  });
}
