import { rejectTransfer, type Expected, type Voucher } from './dinero-sale';

export type RefundPart = { kind: 'goods' | 'shipping' | 'services'; net: number; tax: number; description: string };
export type RefundVoucherInput = { transactionId: string; orderName: string; date: string; gross: number; parts: RefundPart[] };
type Mapping = { clearing: string; vatCode: string; noVatCode: string; refundGoodsVat: string; refundGoodsNoVat: string; refundShippingVat: string; refundShippingNoVat: string; refundServicesVat: string; refundServicesNoVat: string };

const account = (value: string) => { const number = Number(value.match(/^\d+/)?.[0]); if (!Number.isSafeInteger(number) || number <= 0) rejectTransfer('Vælg alle nødvendige refunderingskonti under Indstillinger.'); return number; };
export function refundVoucher(input: RefundVoucherInput, mapping: Mapping): { voucher: Voucher; expected: Expected; accounts: number[] } {
  if (!/^gid:\/\/shopify\/ShopifyPaymentsBalanceTransaction\/\d{1,30}$/.test(input.transactionId) || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isSafeInteger(input.gross) || input.gross <= 0 || !input.parts.length || input.parts.length > 100) rejectTransfer('Tilbagebetalingen indeholder ugyldige kontroldata.');
  const grouped = new Map<string, { kind: RefundPart['kind']; net: number; tax: number; gross: number; account: number; vat: string }>();
  for (const part of input.parts) {
    if (!Number.isSafeInteger(part.net) || !Number.isSafeInteger(part.tax) || part.net + part.tax <= 0) rejectTransfer('En refunderingslinje har et ugyldigt beløb.');
    const taxable = part.tax !== 0;
    if (taxable && Math.abs(part.tax - Math.round(part.net * .25)) > 1) rejectTransfer('En refunderingslinje har en ukendt momssats.');
    const prefix = part.kind === 'goods' ? 'refundGoods' : part.kind === 'shipping' ? 'refundShipping' : 'refundServices';
    const number = account(mapping[`${prefix}${taxable ? 'Vat' : 'NoVat'}` as keyof Mapping]);
    const vat = taxable ? mapping.vatCode : mapping.noVatCode || 'none';
    if (!vat) rejectTransfer('Vælg momskoder for refunderinger under Indstillinger.');
    const key = `${part.kind}:${number}:${vat}`, current = grouped.get(key) || { kind: part.kind, net: 0, tax: 0, gross: 0, account: number, vat };
    current.net += part.net; current.tax += part.tax; current.gross += part.net + part.tax; grouped.set(key, current);
  }
  const lines = [...grouped.values()];
  if (lines.reduce((sum, line) => sum + line.gross, 0) !== input.gross) rejectTransfer('Refunderingslinjerne stemmer ikke med det tilbagebetalte beløb.');
  const clearing = account(mapping.clearing), id = input.transactionId.split('/').pop()!;
  const labels = { goods: 'Produktrefundering', shipping: 'Fragtrefundering', services: 'Refunderingsregulering' };
  return {
    voucher: { VoucherDate: input.date, ExternalReference: `sablen:refund:${id}`, Lines: [
      { Description: `Tilbagebetaling, ordre: ${input.orderName}`, AccountNumber: clearing, Amount: -input.gross / 100, AccountVatCode: 'none' },
      ...lines.map(line => ({ Description: `${labels[line.kind]}, ordre: ${input.orderName}`, AccountNumber: line.account, Amount: line.gross / 100, AccountVatCode: line.vat })),
    ] },
    expected: [{ net: -input.gross, tax: 0, gross: -input.gross }, ...lines.map(line => ({ net: line.net, tax: line.tax, gross: line.gross }))],
    accounts: [clearing, ...lines.map(line => line.account)],
  };
}
