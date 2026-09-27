export function minorUnits(amount: string, currency: string) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match || /[1-9]/.test((match[3] || '').slice(digits))) throw new Error('Ugyldigt beløb fra Shopify Payments');
  const value = Number(match[2]) * 10 ** digits + Number((match[3] || '').padEnd(digits, '0').slice(0, digits));
  if (!Number.isSafeInteger(value)) throw new Error('Beløbet er for stort');
  return match[1] ? -value : value;
}
