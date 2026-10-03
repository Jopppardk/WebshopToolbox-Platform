// Trust Shopify's reported tax, including zero. Never infer a tax rate.
export function invoiceTotals(
  totalValue: unknown,
  taxValue: unknown,
  currency = 'DKK',
) {
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits!;
  const units = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value))
      throw new Error(
        'Fakturaen mangler gyldige beløbs- eller momsdata. Synkronisér ordren igen.',
      );
    const [whole, fraction = ''] = value.split('.');
    if (/[1-9]/.test(fraction.slice(digits)))
      throw new Error('Beløbet har for mange decimaler');
    const amount =
      Number(whole) * 10 ** digits +
      Number(fraction.padEnd(digits, '0').slice(0, digits));
    if (!Number.isSafeInteger(amount)) throw new Error('Beløbet er for stort');
    return amount;
  };
  const totalMinor = units(totalValue),
    taxMinor = units(taxValue);
  if (taxMinor > totalMinor)
    throw new Error('Momsbeløbet overstiger fakturatotalen');
  const factor = 10 ** digits;
  return {
    total: totalMinor / factor,
    tax: taxMinor / factor,
    subtotal: (totalMinor - taxMinor) / factor,
  };
}
