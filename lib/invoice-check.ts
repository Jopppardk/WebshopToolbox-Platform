export type MoneyBag = { shopMoney: { amount: string; currencyCode: string } };
export type Tax = { priceSet: MoneyBag; rate: number | null; channelLiable?: boolean | null };
export type Address = { name?: string | null; address1?: string | null; address2?: string | null; zip?: string | null; city?: string | null; country?: string | null; countryCodeV2?: string | null };
export type SourceLine = { id: string; name: string; quantity: number; currentQuantity: number; requiresShipping: boolean; isGiftCard: boolean; variant?: null | { inventoryItem?: null | { id: string; unitCost?: null | { amount: string; currencyCode: string } } }; originalTotalSet: MoneyBag; discountAllocations: { allocatedAmountSet: MoneyBag }[]; taxLines: Tax[]; discountedTotalSet?: MoneyBag };
export type SourceShipping = { id: string; title: string; isRemoved: boolean; originalPriceSet: MoneyBag; discountedPriceSet: MoneyBag; discountAllocations: { allocatedAmountSet: MoneyBag }[]; taxLines: Tax[] };
export type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
export type InvoiceSource = {
  id: string; name: string; createdAt: string; updatedAt: string; processedAt: string;
  email?: string | null;
  test: boolean; edited: boolean; cancelledAt: string | null; taxesIncluded: boolean;
  displayFinancialStatus: string | null; displayFulfillmentStatus: string;
  fulfillments: { createdAt: string; status: string }[];
  customer?: { displayName?: string | null; firstName?: string | null; lastName?: string | null } | null;
  billingAddress: Address | null; shippingAddress: Address | null;
  currentTotalPriceSet: MoneyBag; currentSubtotalPriceSet: MoneyBag; currentTotalTaxSet: MoneyBag;
  totalRefundedSet: MoneyBag; totalPriceSet: MoneyBag; totalTaxSet: MoneyBag;
  lineItems: Connection<SourceLine>; shippingLines: Connection<SourceShipping>;
};
export type CheckedLine = { id: string; title: string; quantity: number; kind: 'goods' | 'shipping' | 'unclassified'; net: number; tax: number; gross: number; discount: number; rates: number[]; channelLiable: boolean; unitCostMinor?: number; inventoryItemId?: string };
export type CheckedInvoice = { orderId: string; number: string; date: string; currency: string; customer: Address & { name: string }; countryCode: string | null; paid: boolean; lines: CheckedLine[]; net: number; tax: number; gross: number; discount: number; taxesIncluded: boolean };
export class InvoiceCheckError extends Error {}
const fail = (message: string): never => { throw new InvoiceCheckError(message); };
export function shipmentDate(order: InvoiceSource) {
  if (!Array.isArray(order.fulfillments) || !order.fulfillments.length) return fail('Shopify mangler afsendelsesdatoen. Hent ordren igen.');
  const dates = order.fulfillments.filter(f => f?.status === 'SUCCESS' && Number.isFinite(Date.parse(f.createdAt))).map(f => f.createdAt);
  if (!dates.length) return fail('Shopify mangler en gennemført afsendelse med dato.');
  return dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}
export function units(bag: MoneyBag | undefined | null, currency: string) {
  const money = bag?.shopMoney;
  if (!money || money.currencyCode !== currency || typeof money.amount !== 'string' || !/^\d+(\.\d+)?$/.test(money.amount)) return fail('Manglende beløb eller forskellige valutaer. Hent ordren igen.');
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!;
  const [whole, fraction = ''] = money.amount.split('.');
  if (/[1-9]/.test(fraction.slice(digits))) return fail('Et beløb har for mange decimaler.');
  const value = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0').slice(0, digits));
  if (!Number.isSafeInteger(value)) return fail('Et beløb er for stort.');
  return value;
}
const sum = (values: number[]) => { const result = values.reduce((a, b) => a + b, 0); if (!Number.isSafeInteger(result)) return fail('Summen er for stor.'); return result; };
export function checkInvoice(order: InvoiceSource): CheckedInvoice {
  if (order?.displayFulfillmentStatus !== 'FULFILLED') return fail('Afventer afsendelse. Hele ordren skal være markeret som afsendt i Shopify, før faktura eller bogføringsforslag kan oprettes.');
  if (!order || typeof order.taxesIncluded !== 'boolean' || typeof order.edited !== 'boolean' || typeof order.test !== 'boolean' || order.cancelledAt === undefined) return fail('Ordren mangler kontroldata. Brug Kontrollér på Salg eller hent Shopify-ordrer igen.');
  if (order.test || order.cancelledAt) return fail('Testordrer og annullerede ordrer kan ikke faktureres i dette forløb.');
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(order.id) || !order.name?.trim() || !Number.isFinite(Date.parse(order.createdAt))) return fail('Ordren mangler gyldigt nummer eller dato.');
  const currency = order.currentTotalPriceSet?.shopMoney?.currencyCode;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return fail('Ordren mangler valuta.');
  if (order.edited || units(order.totalRefundedSet, currency) !== 0 || ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.displayFinancialStatus || '')) return fail('Ordren er ændret eller refunderet. Faktura/kreditnota skal gennemgås særskilt; eksisterende PDF bevares.');
  if (!order.lineItems?.nodes?.length || !Array.isArray(order.shippingLines?.nodes) || order.lineItems.pageInfo?.hasNextPage !== false || order.shippingLines.pageInfo?.hasNextPage !== false) return fail('Alle vare- og fragtlinjer er ikke hentet.');
  const address = order.billingAddress || order.shippingAddress;
  const name = address?.name?.trim() || order.customer?.displayName?.trim() || [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ').trim();
  if (!name || !address?.address1?.trim() || !address.city?.trim() || !address.zip?.trim() || !address.country?.trim()) return fail('Fakturaen mangler kundenavn eller fuld adresse. Ret oplysningerne i Shopify først.');
  const seen = new Set<string>();
  function line(item: SourceLine | SourceShipping, shipping: boolean): CheckedLine {
    if (!item.id || seen.has(item.id)) return fail('En vare-/fragtlinje mangler ID eller forekommer flere gange.'); seen.add(item.id);
    const goods = item as SourceLine; const freight = item as SourceShipping;
    const title = (shipping ? freight.title : goods.name)?.trim();
    const quantity = shipping ? 1 : goods.quantity;
    if (!title || !Number.isSafeInteger(quantity) || quantity <= 0) return fail('En varelinje mangler navn eller gyldigt antal.');
    if (shipping ? freight.isRemoved !== false : goods.currentQuantity !== goods.quantity) return fail('Ordren indeholder fjernede eller refunderede linjer og skal gennemgås særskilt.');
    if (!shipping && (goods.isGiftCard !== false || typeof goods.requiresShipping !== 'boolean')) return fail('Gavekort eller manglende vareklassifikation kræver særskilt gennemgang.');
    if (!Array.isArray(item.discountAllocations) || !Array.isArray(item.taxLines)) return fail('En linje mangler rabat- eller momsoplysninger.');
    const original = units(shipping ? freight.originalPriceSet : goods.originalTotalSet, currency);
    const discount = sum(item.discountAllocations.map(d => units(d.allocatedAmountSet, currency)));
    const afterDiscount = original - discount;
    const tax = sum(item.taxLines.map(t => units(t.priceSet, currency)));
    const net = order.taxesIncluded ? afterDiscount - tax : afterDiscount;
    if (afterDiscount < 0 || net < 0) return fail('Rabat eller moms overstiger linjens beløb.');
    if (shipping && afterDiscount !== units(freight.discountedPriceSet, currency)) return fail('Fragtens rabatter stemmer ikke med Shopify.');
    let unitCostMinor: number | undefined, inventoryItemId: string | undefined;
    if (!shipping && goods.requiresShipping && goods.variant?.inventoryItem) {
      const cost = goods.variant.inventoryItem.unitCost;
      if (cost?.currencyCode === currency && /^\d+(\.\d+)?$/.test(cost.amount)) unitCostMinor = Math.round(Number(cost.amount) * 100);
      inventoryItemId = goods.variant.inventoryItem.id;
    }
    return { id: item.id, title, quantity, kind: shipping ? 'shipping' : goods.requiresShipping ? 'goods' : 'unclassified', net, tax, gross: net + tax, discount, rates: item.taxLines.map(t => t.rate ?? -1), channelLiable: item.taxLines.some(t => t.channelLiable === true), unitCostMinor, inventoryItemId };
  }
  const lines = [...order.lineItems.nodes.map(item => line(item, false)), ...order.shippingLines.nodes.map(item => line(item, true))];
  const net = sum(lines.map(l => l.net)), tax = sum(lines.map(l => l.tax)), gross = sum(lines.map(l => l.gross));
  if (gross !== units(order.currentTotalPriceSet, currency) || tax !== units(order.currentTotalTaxSet, currency) || gross !== units(order.totalPriceSet, currency) || tax !== units(order.totalTaxSet, currency)) return fail('Varelinjer, fragt, moms og ordretotal stemmer ikke. Ingen PDF eller godkendt bogføringskladde oprettes.');
  const goodsSubtotal = sum(lines.filter(l => l.kind !== 'shipping').map(l => order.taxesIncluded ? l.gross : l.net));
  if (goodsSubtotal !== units(order.currentSubtotalPriceSet, currency)) return fail('Varesummen efter rabatter stemmer ikke med Shopify.');
  return { orderId: order.id, number: order.name, date: shipmentDate(order), currency, customer: { ...address, name }, countryCode: (order.shippingAddress || address).countryCodeV2 || null, paid: order.displayFinancialStatus === 'PAID', lines, net, tax, gross, discount: sum(lines.map(l => l.discount)), taxesIncluded: order.taxesIncluded };
}
export async function invoiceFingerprint(invoice: CheckedInvoice) {
  // Payment state may change without changing the invoice's commercial content.
  const { paid: _paid, ...content } = invoice;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)))), b => b.toString(16).padStart(2, '0')).join('');
}
