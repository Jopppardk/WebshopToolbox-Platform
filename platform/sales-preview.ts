import type { CheckedInvoice } from './invoice-check';
type Accounts = Record<string, string>;
export type PreviewAccount = {
  number: string;
  name: string;
  vatCode: string;
  kind: 'entry' | 'deposit';
  hidden: boolean;
};
export type SalesDraft = {
  ready: boolean;
  blockers: string[];
  lines: {
    title: string;
    account: string | null;
    vatCode: string | null;
    net: number;
    tax: number;
    gross: number;
  }[];
  clearing: string | null;
  debit: number;
  credit: number;
  inventory?: { account: string; adjustmentAccount: string; cost: number };
};

/** markets: countries of the markets enabled under Indstillinger → Markeder; their orders are booked in DKK like Danish ones. */
export function salesDraft(
  invoice: CheckedInvoice,
  settings: Partial<Accounts>,
  chart: PreviewAccount[],
  inventoryEnabled = false,
  markets: string[] = [],
): SalesDraft {
  const blockers: string[] = [];
  if (
    invoice.currency !== 'DKK' ||
    !['DK', ...markets].includes(invoice.countryCode || '')
  )
    blockers.push(
      'Første bogføringsforhåndsvisning understøtter kun danske ordrer i DKK. Udenlandsk salg skal afklares særskilt.',
    );
  const account = (value: string | undefined) => {
    const number = value?.match(/^(\d+)(?:\s*-|$)/)?.[1];
    return chart.find((a) => a.number === number && !a.hidden);
  };
  const clearing = account(settings.clearing);
  if (!clearing)
    blockers.push(
      'Vælg en eksisterende, aktiv mellemregningskonto under Administration.',
    );
  if (clearing?.vatCode)
    blockers.push('Mellemregningskontoen skal være uden momskode.');
  const lines = invoice.lines.map((line) => {
    if (line.kind === 'unclassified')
      blockers.push(
        `“${line.title}” er ikke klassificeret som en fysisk vare; kontoen skal afklares.`,
      );
    const rate =
      line.rates.length === 0 && line.tax === 0
        ? 0
        : line.rates.length === 1
          ? line.rates[0]
          : -1;
    if (![0, 0.25].includes(rate) || line.channelLiable)
      blockers.push(
        `“${line.title}” har en momstype, som kræver særskilt gennemgang.`,
      );
    if (Math.abs(Math.round(line.net * rate) - line.tax) > 1)
      blockers.push(`“${line.title}”: Momsbeløbet stemmer ikke med satsen.`);
    const taxable = rate === 0.25;
    const noVat = !taxable && settings.noVatCode === 'NONE';
    const vatCode = noVat
      ? ''
      : (taxable ? settings.vatCode : settings.noVatCode)?.match(
          /^([A-Z][A-Z0-9]*)(?:\s*-|$)/,
        )?.[1] || null;
    // Only explicitly configured Danish sales VAT codes are supported in this first slice.
    if (taxable ? vatCode !== 'U25' : !noVat)
      blockers.push(
        `Vælg ${taxable ? 'U25' : 'Ingen moms'} som momskode for denne type salg.`,
      );
    const selected = account(
      line.kind === 'shipping'
        ? taxable
          ? settings.shippingVat
          : settings.shippingNoVat
        : taxable
          ? settings.goodsVat
          : settings.goodsNoVat,
    );
    if (!selected || selected.kind !== 'entry')
      blockers.push(
        `“${line.title}”: Vælg en eksisterende bogføringskonto i Dinero.`,
      );
    if (selected && selected.vatCode !== vatCode)
      blockers.push(
        `Konto ${selected.number}: Kontoplanens momskode (${selected.vatCode || 'ingen'}) passer ikke til ${vatCode || 'den manglende momskode'}.`,
      );
    if (selected && selected.number === clearing?.number)
      blockers.push('Salg og mellemregning må ikke anvende samme konto.');
    return {
      title: line.title,
      account: selected ? `${selected.number} - ${selected.name}` : null,
      vatCode,
      net: line.net,
      tax: line.tax,
      gross: line.gross,
    };
  });
  const credit = lines.reduce((total, line) => total + line.net + line.tax, 0);
  if (credit !== invoice.gross) blockers.push('Forslaget balancerer ikke.');
  let inventory: SalesDraft['inventory'];
  if (inventoryEnabled) {
    const inventoryAccount = account(settings.inventory),
      adjustmentAccount = account(settings.inventoryAdjustment);
    if (!inventoryAccount || !adjustmentAccount)
      blockers.push('Vælg aktive konti til varebeholdning og lagerregulering.');
    if (inventoryAccount?.vatCode || adjustmentAccount?.vatCode)
      blockers.push('Lagerkonti skal være uden momskode.');
    if (inventoryAccount?.number === adjustmentAccount?.number)
      blockers.push(
        'Varebeholdning og lagerregulering skal bruge forskellige konti.',
      );
    // Shopify can mark service/add-on variants (for example engraving) as requiring
    // shipping even though they carry no inventory value. Only explicit positive
    // Shopify costs belong in the inventory movement; a missing cost must never
    // prevent the otherwise complete sales voucher from being booked.
    const goods = invoice.lines.filter(
      (line) => line.kind === 'goods' && (line.unitCostMinor ?? 0) > 0,
    );
    const cost = goods.reduce(
      (sum, line) => sum + line.unitCostMinor! * line.quantity,
      0,
    );
    if (inventoryAccount && adjustmentAccount && cost > 0)
      inventory = {
        account: `${inventoryAccount.number} - ${inventoryAccount.name}`,
        adjustmentAccount: `${adjustmentAccount.number} - ${adjustmentAccount.name}`,
        cost,
      };
  }
  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    lines,
    clearing: clearing ? `${clearing.number} - ${clearing.name}` : null,
    debit: invoice.gross,
    credit,
    inventory,
  };
}
