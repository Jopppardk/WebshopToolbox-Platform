export const accountKeys = [
  'vatCode',
  'noVatCode',
  'goodsVat',
  'goodsNoVat',
  'shippingVat',
  'shippingNoVat',
  'servicesVat',
  'servicesNoVat',
  'refundGoodsVat',
  'refundGoodsNoVat',
  'refundShippingVat',
  'refundShippingNoVat',
  'refundServicesVat',
  'refundServicesNoVat',
  'fees',
  'clearing',
  'bank',
  'shopifyPaymentsClearing',
  'viaBillClearing',
  'flatpayClearing',
  'inventory',
  'inventoryAdjustment',
] as const;
export type Accounts = Record<(typeof accountKeys)[number], string>;
// Mellemregningskonti are chosen per webshop: each webshop has its own payment providers. A webshop
// without its own value uses the company's account.
export const webshopAccountKeys = [
  'clearing',
  'shopifyPaymentsClearing',
  'viaBillClearing',
  'flatpayClearing',
] as const;
export function webshopAccounts(preferencesJson?: string | null) {
  const own = JSON.parse(preferencesJson || '{}').accounts || {};
  return Object.fromEntries(
    webshopAccountKeys
      .filter((key) => typeof own[key] === 'string' && own[key])
      .map((key) => [key, own[key] as string]),
  ) as Partial<Accounts>;
}
/** The company's accounts with the webshop's own mellemregningskonti on top. */
export function accountsForWebshop(
  companyJson: string | null | undefined,
  preferencesJson?: string | null,
): Record<string, string> {
  return {
    ...JSON.parse(companyJson || '{}'),
    ...webshopAccounts(preferencesJson),
  };
}
export const automationKeys = [
  'attachments',
  'bookDinero',
  'salesBookDinero',
  'refundsBookDinero',
  'payoutsBookDinero',
  'inventoryBookDinero',
  'sales',
  'payments',
  'refunds',
  'payouts',
  'invoiceEmails',
  'inventory',
] as const;
export type Automation = Record<(typeof automationKeys)[number], boolean>;
export type InvoiceEmailSettings = {
  subject: string;
  body: string;
  creditSubject: string;
  creditBody: string;
};
export type AdminSettings = {
  accounts: Accounts;
  automation: Automation;
  invoiceEmail: InvoiceEmailSettings;
  syncIntervalMinutes: number;
};
import { normalizeSyncInterval } from './sync-schedule';
export const emptyAccounts = Object.fromEntries(
  accountKeys.map((key) => [key, '']),
) as Accounts;
export const defaultAutomation = {
  ...Object.fromEntries(automationKeys.map((key) => [key, false])),
  bookDinero: true,
  salesBookDinero: true,
  refundsBookDinero: true,
  payoutsBookDinero: true,
  inventoryBookDinero: true,
} as Automation;
export const defaultInvoiceEmail: InvoiceEmailSettings = {
  subject: 'Faktura {{fakturanummer}} fra WebshopToolbox',
  body: 'Hej {{kundenavn}}\n\nTak for din ordre hos WebshopToolbox.\n\nVedhæftet finder du faktura {{fakturanummer}} for ordre {{ordrenummer}}.\n\nVenlig hilsen\nWebshopToolbox',
  creditSubject: 'Kreditnota {{kreditnotanummer}} fra {{virksomhedsnavn}}',
  creditBody:
    'Hej {{kundenavn}}\n\nVi har tilbagebetalt {{beløb}} for ordre {{ordrenummer}}.\n\nVedhæftet finder du kreditnota {{kreditnotanummer}}.\n\nVenlig hilsen\n{{virksomhedsnavn}}',
};
export function validateSettings(input: unknown): AdminSettings {
  if (!input || typeof input !== 'object')
    throw new Error('Ugyldige indstillinger');
  const value = input as Partial<AdminSettings>;
  const accounts = { ...emptyAccounts },
    automation = { ...defaultAutomation };
  // Preserve the former shared choice when old settings are read for the first time.
  const legacyBookDinero = value.automation?.bookDinero;
  if (typeof legacyBookDinero === 'boolean') {
    automation.salesBookDinero = legacyBookDinero;
    automation.refundsBookDinero = legacyBookDinero;
    automation.payoutsBookDinero = legacyBookDinero;
    automation.inventoryBookDinero = legacyBookDinero;
  }
  for (const key of accountKeys) {
    const field = value.accounts?.[key];
    if (
      field === undefined &&
      [
        'bank',
        'shopifyPaymentsClearing',
        'viaBillClearing',
        'flatpayClearing',
        'inventory',
        'inventoryAdjustment',
      ].includes(key)
    )
      continue;
    if (
      typeof field !== 'string' ||
      field.length > 200 ||
      /[\x00-\x1f]/.test(field)
    )
      throw new Error('Ugyldig kontotilknytning');
    accounts[key] = field.trim();
  }
  for (const key of automationKeys) {
    const field = value.automation?.[key];
    if (
      field === undefined &&
      [
        'bookDinero',
        'salesBookDinero',
        'refundsBookDinero',
        'payoutsBookDinero',
        'inventoryBookDinero',
        'invoiceEmails',
        'inventory',
      ].includes(key)
    )
      continue;
    if (typeof field !== 'boolean') throw new Error('Ugyldigt modulvalg');
    automation[key] = field;
  }
  const invoiceEmail = { ...defaultInvoiceEmail };
  for (const key of [
    'subject',
    'body',
    'creditSubject',
    'creditBody',
  ] as const) {
    const field = value.invoiceEmail?.[key];
    if (field === undefined) continue;
    if (
      typeof field !== 'string' ||
      !field.trim() ||
      field.length > (key.toLowerCase().endsWith('subject') ? 200 : 4000) ||
      /\x00/.test(field)
    )
      throw new Error('Ugyldig mailskabelon');
    invoiceEmail[key] = field.trim();
  }
  const syncIntervalMinutes = normalizeSyncInterval(value.syncIntervalMinutes);
  return { accounts, automation, invoiceEmail, syncIntervalMinutes };
}
