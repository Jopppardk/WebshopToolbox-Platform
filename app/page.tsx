'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  AlertTriangle,
  BookOpenCheck,
  Check,
  ChevronDown,
  CircleDollarSign,
  Database,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Settings2,
  ShoppingBag,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const orders = [
  {
    id: '#3841',
    date: '2. sep. 2026, 09.42',
    shipped: 'Afsendt',
    amount: '1.249,00',
    realized: '2. sep. 2026',
    status: 'Bogført',
  },
  {
    id: '#3840',
    date: '2. sep. 2026, 09.18',
    shipped: 'Afsendt',
    amount: '698,00',
    realized: '2. sep. 2026',
    status: 'Bogført',
  },
  {
    id: '#3839',
    date: '1. sep. 2026, 22.06',
    shipped: 'Ikke afsendt',
    amount: '2.195,00',
    realized: '—',
    status: 'Afventer',
  },
  {
    id: '#3838',
    date: '1. sep. 2026, 16.31',
    shipped: 'Afsendt',
    amount: '449,00',
    realized: '1. sep. 2026',
    status: 'Fejlet',
  },
  {
    id: '#3837',
    date: '1. sep. 2026, 14.12',
    shipped: 'Afsendt',
    amount: '899,00',
    realized: '1. sep. 2026',
    status: 'Bogført',
  },
];

export default function Home() {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<
    'orders' | 'invoices' | 'refunds' | 'payments' | 'payouts' | 'settings'
  >('orders');
  const [notice, setNotice] = useState('');
  const [accounts, setAccounts] = useState({
    vatCode: 'U25 - Dansk salgsmoms (25%)',
    noVatCode: 'U0 - Momsfrit (0%)',
    goodsVat: '1000 - Salg af varer/ydelser m/moms',
    goodsNoVat: '1050 - Salg af varer/ydelser u/moms',
    shippingVat: '1350 - Salg af fragt - momspligtig',
    shippingNoVat: '1300 - Salg af fragt - momsfri',
    servicesVat: '1000 - Salg af varer/ydelser m/moms',
    servicesNoVat: '1050 - Salg af varer/ydelser u/moms',
    refundGoodsVat: '1000 - Salg af varer/ydelser m/moms',
    refundGoodsNoVat: '1050 - Salg af varer/ydelser u/moms',
    refundShippingVat: '1350 - Salg af fragt - momspligtig',
    refundShippingNoVat: '1300 - Salg af fragt - momsfri',
    refundServicesVat: '1000 - Salg af varer/ydelser m/moms',
    refundServicesNoVat: '1050 - Salg af varer/ydelser u/moms',
    fees: '3628 - Betalingsgebyrer',
    clearing: '55000 - Mellemregning',
    start: '2026-09-01',
  });
  const filtered = orders.filter(
    (order) =>
      order.id.includes(query) ||
      order.status.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    const saved = localStorage.getItem('sablen-integrationshub-settings');
    if (saved) setAccounts((current) => ({ ...current, ...JSON.parse(saved) }));
  }, []);
  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  };
  const saveSettings = () => {
    localStorage.setItem(
      'sablen-integrationshub-settings',
      JSON.stringify(accounts),
    );
    notify('Indstillingerne er gemt');
  };
  return (
    <main className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[246px_1fr]">
      <aside className="sidebar-shell hidden min-h-screen flex-col lg:flex">
        <div className="flex h-24 items-center px-6">
          <img
            src="/sablen-logo.webp"
            alt="Sablen"
            className="h-auto w-[136px]"
          />
        </div>
        <nav className="flex-1 px-3 py-4" aria-label="Primær navigation">
          <p className="nav-label">Overblik</p>
          <a className="nav-item" href="#">
            <LayoutDashboard />
            Dashboard
          </a>
          <p className="nav-label mt-7">Bogføring</p>
          <button
            className={`nav-item w-full ${view === 'orders' ? 'active' : ''}`}
            onClick={() => setView('orders')}
          >
            <PackageCheck />
            Salg{' '}
            <span className="ml-auto rounded-md bg-black/10 px-1.5 py-0.5 text-[10px]">
              24
            </span>
          </button>
          <button
            className={`nav-item w-full ${view === 'payments' ? 'active' : ''}`}
            onClick={() => setView('payments')}
          >
            <CircleDollarSign />
            Betalinger
          </button>
          <button
            className={`nav-item w-full ${view === 'refunds' ? 'active' : ''}`}
            onClick={() => setView('refunds')}
          >
            <RotateCcw />
            Tilbagebetalinger{' '}
            <span className="ml-auto rounded-md bg-white/10 px-1.5 py-0.5 text-[10px]">
              3
            </span>
          </button>
          <button
            className={`nav-item w-full ${view === 'payouts' ? 'active' : ''}`}
            onClick={() => setView('payouts')}
          >
            <HandCoins />
            Udbetalinger
          </button>
          <p className="nav-label mt-7">System</p>
          <button
            className={`nav-item w-full ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            <Settings2 />
            Administration
          </button>
          <p className="nav-label mt-7">Dokumenter</p>
          <button
            className={`nav-item w-full ${view === 'invoices' ? 'active' : ''}`}
            onClick={() => setView('invoices')}
          >
            <FileText />
            Fakturaer
          </button>
        </nav>
        <div className="m-3 rounded-xl border border-white/8 bg-white/[.035] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">Systemstatus</span>
            <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
          </div>
          <p className="text-xs font-medium text-white">
            Alle forbindelser kører
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Synkroniseret for 2 min. siden
          </p>
        </div>
      </aside>
      <section className="min-w-0">
        <header className="flex h-20 items-center justify-between border-b border-border bg-white px-5 md:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <img src="/sablen-logo.webp" alt="Sablen" className="w-[105px]" />
          </div>
          <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
            <span>Sablen.dk</span>
            <ChevronDown className="size-4" />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">Rune Jensen</p>
              <p className="text-xs text-muted-foreground">Administrator</p>
            </div>
            <span className="grid size-9 place-items-center rounded-full bg-[#f1e7d7] text-xs font-bold text-[#6d5430]">
              RJ
            </span>
          </div>
        </header>
        {view === 'orders' && (
          <div
            className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9"
            id="orders"
          >
            <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="eyebrow">Shopify · Dinero</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] md:text-[36px]">
                  Ordrer
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Følg salg, realisering og bogføring ét sted.
                </p>
              </div>
              <Button className="h-10 rounded-xl px-4 shadow-sm">
                <RefreshCw data-icon="inline-start" />
                Synkronisér nu
              </Button>
            </div>
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <Stat
                label="Omsætning i september"
                value="42.684,00 kr."
                note="↑ 12,4% fra august"
                tone="lime"
              />
              <Stat
                label="Klar til bogføring"
                value="8 ordrer"
                note="6.842,00 kr. i alt"
              />
              <Stat
                label="Kræver handling"
                value="1 ordre"
                note="Senest fejlet kl. 16.32"
                tone="warn"
              />
            </div>
            <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_40px_rgba(23,31,27,.045)]">
              <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-[320px]">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-10 rounded-xl bg-muted/50 pl-9"
                    placeholder="Søg ordrenummer eller status"
                    aria-label="Søg i ordrer"
                  />
                </div>
                <Button variant="outline" className="h-10 rounded-xl px-3">
                  <SlidersHorizontal data-icon="inline-start" />
                  Filtre{' '}
                  <Badge variant="secondary" className="ml-1">
                    2
                  </Badge>
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/45 hover:bg-muted/45">
                    <TableHead className="pl-5">Ordre</TableHead>
                    <TableHead>Dato</TableHead>
                    <TableHead>Afsendelse</TableHead>
                    <TableHead className="text-right">Beløb DKK</TableHead>
                    <TableHead>Realiseret</TableHead>
                    <TableHead>Bogføring</TableHead>
                    <TableHead>
                      <span className="sr-only">Handling</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((order) => (
                    <OrderRow key={order.id} order={order} />
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t border-border px-5 py-4 text-xs text-muted-foreground">
                <span>Viser {filtered.length} af 24 ordrer</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled>
                    Forrige
                  </Button>
                  <Button size="sm" variant="outline">
                    Næste
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}
        {view === 'payments' && (
          <Payments
            onBook={() => notify('3 betalinger er sendt til bogføring')}
          />
        )}
        {view === 'invoices' && (
          <Invoices onGenerated={() => notify('Fakturaen er genereret')} />
        )}
        {view === 'refunds' && (
          <Refunds
            onBook={() => notify('Tilbagebetalingen er sendt til bogføring')}
          />
        )}
        {view === 'payouts' && (
          <Payouts
            onBook={() => notify('Udbetalingen er sendt til bogføring')}
          />
        )}
        {view === 'settings' && (
          <Settings
            accounts={accounts}
            setAccounts={setAccounts}
            onSave={saveSettings}
          />
        )}
      </section>
      {notice && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl bg-[#17201b] px-4 py-3 text-sm font-medium text-white shadow-2xl"
        >
          <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3" />
          </span>
          {notice}
        </div>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'lime' | 'warn';
}) {
  return (
    <div className={`stat-card ${tone === 'lime' ? 'stat-lime' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-xl font-semibold tracking-tight">{value}</p>
        </div>
        {tone === 'warn' && (
          <span className="mt-1 size-2 rounded-full bg-amber-400" />
        )}
      </div>
      <p
        className={`mt-2 text-xs ${tone === 'lime' ? 'text-[#427209]' : 'text-muted-foreground'}`}
      >
        {note}
      </p>
    </div>
  );
}
function OrderRow({ order }: { order: (typeof orders)[number] }) {
  const isError = order.status === 'Fejlet';
  const [state, setState] = useState(order.status);
  return (
    <TableRow className={state === 'Fejlet' ? 'bg-red-50/35' : ''}>
      <TableCell className="pl-5 font-semibold text-[#365f08]">
        {order.id}
      </TableCell>
      <TableCell className="text-muted-foreground">{order.date}</TableCell>
      <TableCell>
        <span
          className={`status-dot ${order.shipped === 'Afsendt' ? 'ok' : 'wait'}`}
        />
        {order.shipped}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {order.amount}
      </TableCell>
      <TableCell className="text-muted-foreground">{order.realized}</TableCell>
      <TableCell>
        <Badge
          variant={state === 'Fejlet' ? 'destructive' : 'secondary'}
          className={
            state === 'Bogført'
              ? 'badge-booked'
              : state === 'Afventer' || state === 'Bogfører…'
                ? 'badge-pending'
                : ''
          }
        >
          {state === 'Bogført' && <BookOpenCheck />}
          {state}
        </Badge>
      </TableCell>
      <TableCell className="pr-5 text-right">
        {state === 'Fejlet' ? (
          <Button
            size="sm"
            variant="outline"
            className="border-red-200 text-red-700 hover:bg-red-50"
            onClick={() => {
              setState('Bogfører…');
              window.setTimeout(() => setState('Bogført'), 1200);
            }}
          >
            <RefreshCw />
            Bogfør igen
          </Button>
        ) : (
          <Button size="icon-sm" variant="ghost" aria-label={`Åbn ${order.id}`}>
            <ArrowUpRight />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function Invoices({ onGenerated }: { onGenerated: () => void }) {
  const [selectedInvoice, setSelectedInvoice] = useState<(typeof orders)[number] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>({
    '#3841': 'Genereret',
    '#3840': 'Genereret',
    '#3839': 'Afventer',
    '#3838': 'Fejlet',
    '#3837': 'Genereret',
  });
  const generate = (id: string) => {
    setStatuses((current) => ({ ...current, [id]: 'Genererer…' }));
    window.setTimeout(() => {
      setStatuses((current) => ({ ...current, [id]: 'Genereret' }));
      onGenerated();
    }, 900);
  };
  const generateAll = () =>
    orders
      .filter((order) => statuses[order.id] !== 'Genereret')
      .forEach((order, index) =>
        window.setTimeout(() => generate(order.id), index * 160),
      );
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Ordrer · Dokumenter</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] md:text-[36px]">
            Fakturaer
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Generér og administrér en faktura for hver webshopordre.
          </p>
        </div>
        <Button className="h-10 rounded-xl px-4" onClick={generateAll}>
          <FileText />
          Generér alle manglende
        </Button>
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Fakturaer i september"
          value="21 fakturaer"
          note="18 er genereret"
          tone="lime"
        />
        <Stat
          label="Afventer generering"
          value="2 fakturaer"
          note="2.644,00 kr. i alt"
        />
        <Stat
          label="Kræver handling"
          value="1 faktura"
          note="Ordre #3838"
          tone="warn"
        />
      </div>
      <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b p-4">
          <div className="relative max-w-[320px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 bg-muted/50 pl-9"
              placeholder="Søg ordrenummer"
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/45">
              <TableHead className="pl-5">Ordrenummer</TableHead>
              <TableHead>Ordredato</TableHead>
              <TableHead className="text-right">Beløb DKK</TableHead>
              <TableHead>Fakturastatus</TableHead>
              <TableHead>
                <span className="sr-only">Handling</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => {
              const status = statuses[order.id];
              return (
                <TableRow
                  key={order.id}
                  className={status === 'Fejlet' ? 'bg-red-50/35' : ''}
                >
                  <TableCell className="pl-5 font-semibold text-[#8a6636]">
                    {order.id}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {order.date}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {order.amount}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        status === 'Fejlet' ? 'destructive' : 'secondary'
                      }
                      className={
                        status === 'Genereret'
                          ? 'badge-booked'
                          : 'badge-pending'
                      }
                    >
                      {status === 'Genereret' && <Check />}
                      {status}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {status === 'Genereret' ? (
                      <Button variant="ghost" size="sm" onClick={() => setSelectedInvoice(order)}>
                        <ArrowUpRight />
                        Åbn
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => generate(order.id)}
                        disabled={status === 'Genererer…'}
                      >
                        <FileText />
                        {status === 'Fejlet' ? 'Generér igen' : 'Generér'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
      {selectedInvoice && <InvoicePreview order={selectedInvoice} onClose={() => setSelectedInvoice(null)} />}
    </div>
  );
}

function InvoicePreview({ order, onClose }: { order: (typeof orders)[number]; onClose: () => void }) {
  const total = Number(order.amount.replaceAll('.', '').replace(',', '.'));
  const beforeVat = total / 1.25;
  const vat = total - beforeVat;
  const money = (value: number) => value.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <section className="mt-6 rounded-2xl border bg-[#eceae6] p-4 md:p-8"><div className="mb-4 flex items-center justify-between"><div><p className="eyebrow">Fakturaforhåndsvisning</p><p className="mt-1 text-sm text-muted-foreground">Skabelon baseret på det vedhæftede fakturaeksempel</p></div><Button variant="outline" onClick={onClose}>Luk</Button></div><article className="mx-auto min-h-[820px] max-w-[780px] bg-white px-10 py-12 shadow-[0_18px_50px_rgba(35,35,35,.12)] md:px-16"><div className="flex items-start justify-between"><address className="not-italic text-sm leading-6"><strong className="text-base">Emma Sofie Riis</strong><br />Tvedvej 155<br />6000 Kolding<br />Danmark</address><img src="/sablen-logo.webp" alt="Sablen" className="w-40" /></div><div className="mt-16 flex items-end justify-between"><div><h2 className="text-2xl">Faktura</h2><p className="mt-1 text-sm">Ordrenr. <strong>{order.id}</strong></p></div><div className="text-right text-sm leading-6"><p>Fakturanr. <strong>{order.id}</strong></p><p>Fakturadato: <strong>03/09/2026</strong></p></div></div><table className="mt-5 w-full text-sm"><thead><tr className="border-y-2 border-[#232b38]"><th className="py-2 text-left font-normal">Beskrivelse</th><th className="py-2 text-right font-normal">Antal</th><th className="py-2 text-right font-normal">Stk. pris</th><th className="py-2 text-right font-normal">Pris</th></tr></thead><tbody><tr><td className="py-3">Shopify-ordre {order.id}</td><td className="py-3 text-right">1</td><td className="py-3 text-right">{money(total)}</td><td className="py-3 text-right">{money(total)}</td></tr><tr className="border-b"><td className="pb-3">Levering</td><td className="pb-3 text-right">1</td><td className="pb-3 text-right">0,00</td><td className="pb-3 text-right">0,00</td></tr></tbody></table><div className="ml-auto mt-5 w-full max-w-[380px] text-sm"><div className="flex justify-between py-1"><span>Total ekskl. moms</span><span>{money(beforeVat)}</span></div><div className="flex justify-between py-1"><span>Moms</span><span>{money(vat)}</span></div><div className="mt-1 flex justify-between border-b-4 border-[#555f70] py-2 text-base font-bold"><span>Total inkl. moms DKK</span><span>{money(total)}</span></div></div><footer className="mt-[340px] border-t pt-4 text-center text-[11px] leading-5 text-slate-500"><p>LA Trading ApS / Egetoften 13 / 7500 Holstebro / Danmark</p><p>CVR-nr. 45036871 / Tlf. +45 2621 9318 / Web https://sablen.dk / E-mail kontakt@sablen.dk</p></footer></article></section>;
}

const payments = [
  {
    order: '#3841',
    captured: '2. sep. 2026, 09.44',
    provider: 'Shopify Payments',
    amount: '1.249,00',
    status: 'Bogført',
  },
  {
    order: '#3840',
    captured: '2. sep. 2026, 09.20',
    provider: 'Shopify Payments',
    amount: '698,00',
    status: 'Afventer',
  },
  {
    order: '#3838',
    captured: '1. sep. 2026, 16.32',
    provider: 'Shopify Payments',
    amount: '449,00',
    status: 'Fejlet',
  },
];
function Payments({ onBook }: { onBook: () => void }) {
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Shopify · Betalinger</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] md:text-[36px]">
            Betalinger
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Følg captured betalinger og deres bogføringsstatus.
          </p>
        </div>
        <Button className="h-10 rounded-xl px-4" onClick={onBook}>
          <BookOpenCheck />
          Bogfør alle
        </Button>
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Klar til bogføring"
          value="20.082,57 kr."
          note="3 udbetalinger"
          tone="lime"
        />
        <Stat
          label="Gebyrer denne måned"
          value="450,70 kr."
          note="2,2% af omsætning"
        />
        <Stat label="Difference" value="0,00 kr." note="Alt stemmer" />
      </div>
      <section className="overflow-hidden rounded-2xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/45">
              <TableHead className="pl-5">Ordrenummer</TableHead>
              <TableHead>Captured</TableHead>
              <TableHead>Betalingsudbyder</TableHead>
              <TableHead className="text-right">Beløb</TableHead>
              <TableHead>Bogføringsstatus</TableHead>
              <TableHead>
                <span className="sr-only">Handling</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <BookingTransactionRow
                key={payment.order}
                transaction={payment}
                onBook={onBook}
              />
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

const refunds = [
  {
    order: '#3840',
    captured: '2. sep. 2026, 13.14',
    amount: '– 349,00',
    provider: 'Shopify Payments',
    status: 'Bogført',
  },
  {
    order: '#3822',
    captured: '1. sep. 2026, 11.08',
    amount: '– 795,00',
    provider: 'Shopify Payments',
    status: 'Fejlet',
  },
  {
    order: '#3816',
    captured: '31. aug. 2026, 15.42',
    amount: '– 199,00',
    provider: 'Shopify Payments',
    status: 'Afventer',
  },
];
function Refunds({ onBook }: { onBook: () => void }) {
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <p className="eyebrow">Shopify · Dinero</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] md:text-[36px]">
            Tilbagebetalinger
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Følg refunderinger og deres bogføringsstatus.
          </p>
        </div>
        <Button className="h-10 rounded-xl px-4">
          <RefreshCw />
          Synkronisér nu
        </Button>
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Refunderet i september"
          value="1.144,00 kr."
          note="2 tilbagebetalinger"
          tone="lime"
        />
        <Stat
          label="Afventer realisering"
          value="1 tilbagebetaling"
          note="199,00 kr. i alt"
        />
        <Stat
          label="Kræver handling"
          value="1 tilbagebetaling"
          note="Tilbagebetaling #R-3822"
          tone="warn"
        />
      </div>
      <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b p-4">
          <div className="relative max-w-[320px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 bg-muted/50 pl-9"
              placeholder="Søg tilbagebetaling"
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/45">
              <TableHead className="pl-5">Ordrenummer</TableHead>
              <TableHead>Captured</TableHead>
              <TableHead>Betalingsudbyder</TableHead>
              <TableHead className="text-right">Beløb</TableHead>
              <TableHead>Bogføringsstatus</TableHead>
              <TableHead>
                <span className="sr-only">Handling</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {refunds.map((refund) => (
              <BookingTransactionRow
                key={refund.order}
                transaction={refund}
                onBook={onBook}
                accent
              />
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function BookingTransactionRow({
  transaction,
  onBook,
  accent = false,
}: {
  transaction: {
    order: string;
    captured: string;
    provider: string;
    amount: string;
    status: string;
  };
  onBook: () => void;
  accent?: boolean;
}) {
  const [status, setStatus] = useState(transaction.status);
  const book = () => {
    setStatus('Bogfører…');
    window.setTimeout(() => {
      setStatus('Bogført');
      onBook();
    }, 900);
  };
  return (
    <TableRow className={status === 'Fejlet' ? 'bg-red-50/35' : ''}>
      <TableCell
        className={`pl-5 font-semibold ${accent ? 'text-[#a84f40]' : 'text-[#8a6636]'}`}
      >
        {transaction.order}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {transaction.captured}
      </TableCell>
      <TableCell>{transaction.provider}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {transaction.amount}
      </TableCell>
      <TableCell>
        <Badge
          variant={status === 'Fejlet' ? 'destructive' : 'secondary'}
          className={status === 'Bogført' ? 'badge-booked' : 'badge-pending'}
        >
          {status === 'Bogført' && <BookOpenCheck />}
          {status}
        </Badge>
      </TableCell>
      <TableCell className="pr-5 text-right">
        {status !== 'Bogført' && (
          <Button
            size="sm"
            variant="outline"
            className={status === 'Fejlet' ? 'border-red-200 text-red-700' : ''}
            onClick={book}
            disabled={status === 'Bogfører…'}
          >
            <RefreshCw />
            {status === 'Fejlet' ? 'Bogfør igen' : 'Bogfør'}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

const payouts = [
  {
    acquirer: 'Shopify Payments',
    id: 'DK-PO-29831',
    date: '3. sep. 2026, 06.15',
    amount: '14.709,86',
    status: 'Bogført',
  },
  {
    acquirer: 'Shopify Payments',
    id: 'FP-904218',
    date: '2. sep. 2026, 23.58',
    amount: '5.372,71',
    status: 'Afventer',
  },
  {
    acquirer: 'Shopify Payments',
    id: 'VB-118402',
    date: '2. sep. 2026, 18.04',
    amount: '3.093,73',
    status: 'Fejlet',
  },
  {
    acquirer: 'Shopify Payments',
    id: 'DK-PO-29818',
    date: '1. sep. 2026, 06.12',
    amount: '8.461,20',
    status: 'Bogført',
  },
];

function Payouts({ onBook }: { onBook: () => void }) {
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Indløsere · Dinero</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] md:text-[36px]">
            Udbetalinger
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Følg udbetalinger fra betalingsudbyderne og deres bogføringsstatus.
          </p>
        </div>
        <Button className="h-10 rounded-xl px-4">
          <RefreshCw />
          Synkronisér nu
        </Button>
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Udbetalt i september"
          value="31.637,50 kr."
          note="4 udbetalinger"
          tone="lime"
        />
        <Stat
          label="Afventer bogføring"
          value="5.372,71 kr."
          note="1 udbetaling"
        />
        <Stat
          label="Kræver handling"
          value="3.093,73 kr."
          note="Udbetaling SP-118402"
          tone="warn"
        />
      </div>
      <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b p-4">
          <div className="relative max-w-[320px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 bg-muted/50 pl-9"
              placeholder="Søg udbetalings-id eller indløser"
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/45">
              <TableHead className="pl-5">Indløser</TableHead>
              <TableHead>Udbetalings-id</TableHead>
              <TableHead>Transaktionsdato</TableHead>
              <TableHead className="text-right">Beløb</TableHead>
              <TableHead>Bogføringsstatus</TableHead>
              <TableHead>
                <span className="sr-only">Handling</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.map((payout) => (
              <PayoutRow key={payout.id} payout={payout} onBook={onBook} />
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function PayoutRow({
  payout,
  onBook,
}: {
  payout: (typeof payouts)[number];
  onBook: () => void;
}) {
  const [status, setStatus] = useState(payout.status);
  const retry = () => {
    setStatus('Bogfører…');
    window.setTimeout(() => {
      setStatus('Bogført');
      onBook();
    }, 900);
  };
  return (
    <TableRow className={status === 'Fejlet' ? 'bg-red-50/35' : ''}>
      <TableCell className="pl-5 font-medium">{payout.acquirer}</TableCell>
      <TableCell className="font-semibold text-[#8a6636]">
        {payout.id}
      </TableCell>
      <TableCell className="text-muted-foreground">{payout.date}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {payout.amount}
      </TableCell>
      <TableCell>
        <Badge
          variant={status === 'Fejlet' ? 'destructive' : 'secondary'}
          className={status === 'Bogført' ? 'badge-booked' : 'badge-pending'}
        >
          {status === 'Bogført' && <BookOpenCheck />}
          {status}
        </Badge>
      </TableCell>
      <TableCell className="pr-5 text-right">
        {status === 'Fejlet' && (
          <Button
            size="sm"
            variant="outline"
            className="border-red-200 text-red-700"
            onClick={retry}
            disabled={status === 'Bogfører…'}
          >
            <RefreshCw />
            Bogfør igen
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

type Accounts = {
  vatCode: string;
  noVatCode: string;
  goodsVat: string;
  goodsNoVat: string;
  shippingVat: string;
  shippingNoVat: string;
  servicesVat: string;
  servicesNoVat: string;
  refundGoodsVat: string;
  refundGoodsNoVat: string;
  refundShippingVat: string;
  refundShippingNoVat: string;
  refundServicesVat: string;
  refundServicesNoVat: string;
  fees: string;
  clearing: string;
  start: string;
};
function Settings({
  accounts,
  setAccounts,
  onSave,
}: {
  accounts: Accounts;
  setAccounts: React.Dispatch<React.SetStateAction<Accounts>>;
  onSave: () => void;
}) {
  const [chart, setChart] = useState<
    Array<{ number: string; name: string; vatCode?: string }>
  >([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartMessage, setChartMessage] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [connecting, setConnecting] = useState<'shopify' | 'dinero' | null>(null);
  const [expandedIntegration, setExpandedIntegration] = useState<'shopify' | 'dinero' | null>(null);
  const [connected, setConnected] = useState<Record<string, string>>({});
  const [shopify, setShopify] = useState({ shop: '', clientId: '', clientSecret: '' });
  const [dinero, setDinero] = useState({ clientId: '', clientSecret: '', apiKey: '', organizationId: '' });
  const [automation, setAutomation] = useState({
    attachments: true,
    sales: true,
    payments: true,
    refunds: true,
    payouts: true,
  });
  useEffect(() => {
    const saved = localStorage.getItem('sablen-integrationshub-automation');
    if (saved)
      setAutomation((current) => ({ ...current, ...JSON.parse(saved) }));
    fetch('/api/integrations')
      .then((response) => response.json())
      .then((data) => setConnected(Object.fromEntries((data.integrations ?? []).map((item: { provider: string; display_name: string }) => [item.provider, item.display_name]))))
      .catch(() => setConnectionMessage('Forbindelsesstatus kunne ikke hentes'));
  }, []);
  const toggleAutomation = (key: keyof typeof automation, value: boolean) => {
    const next = { ...automation, [key]: value };
    setAutomation(next);
    localStorage.setItem(
      'sablen-integrationshub-automation',
      JSON.stringify(next),
    );
  };
  const integrations = [
    {
      name: 'Shopify',
      provider: 'shopify' as const,
      detail: 'Ordrer og refunderinger',
      icon: ShoppingBag,
      connected: Boolean(connected.shopify),
    },
    {
      name: 'Dinero',
      provider: 'dinero' as const,
      detail: 'Regnskab og bilag',
      icon: Landmark,
      connected: Boolean(connected.dinero),
    },
  ];
  const connect = async (provider: 'shopify' | 'dinero') => {
    setConnecting(provider);
    setConnectionMessage('');
    try {
      const response = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...(provider === 'shopify' ? shopify : dinero) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConnected((current) => ({ ...current, [provider]: data.name }));
      if (provider === 'shopify') setShopify((current) => ({ ...current, clientSecret: '' }));
      else setDinero((current) => ({ ...current, clientSecret: '', apiKey: '' }));
      setConnectionMessage(`${provider === 'shopify' ? 'Shopify' : 'Dinero'} er testet og forbundet med læseadgang`);
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : 'Forbindelsen kunne ikke oprettes');
    } finally {
      setConnecting(null);
    }
  };
  const loadChart = async () => {
    setLoadingChart(true);
    setChartMessage('');
    try {
      const response = await fetch('/api/dinero/accounts');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setChart(data.accounts);
      setChartMessage(`${data.accounts.length} konti hentet fra Dinero`);
    } catch (error) {
      setChartMessage(
        error instanceof Error
          ? `${error.message}. Forbind Dinero for at hente reelle konti.`
          : 'Kontoplanen kunne ikke hentes',
      );
    } finally {
      setLoadingChart(false);
    }
  };
  const Field = ({ name, label }: { name: keyof Accounts; label: string }) => (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {chart.length && name !== 'start' ? (
        <NativeSelect
          className="mt-1.5 w-full"
          value={accounts[name]}
          onChange={(e) =>
            setAccounts((a) => ({ ...a, [name]: e.target.value }))
          }
        >
          <NativeSelectOption value={accounts[name]}>
            {accounts[name]}
          </NativeSelectOption>
          {chart.map((item) => (
            <NativeSelectOption
              key={`${name}-${item.number}`}
              value={`${item.number} - ${item.name}`}
            >
              {item.number} - {item.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <div className="relative mt-1.5">
          <Input
            className="h-11 pr-9"
            value={accounts[name]}
            onChange={(e) =>
              setAccounts((a) => ({ ...a, [name]: e.target.value }))
            }
            readOnly={name !== 'start'}
          />
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#c09960]" />
        </div>
      )}
    </label>
  );
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7">
        <p className="eyebrow">Opsætning</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] md:text-[36px]">
          Administration
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Forbind dine systemer, og bestem hvordan posteringerne skal lande i
          Dinero.
        </p>
      </div>
      {chartMessage && !chart.length && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Der kræves handling</p>
            <p className="mt-1 text-xs">{chartMessage}</p>
          </div>
        </div>
      )}
      <h2 className="mb-3 text-sm font-semibold">Drift og sikkerhed</h2>
      <div className="mb-8 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border bg-white p-4">
          <ShieldCheck className="size-5 text-[#6a8d31]" />
          <p className="mt-3 text-sm font-semibold">Privat adgang</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Kun godkendte brugere kan åbne integrationshubben.
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <Database className="size-5 text-[#6a8d31]" />
          <p className="mt-3 text-sm font-semibold">24 måneders historik</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ordrer og bogføringsdata slettes automatisk efter 24 måneder.
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <ShoppingBag className="size-5 text-[#6a8d31]" />
          <p className="mt-3 text-sm font-semibold">Kun Sablen.dk</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Produktionsskrivninger aktiveres først efter en kontrolleret læsetest.
          </p>
        </div>
      </div>
      <h2 className="mb-3 text-sm font-semibold">Integrationer</h2>
      <div className="mb-8 grid items-start gap-3 md:grid-cols-2">
        {integrations.map(({ name, provider, detail, icon: Icon, connected: isConnected }) => (
          <div
            key={name}
            className="overflow-hidden rounded-2xl border bg-white"
          >
            <button
              type="button"
              className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/30"
              onClick={() => setExpandedIntegration((current) => current === provider ? null : provider)}
              aria-expanded={expandedIntegration === provider}
              aria-controls={`${provider}-connection-panel`}
            >
              <span className="grid size-11 place-items-center rounded-xl bg-muted"><Icon className="size-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">{name}</span><span className="block text-xs text-muted-foreground">{detail}</span></span>
              <Badge className={isConnected ? 'badge-booked' : ''} variant="secondary">{isConnected ? 'Forbundet' : 'Ikke forbundet'}</Badge>
              <ChevronDown className={`size-4 text-muted-foreground transition-transform ${expandedIntegration === provider ? 'rotate-180' : ''}`} />
            </button>
            {expandedIntegration === provider && (
              <div id={`${provider}-connection-panel`} className="border-t bg-muted/20 p-5">
                <p className="mb-4 text-xs text-muted-foreground">{provider === 'shopify' ? 'Den installerede app udveksler automatisk oplysningerne til et kortlivet adgangstoken. Testen læser kun butikkens navn.' : 'Personlig integration med læsetest.'}</p>
                {provider === 'shopify' ? (
                  <div className="space-y-3">
                    <Input value={shopify.shop} onChange={(event) => setShopify((current) => ({ ...current, shop: event.target.value }))} placeholder="butik.myshopify.com" aria-label="Shopify butiksadresse" />
                    <Input value={shopify.clientId} onChange={(event) => setShopify((current) => ({ ...current, clientId: event.target.value }))} placeholder="Client ID" aria-label="Shopify Client ID" />
                    <Input type="password" autoComplete="off" value={shopify.clientSecret} onChange={(event) => setShopify((current) => ({ ...current, clientSecret: event.target.value }))} placeholder="Client Secret" aria-label="Shopify Client Secret" />
                    <Button className="w-full" onClick={() => connect('shopify')} disabled={connecting !== null}>{connecting === 'shopify' ? 'Tester…' : isConnected ? 'Test og opdatér forbindelse' : 'Test og forbind'}</Button>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input value={dinero.clientId} onChange={(event) => setDinero((current) => ({ ...current, clientId: event.target.value }))} placeholder="Client ID" aria-label="Dinero Client ID" />
                    <Input type="password" autoComplete="off" value={dinero.clientSecret} onChange={(event) => setDinero((current) => ({ ...current, clientSecret: event.target.value }))} placeholder="Client secret" aria-label="Dinero Client secret" />
                    <Input type="password" autoComplete="off" value={dinero.apiKey} onChange={(event) => setDinero((current) => ({ ...current, apiKey: event.target.value }))} placeholder="API-nøgle" aria-label="Dinero API-nøgle" />
                    <Input value={dinero.organizationId} onChange={(event) => setDinero((current) => ({ ...current, organizationId: event.target.value }))} placeholder="Organisation-ID" aria-label="Dinero organisation-ID" />
                    <Button className="sm:col-span-2" onClick={() => connect('dinero')} disabled={connecting !== null}>{connecting === 'dinero' ? 'Tester…' : isConnected ? 'Test og opdatér forbindelse' : 'Test og forbind'}</Button>
                  </div>
                )}
                {connectionMessage && <p className="mt-3 text-sm text-[#5d712f]" role="status">{connectionMessage}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
      <h2 className="mb-3 text-sm font-semibold">Automatik og bilag</h2>
      <section className="mb-8 overflow-hidden rounded-2xl border bg-white">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <p className="text-sm font-semibold">
              Upload bilag til regnskabsprogram
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Vedhæft automatisk faktura eller dokumentation til posteringen i
              Dinero.
            </p>
          </div>
          <Switch
            checked={automation.attachments}
            onCheckedChange={(value) => toggleAutomation('attachments', value)}
            aria-label="Upload bilag til regnskabsprogram"
          />
        </div>
        <div className="p-5">
          <p className="mb-4 text-sm font-semibold">Automatiske moduler</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                key: 'sales',
                label: 'Salg',
                description: 'Bogfør realiserede ordrer',
              },
              {
                key: 'payments',
                label: 'Betalinger',
                description: 'Bogfør captured betalinger',
              },
              {
                key: 'refunds',
                label: 'Tilbagebetalinger',
                description: 'Bogfør gennemførte refunderinger',
              },
              {
                key: 'payouts',
                label: 'Udbetalinger',
                description: 'Bogfør udbetalinger fra indløsere',
              },
            ].map((module) => (
              <div
                key={module.key}
                className="flex items-center justify-between rounded-xl border bg-muted/30 p-4"
              >
                <div>
                  <p className="text-sm font-medium">{module.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {module.description}
                  </p>
                </div>
                <Switch
                  checked={automation[module.key as keyof typeof automation]}
                  onCheckedChange={(value) =>
                    toggleAutomation(
                      module.key as keyof typeof automation,
                      value,
                    )
                  }
                  aria-label={`Automatisk ${module.label}`}
                />
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="rounded-2xl border bg-white">
        <div className="border-b p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[#f4eadb]">
              <Landmark className="size-5 text-[#9a7440]" />
            </span>
            <div className="flex-1">
              <h2 className="font-semibold">
                Dinero-kontoplan · Indland og EU
              </h2>
              <p className="text-xs text-muted-foreground">
                Konti bruges, når ordrer, fragt og refunderinger bogføres.
              </p>
            </div>
            <Button
              variant="outline"
              className="h-10"
              onClick={loadChart}
              disabled={loadingChart}
            >
              <ArrowDownToLine />
              {loadingChart ? 'Henter…' : 'Hent kontoplan'}
            </Button>
          </div>
          {chartMessage && (
            <p
              className={`mt-3 text-xs ${chart.length ? 'text-emerald-700' : 'text-amber-700'}`}
            >
              {chartMessage}
            </p>
          )}
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2 grid gap-5 sm:grid-cols-2">
            <Field name="vatCode" label="Momskode for salg m/moms" />
            <Field name="noVatCode" label="Momskode for salg u/moms" />
          </div>
          <div>
            <h3 className="mb-3 border-b pb-3 font-medium text-[#c06452]">
              Kontoplan for salg
            </h3>
            <div className="space-y-4">
              <Field name="goodsVat" label="Salg af varer m/moms" />
              <Field name="goodsNoVat" label="Salg af varer u/moms" />
              <Field name="shippingVat" label="Salg af fragt m/moms" />
              <Field name="shippingNoVat" label="Salg af fragt u/moms" />
              <Field name="servicesVat" label="Salg af ydelser m/moms" />
              <Field name="servicesNoVat" label="Salg af ydelser u/moms" />
            </div>
          </div>
          <div>
            <h3 className="mb-3 border-b pb-3 font-medium text-[#c06452]">
              Kontoplan for refundering
            </h3>
            <div className="space-y-4">
              <Field
                name="refundGoodsVat"
                label="Refundering af varer m/moms"
              />
              <Field
                name="refundGoodsNoVat"
                label="Refundering af varer u/moms"
              />
              <Field
                name="refundShippingVat"
                label="Refundering af fragt m/moms"
              />
              <Field
                name="refundShippingNoVat"
                label="Refundering af fragt u/moms"
              />
              <Field
                name="refundServicesVat"
                label="Refundering af ydelser m/moms"
              />
              <Field
                name="refundServicesNoVat"
                label="Refundering af ydelser u/moms"
              />
            </div>
          </div>
          <Field name="fees" label="Gebyrkonto" />
          <Field name="clearing" label="Mellemregningskonto" />
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              Integrationen starter fra
            </span>
            <Input
              type="date"
              className="mt-1.5 h-11"
              value={accounts.start}
              onChange={(e) =>
                setAccounts((a) => ({ ...a, start: e.target.value }))
              }
            />
          </label>
          <div className="flex items-center justify-between rounded-xl bg-muted/65 p-4">
            <div>
              <p className="text-sm font-medium">Automatisk bogføring</p>
              <p className="text-xs text-muted-foreground">
                Bogfør realiserede ordrer løbende
              </p>
            </div>
            <Switch defaultChecked aria-label="Automatisk bogføring" />
          </div>
        </div>
        <div className="flex justify-end border-t p-4">
          <Button className="h-10 rounded-xl px-4" onClick={onSave}>
            <Save />
            Gem indstillinger
          </Button>
        </div>
      </section>
    </div>
  );
}
