// Adapted from the existing feed.sablen.dk formatter, read-only source reference 2026-09-23.
export type FeedFormat={SHOPIFY_COLLECTION_TITLE:string;SHIPPING_COST:string;FREE_SHIPPING_FROM:number|null;DELIVERY_TIME:string;LOCALE?:string|null};
// Stock text in the market's language; Danish when the language is unknown.
const stockText:Record<string,[string,string]>={sv:['I lager','Ej i lager'],nb:['På lager','Ikke på lager'],no:['På lager','Ikke på lager'],en:['In stock','Out of stock'],de:['Auf Lager','Nicht auf Lager'],fi:['Varastossa','Ei varastossa']};
export interface Variant {
  id: string;
  barcode: string | null;
  title: string;
  price: string;
  compareAtPrice: string | null;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  selectedOptions: Array<{ name: string; value: string }>;
  image: { url: string } | null;
}

export interface Product {
  id: string;
  status: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  vendor: string;
  featuredImage: { url: string } | null;
  gender: { value: string } | null;
  productType?: string;
  variants: { nodes: Variant[]; pageInfo?: {hasNextPage:boolean;endCursor:string|null} };
}

export function productXml(product: Product, variant: Variant, primaryDomain: string, env: FeedFormat): string {
  const option = (names: string[]) =>
    variant.selectedOptions.find((item) => names.includes(item.name.toLocaleLowerCase("da")))?.value ?? "";
  const size = option(["size", "størrelse"]);
  const color = option(["color", "colour", "farve"]);
  const variantSuffix = variant.title === "Default Title" ? "" : ` - ${variant.title}`;
  const numericVariantId = variant.id.split("/").pop() ?? "";
  const imageUrl = variant.image?.url || product.featuredImage?.url || "";
  const category = env.SHOPIFY_COLLECTION_TITLE;
  const oldPrice = variant.compareAtPrice && Number(variant.compareAtPrice) > Number(variant.price)
    ? variant.compareAtPrice
    : variant.price;
  const [inStock, outOfStock] = stockText[(env.LOCALE || "").split("-")[0].toLowerCase()] ?? ["På lager", "Ikke på lager"];
  const stockStatus = variant.availableForSale ? inStock : outOfStock;
  const productUrl = `${primaryDomain.replace(/\/$/, "")}/products/${encodeURIComponent(product.handle)}?variant=${numericVariantId}`;

  return [
    "  <produkt>",
    tag("kategorinavn", category),
    tag("brand", product.vendor),
    tag("variantid", numericVariantId),
    tag("ean", variant.barcode ?? ""),
    tag("produktnavn", `${product.title}${variantSuffix}`),
    tag("produktbeskrivelse", htmlToPlainText(product.descriptionHtml)),
    tag("pris", money(variant.price)),
    tag("gammelpris", money(oldPrice)),
    tag("billedurl", imageUrl),
    tag("vareurl", productUrl),
    tag("fragtomk", env.FREE_SHIPPING_FROM !== null && Number(variant.price) >= env.FREE_SHIPPING_FROM ? "0" : env.SHIPPING_COST),
    tag("lagerstatus", stockStatus),
    tag("leveringstid", env.DELIVERY_TIME ?? ""),
    tag("size", size),
    tag("color", color),
    tag("gender", product.gender?.value ?? ""),
    "  </produkt>",
  ].join("\n");
}

function tag(name: string, value: string): string {
  return `    <${name}>${escapeXml(value)}</${name}>`;
}

function money(value: string): string {
  return Number(value).toFixed(2);
}

function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
    const number = code[1].toLowerCase() === "x"
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
}

function escapeXml(value: string): string {
  return String(value)
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
