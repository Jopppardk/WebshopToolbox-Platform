'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpenCheck,
  Check,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  Landmark,
  LayoutDashboard,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShoppingBag,
  SlidersHorizontal,
  WalletCards,
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
    'orders' | 'refunds' | 'payments' | 'settings'
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
          <p className="nav-label mt-7">System</p>
          <button
            className={`nav-item w-full ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            <Settings2 />
            Administration
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
        {view === 'refunds' && (
          <Refunds
            onBook={() => notify('Tilbagebetalingen er sendt til bogføring')}
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

const payments = [
  {
    date: '2. sep. 2026',
    provider: 'Shopify Payments',
    reference: 'Payout #DK29831',
    count: 18,
    gross: '14.982,00',
    fees: '– 272,14',
    net: '14.709,86',
    status: 'Klar',
  },
  {
    date: '1. sep. 2026',
    provider: 'Flatpay',
    reference: 'FP-904218',
    count: 7,
    gross: '5.449,00',
    fees: '– 76,29',
    net: '5.372,71',
    status: 'Klar',
  },
  {
    date: '31. aug. 2026',
    provider: 'ViaBill',
    reference: 'VB-118402',
    count: 4,
    gross: '3.196,00',
    fees: '– 102,27',
    net: '3.093,73',
    status: 'Bogført',
  },
];
function Payments({ onBook }: { onBook: () => void }) {
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Afstemning · Udbetalinger</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] md:text-[36px]">
            Betalinger
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Afstem gebyrer og bogfør udbetalinger fra dine betalingsudbydere.
          </p>
        </div>
        <Button className="h-10 rounded-xl px-4" onClick={onBook}>
          <BookOpenCheck />
          Bogfør 3 betalinger
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
              <TableHead className="pl-5">Udbetalingsdato</TableHead>
              <TableHead>Udbyder</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Transaktioner</TableHead>
              <TableHead className="text-right">Brutto</TableHead>
              <TableHead className="text-right">Gebyrer</TableHead>
              <TableHead className="text-right">Netto DKK</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.reference}>
                <TableCell className="pl-5">{p.date}</TableCell>
                <TableCell className="font-medium">{p.provider}</TableCell>
                <TableCell className="text-muted-foreground">
                  {p.reference}
                </TableCell>
                <TableCell>{p.count}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.gross}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {p.fees}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {p.net}
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      p.status === 'Bogført' ? 'badge-booked' : 'badge-pending'
                    }
                    variant="secondary"
                  >
                    {p.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

const refunds = [
  {
    id: '#R-3840',
    order: '#3840',
    date: '2. sep. 2026, 13.14',
    amount: '– 349,00',
    method: 'Shopify Payments',
    realized: '2. sep. 2026',
    status: 'Bogført',
  },
  {
    id: '#R-3822',
    order: '#3822',
    date: '1. sep. 2026, 11.08',
    amount: '– 795,00',
    method: 'ViaBill',
    realized: '1. sep. 2026',
    status: 'Fejlet',
  },
  {
    id: '#R-3816',
    order: '#3816',
    date: '31. aug. 2026, 15.42',
    amount: '– 199,00',
    method: 'Flatpay',
    realized: '—',
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
          note="ViaBill · #R-3822"
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
              <TableHead className="pl-5">Refundering</TableHead>
              <TableHead>Ordre</TableHead>
              <TableHead>Dato</TableHead>
              <TableHead>Betalingsmetode</TableHead>
              <TableHead className="text-right">Beløb DKK</TableHead>
              <TableHead>Realiseret</TableHead>
              <TableHead>Bogføring</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {refunds.map((r) => (
              <TableRow
                key={r.id}
                className={r.status === 'Fejlet' ? 'bg-red-50/35' : ''}
              >
                <TableCell className="pl-5 font-semibold text-[#a84f40]">
                  {r.id}
                </TableCell>
                <TableCell>{r.order}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.date}
                </TableCell>
                <TableCell>{r.method}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {r.amount}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.realized}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      r.status === 'Fejlet' ? 'destructive' : 'secondary'
                    }
                    className={
                      r.status === 'Bogført'
                        ? 'badge-booked'
                        : r.status === 'Afventer'
                          ? 'badge-pending'
                          : ''
                    }
                  >
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell className="pr-5 text-right">
                  {r.status === 'Fejlet' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-200 text-red-700"
                      onClick={onBook}
                    >
                      <RefreshCw />
                      Bogfør igen
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
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
  const integrations = [
    {
      name: 'Shopify',
      detail: 'Ordrer og refunderinger',
      icon: ShoppingBag,
      connected: true,
    },
    {
      name: 'Dinero',
      detail: 'Regnskab og bilag',
      icon: Landmark,
      connected: true,
    },
    {
      name: 'Flatpay',
      detail: 'Kortbetalinger og gebyrer',
      icon: CreditCard,
      connected: true,
    },
    {
      name: 'ViaBill',
      detail: 'Delbetalinger og afstemning',
      icon: WalletCards,
      connected: false,
    },
  ];
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
      <h2 className="mb-3 text-sm font-semibold">Integrationer</h2>
      <div className="mb-8 grid gap-3 md:grid-cols-2">
        {integrations.map(({ name, detail, icon: Icon, connected }) => (
          <div
            key={name}
            className="flex items-center gap-4 rounded-2xl border bg-white p-4"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-muted">
              <Icon className="size-5" />
            </span>
            <div className="flex-1">
              <p className="font-semibold">{name}</p>
              <p className="text-xs text-muted-foreground">{detail}</p>
            </div>
            <Badge
              className={connected ? 'badge-booked' : ''}
              variant="secondary"
            >
              {connected ? 'Forbundet' : 'Ikke forbundet'}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Indstil ${name}`}
            >
              <ArrowUpRight />
            </Button>
          </div>
        ))}
      </div>
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
