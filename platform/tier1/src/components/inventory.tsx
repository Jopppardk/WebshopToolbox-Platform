'use client';
import { PageTitle } from '@/platform/workspace';
import { useConfirm } from '@/components/confirm-dialog';
import { useStackTable } from '@/lib/stack-table';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useCapabilities } from '@/platform/capabilities';
import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/refresh-button';
import { Input } from '@/components/ui/input';
import type { InventoryRow } from '@/lib/inventory';

type Incomplete = {
  inventoryItemId: string;
  product: string;
  variant: string;
  sku: string;
  location: string;
  reason: string;
};
type Dinero =
  | { account: number; valueMinor: number; from: string; to: string }
  | { error: string };
type Company =
  | { shops: number; valueMinor: number; incomplete: number; dkk: boolean }
  | { error: string };
type Pending = {
  id: string;
  shop: string;
  phase: string;
  at: string;
  kind: 'reconcile' | 'count';
  adjustmentMinor: number;
  dineroError: { status: number; detail: string } | null;
  voucher: boolean;
  releasable: boolean;
};
type Result = {
  pending?: Pending[];
  rows: InventoryRow[];
  locations: Array<{ id: string; name: string }>;
  totalValueMinor: number;
  incomplete?: Incomplete[];
  // Products synced from another webshop (custom app Webshop-synkronisering): shown, not counted.
  synced?: Array<InventoryRow & { from: string }>;
  dinero?: Dinero;
  company?: Company;
  fetchedAt: string;
  error?: string;
};
type Prepared = {
  operationId?: string;
  version?: string;
  adjustmentMinor?: number;
  error?: string;
};
export function Inventory() {
  const runtime = useCapabilities();
  const { confirm, dialog } = useConfirm();
  const stackRef = useStackTable<HTMLTableElement>();
  const [data, setData] = useState<Result | null>(null),
    [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/shopify/inventory', {
        cache: 'no-store',
      });
      const value = (await response.json()) as Result;
      if (!response.ok) throw new Error(value.error);
      setData(value);
      setCounts({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lageret kunne ikke indlæses.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const changes = useMemo(
    () =>
      (data?.rows || []).flatMap((row) => {
        const key = `${row.inventoryItemId}:${row.locationId}`,
          raw = counts[key];
        if (raw === undefined || raw === '' || Number(raw) === row.quantity)
          return [];
        return [
          {
            inventoryItemId: row.inventoryItemId,
            locationId: row.locationId,
            quantity: Number(raw),
            compareQuantity: row.quantity,
          },
        ];
      }),
    [data, counts],
  );
  const correctedValue = (data?.rows || []).reduce((sum, row) => {
    const raw = counts[`${row.inventoryItemId}:${row.locationId}`],
      quantity = raw === undefined || raw === '' ? row.quantity : Number(raw);
    return (
      sum +
      (Number.isSafeInteger(quantity) && quantity >= 0
        ? quantity
        : row.quantity) *
        row.unitCostMinor
    );
  }, 0);
  const dinero =
    data?.dinero && 'valueMinor' in data.dinero ? data.dinero : null;
  // Dinero's inventory account is company-wide, so it is compared with all the company's webshops together.
  const company =
    data?.company && 'valueMinor' in data.company ? data.company : null;
  const difference =
    company && dinero ? company.valueMinor - dinero.valueMinor : null;
  const blocked = !company
    ? ''
    : !company.dkk
      ? 'Regulering kræver kostpriser i DKK.'
      : company.incomplete
        ? `${company.incomplete} varer mangler lagerantal eller kostpris i Shopify. Ret dem før regulering.`
        : '';
  // Prepare on the server, show the exact amount, and only then commit (or simulate in the test environment).
  const run = async (
    body: Record<string, unknown>,
    dialogFor: (
      amount: string,
      direction: string,
    ) => { title: string; message: string; confirmLabel: string },
  ) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const preparedResponse = await fetch('/api/shopify/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const prepared = (await preparedResponse.json()) as Prepared;
      if (!preparedResponse.ok) throw new Error(prepared.error);
      const amount = money(Math.abs(prepared.adjustmentMinor || 0)),
        direction =
          (prepared.adjustmentMinor || 0) < 0 ? 'nedskrivning' : 'opskrivning';
      const approved = await confirm(dialogFor(amount, direction));
      if (!approved) {
        setMessage('Handlingen blev ikke godkendt. Intet er ændret.');
        setBusy(false);
        return;
      }
      const response = await fetch('/api/shopify/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: runtime.bookkeeping ? 'commit' : 'simulate',
          id: prepared.operationId,
          version: prepared.version,
          confirmation: true,
        }),
      });
      const value = (await response.json()) as {
        voucherNumber?: number;
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(value.error);
      setMessage(
        `${value.message || 'Handlingen er simuleret. Shopify og Dinero er uændrede.'}${value.voucherNumber ? ` Bilag nr. ${value.voucherNumber}.` : ''}`,
      );
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Lagerhandlingen kunne ikke gennemføres.',
      );
      setBusy(false);
    }
  };
  const save = () =>
    changes.length
      ? run({ action: 'prepare', changes }, (amount, direction) =>
          runtime.bookkeeping
            ? {
                title: 'Godkend lageroptælling',
                message: `Lagerantal opdateres i Shopify, og reguleringen overføres til Dinero. Lagerværdi: ${direction} på ${amount}.`,
                confirmLabel: 'Opdatér lager',
              }
            : {
                title: 'Simulér lageroptælling',
                message: `Lagerværdi: ${direction} på ${amount}. Ingen ændringer sendes til Shopify eller Dinero.`,
                confirmLabel: 'Simulér',
              },
        )
      : undefined;
  const reconcile = () =>
    company && dinero
      ? run(
          {
            action: 'prepare-reconcile',
            shopifyValueMinor: company.valueMinor,
            dineroValueMinor: dinero.valueMinor,
          },
          (amount, direction) =>
            runtime.bookkeeping
              ? {
                  title: 'Regulér lagerkonto i Dinero',
                  message: `Der oprettes et finansbilag med ${direction} på ${amount} af lagerkonto ${dinero.account}, så den svarer til ${company.shops > 1 ? `lagerværdien i virksomhedens ${company.shops} webshops` : 'webshoppens lagerværdi'}. Lagerantal i Shopify ændres ikke.`,
                  confirmLabel: 'Opret finansbilag',
                }
              : {
                  title: 'Simulér regulering i Dinero',
                  message: `Finansbilag: ${direction} på ${amount} af lagerkonto ${dinero.account}. Intet sendes til Dinero.`,
                  confirmLabel: 'Simulér',
                },
        )
      : undefined;
  // A regulation the platform could not confirm blocks new ones. After checking Dinero, the user can release one that never reached Dinero.
  const release = async (item: Pending) => {
    const label =
      item.kind === 'reconcile'
        ? 'Lagerafstemning mod webshoppens lagerværdi'
        : 'Lagerregulering';
    const approved = await confirm(
      item.voucher
        ? {
            title: 'Afklar regulering',
            message:
              'Bilaget slås op i Dinero. Er det bogført eller findes det ikke, afklares reguleringen. Ligger det som kladde, skal du først bogføre eller slette kladden.',
            confirmLabel: 'Kontrollér i Dinero',
          }
        : {
            title: 'Afklar regulering',
            message: `Kontrollér i Dinero, at der ikke ligger en kladde med teksten "${label}" fra ${item.at.slice(0, 10)} på ${money(Math.abs(item.adjustmentMinor))}. Et bogført bilag eller intet bilag er begge i orden, fordi en ny regulering bruger de aktuelle værdier i Shopify og Dinero. Ligger der en kladde, skal den bogføres eller slettes først.`,
            confirmLabel: 'Ingen kladde i Dinero – afklar',
          },
    );
    if (!approved) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/shopify/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'release',
          externalId: item.id,
          confirmation: 'no-draft-in-dinero',
        }),
      });
      const value = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(value.error);
      setMessage(value.message || 'Reguleringen er frigivet.');
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Reguleringen kunne ikke frigives.',
      );
      setBusy(false);
    }
  };
  const money = (minor: number) =>
    new Intl.NumberFormat('da-DK', {
      style: 'currency',
      currency: 'DKK',
    }).format(minor / 100);
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      {dialog}
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Bogføring · Shopify</p>
          <PageTitle title="Lager" />
          <p className="mt-2 text-sm text-muted-foreground">
            Webshoppens lagerværdi sammenholdt med lagerkontoen i Dinero, og
            kontrolleret optælling baseret på Shopifys fysiske antal og
            kostpris.
          </p>
        </div>
        <RefreshButton onRefresh={load} disabled={busy} />
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          {message}
        </p>
      )}
      {data && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">
                {company && company.shops > 1
                  ? `Lagerværdi i ${company.shops} webshops`
                  : 'Lagerværdi i webshop'}
              </p>
              <p className="mt-2 text-xl font-semibold">
                {money(company ? company.valueMinor : data.totalValueMinor)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Shopify · fysisk antal × kostpris
                {company && company.shops > 1
                  ? ` · denne webshop ${money(data.totalValueMinor)}`
                  : ''}
                {company?.incomplete
                  ? ` · ekskl. ${company.incomplete} ufuldstændige`
                  : ''}
              </p>
              {data.company && 'error' in data.company ? (
                <p className="mt-1 text-xs text-red-700">
                  {data.company.error}
                </p>
              ) : null}
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">
                Lagerværdi i Dinero
              </p>
              {dinero ? (
                <>
                  <p className="mt-2 text-xl font-semibold">
                    {money(dinero.valueMinor)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Konto {dinero.account} · bogført saldo {dinero.from} –{' '}
                    {dinero.to}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {data.dinero && 'error' in data.dinero
                    ? data.dinero.error
                    : 'Ikke hentet.'}
                </p>
              )}
            </div>
            <div className="stat-card">
              <p className="text-xs text-muted-foreground">
                Difference (webshop − Dinero)
              </p>
              {difference === null ? (
                <p className="mt-2 text-xl font-semibold text-muted-foreground">
                  –
                </p>
              ) : (
                <>
                  <p
                    className={`mt-2 text-xl font-semibold ${difference ? 'text-amber-700' : 'text-emerald-700'}`}
                  >
                    {money(difference)}
                  </p>
                  {difference ? (
                    blocked ? (
                      <p className="mt-1 text-xs text-amber-800">{blocked}</p>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={reconcile}
                        disabled={busy || !!changes.length}
                        title={
                          changes.length
                            ? 'Gem eller fortryd optællingen først.'
                            : undefined
                        }
                      >
                        {runtime.bookkeeping
                          ? 'Regulér Dinero'
                          : 'Simulér regulering'}
                      </Button>
                    )
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Dinero svarer til webshoppen.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
          {!!data.pending?.length && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-semibold">Uafklaret lagerregulering</p>
              <p className="mt-1 text-xs">
                Nye reguleringer er spærret, indtil den er afklaret, så
                differencen ikke bogføres to gange.
              </p>
              <ul className="mt-3 space-y-2">
                {data.pending.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span>
                      {item.kind === 'reconcile'
                        ? 'Regulering af lagerkonto'
                        : 'Lageroptælling'}{' '}
                      · {item.at.slice(0, 16)} · {money(item.adjustmentMinor)}
                      {item.dineroError
                        ? ` · Dinero svarede HTTP ${item.dineroError.status}${item.dineroError.detail ? ': ' + item.dineroError.detail : ''}`
                        : ''}
                    </span>
                    {item.releasable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => release(item)}
                        disabled={busy}
                      >
                        {item.voucher ? 'Kontrollér i Dinero' : 'Afklar'}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Behandles stadig. Prøv igen om lidt.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.locations.length !== 1 && (
            <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
              Der er {data.locations.length} aktive lagerlokationer. Optællingen
              vises pr. lokation; kontrollér lokationsnavnet før ændringer.
            </p>
          )}
          <section className="overflow-hidden rounded-2xl border bg-white">
            <div className="overflow-x-auto">
              <table
                ref={stackRef}
                className="stack-table w-full min-w-[820px] text-sm"
              >
                <thead>
                  <tr className="border-b bg-muted/45 text-left">
                    <th className="p-4">Produkt</th>
                    <th>Variant / SKU</th>
                    <th>Lokation</th>
                    <th className="text-right">Shopify antal</th>
                    <th className="text-right">Kostpris</th>
                    <th className="text-right">Værdi</th>
                    <th className="w-32 px-4">Optalt antal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => {
                    const key = `${row.inventoryItemId}:${row.locationId}`;
                    return (
                      <tr key={key} className="border-b">
                        <td className="p-4 font-medium">{row.product}</td>
                        <td>
                          {row.variant}
                          {row.sku ? (
                            <span className="block text-xs text-muted-foreground">
                              {row.sku}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {data.locations.find((l) => l.id === row.locationId)
                            ?.name || row.locationId}
                        </td>
                        <td className="text-right tabular-nums">
                          {row.quantity}
                        </td>
                        <td className="text-right tabular-nums">
                          {money(row.unitCostMinor)}
                        </td>
                        <td className="text-right tabular-nums">
                          {money(Math.max(0, row.quantity) * row.unitCostMinor)}
                        </td>
                        <td className="px-4">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={counts[key] ?? String(row.quantity)}
                            onChange={(e) =>
                              setCounts((c) => ({
                                ...c,
                                [key]: e.target.value,
                              }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-xs text-muted-foreground">
                {changes.length ? (
                  <span className="mb-1 block font-medium text-foreground">
                    Værdi efter optælling: {money(correctedValue)} (
                    {money(correctedValue - data.totalValueMinor)})
                  </span>
                ) : null}
                {runtime.bookkeeping
                  ? 'Godkendte optællinger opdaterer Shopify og overføres til Dinero efter dine indstillinger.'
                  : 'Testmiljøet simulerer optællingen. Ingen eksterne ændringer.'}
              </p>
              <Button
                onClick={save}
                disabled={
                  busy ||
                  !changes.length ||
                  changes.some(
                    (c) => !Number.isSafeInteger(c.quantity) || c.quantity < 0,
                  )
                }
              >
                <Save />
                {busy
                  ? 'Behandler…'
                  : `${runtime.bookkeeping ? 'Gem' : 'Simulér'} ${changes.length || ''}`}
              </Button>
            </div>
          </section>
          {!!data.incomplete?.length && (
            <details className="group mt-6 overflow-hidden rounded-2xl border bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold">
                <span>
                  Varer uden lagerantal eller kostpris ({data.incomplete.length}
                  )
                </span>
                <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                  Vis
                </span>
                <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">
                  Skjul
                </span>
              </summary>
              <p className="border-t px-4 pt-3 text-xs text-muted-foreground">
                Varerne er lagerstyrede i Shopify, men Shopify har ikke oplyst
                lagerantal eller kostpris. De indgår ikke i lagerværdien og kan
                ikke optælles her. Ret dem i Shopify, og hent lagerstatus igen.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-4">Produkt</th>
                      <th>Variant / SKU</th>
                      <th>Lokation</th>
                      <th className="pr-4">Mangler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.incomplete.map((item) => (
                      <tr
                        key={item.inventoryItemId + ':' + item.location}
                        className="border-b last:border-0"
                      >
                        <td className="p-4 font-medium">{item.product}</td>
                        <td>
                          {item.variant}
                          {item.sku ? (
                            <span className="block text-xs text-muted-foreground">
                              {item.sku}
                            </span>
                          ) : null}
                        </td>
                        <td>{item.location}</td>
                        <td className="pr-4">{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {!!data.synced?.length && (
            <details className="group mt-6 overflow-hidden rounded-2xl border bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold">
                <span>
                  Synkroniseret fra en anden webshop ({data.synced.length})
                </span>
                <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                  Vis
                </span>
                <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">
                  Skjul
                </span>
              </summary>
              <p className="border-t px-4 pt-3 text-xs text-muted-foreground">
                Varerne er kopier af varer i en anden webshop og deler dens
                lager. De indgår ikke i lagerværdien og optælles i den webshop,
                de er synkroniseret fra.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-4">Produkt</th>
                      <th>Variant / SKU</th>
                      <th>Antal</th>
                      <th className="pr-4">Synkroniseret fra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.synced.map((item) => (
                      <tr
                        key={item.inventoryItemId + ':' + item.locationId}
                        className="border-b last:border-0"
                      >
                        <td className="p-4 font-medium">{item.product}</td>
                        <td>
                          {item.variant}
                          {item.sku ? (
                            <span className="block text-xs text-muted-foreground">
                              {item.sku}
                            </span>
                          ) : null}
                        </td>
                        <td>{item.quantity}</td>
                        <td className="pr-4">{item.from}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
