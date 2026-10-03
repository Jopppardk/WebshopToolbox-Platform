import type { CheckedInvoice } from './invoice-check';
import type { SalesDraft } from './sales-preview';

export class TransferError extends Error {}
export const rejectTransfer = (message: string): never => {
  throw new TransferError(message);
};
export type Voucher = {
  VoucherDate: string;
  ExternalReference: string;
  FileGuid?: string;
  Lines: {
    Description: string;
    AccountNumber: number;
    BalancingAccountNumber?: number;
    Amount: number;
    AccountVatCode: string;
    BalancingAccountVatCode?: string;
  }[];
};
export type Expected = { net: number; tax: number; gross: number }[];
export function voucherFor(
  invoice: CheckedInvoice,
  draft: SalesDraft,
  date: string,
): { voucher: Voucher; expected: Expected } {
  if (!draft.ready) rejectTransfer(draft.blockers.join(' '));
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    rejectTransfer('Vælg en gyldig bogføringsdato.');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const orderDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(invoice.date));
  if (date > today || date < orderDate)
    rejectTransfer('Bogføringsdatoen skal være fra ordredatoen til i dag.');
  if (invoice.gross <= 0 || draft.lines.length > 100)
    rejectTransfer(
      'Nulbeløb eller mere end 100 linjer kræver særskilt behandling.',
    );
  const account = (text: string | null) => {
    const n = Number(text?.match(/^\d+/)?.[0]);
    if (!Number.isSafeInteger(n) || n <= 0) rejectTransfer('Ugyldig konto.');
    return n;
  };
  if (draft.lines.length !== invoice.lines.length)
    rejectTransfer('Varelinjerne stemmer ikke med fakturaen.');
  const groups = new Map<
    string,
    {
      kind: string;
      account: number;
      vat: string;
      net: number;
      tax: number;
      gross: number;
    }
  >();
  draft.lines.forEach((line, i) => {
    const kind =
      invoice.lines[i].kind === 'shipping' ? 'Fragtsalg' : 'Produktsalg';
    const number = account(line.account),
      vat = line.vatCode || 'none';
    const key = JSON.stringify([kind, number, vat]);
    const group = groups.get(key) || {
      kind,
      account: number,
      vat,
      net: 0,
      tax: 0,
      gross: 0,
    };
    group.net += line.net;
    group.tax += line.tax;
    group.gross += line.gross;
    groups.set(key, group);
  });
  const grouped = [...groups.values()].filter(
    (g) => g.net !== 0 || g.tax !== 0 || g.gross !== 0,
  );
  if (grouped.reduce((sum, g) => sum + g.gross, 0) !== invoice.gross)
    rejectTransfer('Forslaget balancerer ikke.');
  return {
    voucher: {
      VoucherDate: date,
      ExternalReference: `sablen:sale:${invoice.orderId.split('/').pop()}`,
      // A standalone U25 sales line is entered as its gross credit amount in
      // Dinero's manual voucher, matching the kassekladde representation.
      Lines: [
        {
          Description: `Tilgodehavende, ordre: ${invoice.number}`,
          AccountNumber: account(draft.clearing),
          Amount: invoice.gross / 100,
          AccountVatCode: 'none',
        },
        ...grouped.map((g) => ({
          Description: `${g.kind}, ordre: ${invoice.number}`,
          AccountNumber: g.account,
          Amount: -g.gross / 100,
          AccountVatCode: g.vat,
        })),
        ...(draft.inventory
          ? [
              {
                Description: `Vareforbrug, ordre: ${invoice.number}`,
                AccountNumber: account(draft.inventory.adjustmentAccount),
                BalancingAccountNumber: account(draft.inventory.account),
                Amount: draft.inventory.cost / 100,
                AccountVatCode: 'none',
                BalancingAccountVatCode: 'none',
              },
            ]
          : []),
      ],
    },
    expected: [
      { net: invoice.gross, tax: 0, gross: invoice.gross },
      ...grouped.map((g) => ({ net: -g.net, tax: -g.tax, gross: -g.gross })),
      ...(draft.inventory
        ? [{ net: draft.inventory.cost, tax: 0, gross: draft.inventory.cost }]
        : []),
    ],
  };
}
export type RemoteVoucher = {
  Guid: string;
  Status: string;
  Timestamp: string;
  VoucherNumber?: number;
  VoucherDate: string;
  ExternalReference: string;
  FileGuid?: string | null;
  Lines: Record<string, unknown>[];
};
export function normalizeRemote(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeRemote);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key[0].toUpperCase() + key.slice(1),
        normalizeRemote(item),
      ]),
    );
  return value;
}
export function verifyVoucher(
  raw: unknown,
  wanted: Voucher,
  expected: Expected,
): RemoteVoucher {
  const actual = normalizeRemote(raw) as RemoteVoucher;
  if (
    !actual ||
    !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(actual.Guid) ||
    !actual.Timestamp ||
    !['Draft', 'Booked'].includes(actual.Status)
  )
    rejectTransfer(
      'Dinero returnerede en ukendt bilagsstatus. Kontrollér bilaget i Dinero.',
    );
  if (
    actual.VoucherDate !== wanted.VoucherDate ||
    actual.ExternalReference !== wanted.ExternalReference ||
    (actual.FileGuid || '') !== (wanted.FileGuid || '') ||
    !Array.isArray(actual.Lines) ||
    actual.Lines.length !== wanted.Lines.length
  )
    rejectTransfer(
      'Dineros bilag afviger fra det godkendte forslag. Intet yderligere bogføres.',
    );
  const minor = (value: unknown) => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.000001
    )
      rejectTransfer('Dinero returnerede et ugyldigt beløb.');
    return Math.round((value as number) * 100);
  };
  actual.Lines.forEach((line, i) => {
    const target = wanted.Lines[i],
      amounts = expected[i];
    const vat = String(line.AccountVatCode || 'none').toLowerCase();
    if (
      line.Description !== target.Description ||
      line.AccountNumber !== target.AccountNumber ||
      (line.BalancingAccountNumber ?? null) !==
        (target.BalancingAccountNumber ?? null) ||
      vat !== target.AccountVatCode.toLowerCase() ||
      String(line.BalancingAccountVatCode || 'none').toLowerCase() !== 'none' ||
      (line.CurrencyKey && line.CurrencyKey !== 'DKK') ||
      minor(line.AmountExclVatValue) !== amounts.net ||
      minor(line.VatAmountValue) !== amounts.tax ||
      minor(line.AmountInclVatValue) !== amounts.gross
    )
      rejectTransfer(
        `Dinero-linje ${i + 1} stemmer ikke med konto, moms og beløb. Kladden skal gennemgås.`,
      );
  });
  return actual;
}
