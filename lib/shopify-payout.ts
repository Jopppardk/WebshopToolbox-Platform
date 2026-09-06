import { minorUnits } from './shopify-payments';

export const payoutSummaryFields = [
  'adjustmentsFee', 'adjustmentsGross', 'advanceFees', 'advanceGross',
  'chargesFee', 'chargesGross', 'refundsFee', 'refundsFeeGross',
  'reservedFundsFee', 'reservedFundsGross', 'retriedPayoutsFee',
  'retriedPayoutsGross', 'usdcRebateCreditAmount',
] as const;

type Money = { amount: string; currencyCode: string };
export type PayoutSummary = Record<(typeof payoutSummaryFields)[number], Money>;

export function payoutBreakdown(summary: PayoutSummary, net: Money) {
  const currency = net.currencyCode;
  const amount = (key: keyof PayoutSummary) => {
    const money = summary?.[key];
    if (!money || money.currencyCode !== currency) throw new Error('Shopify returnerede udbetalingen i flere valutaer.');
    return minorUnits(money.amount, currency);
  };
  const charges = amount('chargesGross');
  const refunds = amount('refundsFeeGross');
  const fees = amount('chargesFee') + amount('refundsFee');
  const unsupported = ['adjustmentsFee', 'adjustmentsGross', 'advanceFees', 'advanceGross', 'reservedFundsFee',
    'reservedFundsGross', 'retriedPayoutsFee', 'retriedPayoutsGross', 'usdcRebateCreditAmount'] as const;
  const netMinor = minorUnits(net.amount, currency);
  if (unsupported.some(key => amount(key) !== 0)) throw new Error('Udbetalingen indeholder reguleringer, reserver eller forskud, som skal gennemgås manuelt.');
  if (charges < 0 || refunds > 0 || fees < 0) throw new Error('Shopify returnerede uventede fortegn i udbetalingsoversigten.');
  if (charges + refunds - fees !== netMinor) throw new Error('Shopifys bruttobeløb, refunderinger og gebyrer stemmer ikke med nettoudbetalingen.');
  return { currency, charges, refunds, fees, net: netMinor };
}
