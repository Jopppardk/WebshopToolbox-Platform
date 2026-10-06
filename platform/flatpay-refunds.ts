// Valitor reconciliation mapping: https://documentation.ixopay.com/manual/adapters/valitor
// REFU06 is a refund; REJE16 is a failed refund, chargebacks have separate codes.
export function flatpayRefund(
  row: Record<string, unknown>,
  merchantID: string,
  agreementID: string,
) {
  if (
    row.merchantID !== merchantID ||
    row.agreementID !== agreementID ||
    row.transactionCode !== 'REFU06'
  )
    return null;
  if (
    typeof row.transactionID !== 'string' ||
    !row.transactionID ||
    row.transactionID.length > 200 ||
    typeof row.purchaseDate !== 'string' ||
    !Number.isFinite(Date.parse(row.purchaseDate)) ||
    typeof row.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(row.currency)
  )
    throw Error('Flatpay-refunderingen mangler gyldigt ID, dato eller valuta.');
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: row.currency,
  }).resolvedOptions().maximumFractionDigits!;
  const amount = (v: unknown) => {
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      !Number.isSafeInteger(Math.round(v * 10 ** digits))
    )
      throw Error('Flatpay-refunderingen indeholder et ugyldigt beløb.');
    return { amount: String(v), currencyCode: String(row.currency) };
  };
  const gross = amount(row.grossAmount),
    fee = amount(row.fees),
    net = amount(row.netAmount);
  const id = `flatpay:refund:${merchantID}:${agreementID}:${row.transactionID}`;
  return {
    id,
    provider: 'flatpay',
    merchantID,
    agreementID,
    type: 'REFUND',
    test: false,
    transactionDate: new Date(row.purchaseDate).toISOString(),
    amount: gross,
    fee,
    net,
    associatedOrder: null,
    associatedPayout: null,
    sourceOrderTransactionId: null,
    settlementNumber:
      typeof row.settlementNumber === 'string' ? row.settlementNumber : null,
    transactionID: row.transactionID,
    transactionCode: 'REFU06',
    grossMinor: Math.round(Number(gross.amount) * 10 ** digits),
    feeMinor: Math.round(Number(fee.amount) * 10 ** digits),
    netMinor: Math.round(Number(net.amount) * 10 ** digits),
  };
}
