'use client';
import { formatDateTime } from '@/lib/format';
import {useCapabilities} from '@/platform/capabilities';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import { ProviderLedger } from '@/components/provider-ledger';
import {IntegrationStartDate} from '@/components/integration-start-date';
import { IntegrationLibrary, RemoveIntegration, useIntegrationLibrary } from '@/components/integration-library';
import { IntegrationCard } from '@/components/integration-card';
import { FlatpayConnection } from '@/components/flatpay-connection';
import { EmballageConnection } from '@/components/emballage-connection';
import { ViaBillConnection } from '@/components/viabill-connection';
import { PensopayConnection } from '@/components/pensopay-connection';
import { HistorySettings } from '@/components/history-settings';
import { OrderLog } from '@/components/order-log';
import { SalesPreview } from '@/components/sales-preview';
import { ManualBookingAction } from '@/components/manual-booking-action';
import { InvoiceSender } from '@/components/invoice-sender';
import { InvoiceIssuer } from '@/components/invoice-issuer';
import { Documents } from '@/components/documents';
import { Inventory } from '@/components/inventory';
import { NotificationBell } from '@/components/notification-bell';
import { Packaging } from '@/components/packaging';
import { Dashboard } from '@/components/dashboard';
import {ProductFeeds} from '@/components/product-feeds';
import { Performance } from '@/components/performance';
import {IntegrationRequired} from '@/components/integration-required';
import {Rss} from 'lucide-react';
import { Support } from '@/platform/support';
import { CustomerIdentity, WebshopSelector } from '@/platform/workspace';
import { vatCodeOptions } from '@/lib/vat-code-options';
import { emptyAccounts, defaultAutomation, defaultInvoiceEmail, validateSettings, type Accounts, type Automation, type AdminSettings, type InvoiceEmailSettings } from '@/lib/admin-settings';
import { orderPeriods, type OrderPeriod } from '@/lib/order-period';
import {hasRequiredIntegration,integrationRequirements,supportedModules,type IntegrationGatedView} from '@/lib/integration-visibility';
import { useSyncStatus } from '@/components/sync-status';
import { syncIntervals } from '@/lib/sync-schedule';
import { processedSummary } from '@/lib/order-processing';
import { CountryFlag, countryName } from '@/components/country-flag';
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { useEffect, useState } from 'react';
import { Payments } from '@/components/payments';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  AlertTriangle,
  BookOpenCheck,
  LayoutDashboard,
  Boxes,
  Check,
  ChevronDown,
  FileText,
  HandCoins,
  Lightbulb,
  Landmark,
  Menu,
  Mail,
  PackageCheck,
  Warehouse,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShoppingBag,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

type OrderView = {
  id: string; date: string; shipped: string; amount: string; realized: string; status: string;
  externalId?: string; createdAt?: string; currency?: string; total?: string;
  customer?: { name?: string | null; address1?: string | null; address2?: string | null; zip?: string | null; city?: string | null; country?: string | null } | null;
  lines?: Array<{ name: string; quantity: number; discountedTotalSet: { shopMoney: { amount: string; currencyCode: string } } }>;
  shippingLines?: Array<{ title: string; discountedPriceSet: { shopMoney: { amount: string; currencyCode: string } } }>;
  paymentProvider?: string; subtotal?: string; tax?: string; paymentStatus?: string | null;
  country?: string | null; customerCurrency?: string | null; customerTotal?: string | null;
};

export default function Home() {
  const syncState = useSyncStatus();
  const [connections,setConnections]=useState<Set<string>|null>(null);
  const [connectionsError,setConnectionsError]=useState('');
  const refreshConnections=async()=>{
    try {
      const response=await fetch('/api/integrations',{cache:'no-store'});
      const data=await response.json() as {integrations?:Array<{provider:string}>;error?:string};
      if(!response.ok || !Array.isArray(data.integrations))throw new Error(data.error || 'Forbindelsesstatus kunne ikke hentes.');
      setConnections(new Set(data.integrations.map(item=>item.provider)));
      setConnectionsError('');
    } catch(error) {
      setConnectionsError(error instanceof Error?error.message:'Forbindelsesstatus kunne ikke hentes.');
    }
  };
  useEffect(()=>{void refreshConnections();},[]);
  const [query, setQuery] = useState('');
  const [salesOrders, setSalesOrders] = useState<OrderView[]>([]);
  const [ordersToday, setOrdersToday] = useState<number | null>(null);
  const [orderPeriod, setOrderPeriod] = useState<OrderPeriod>('all');
  const [orderCountry, setOrderCountry] = useState(''), [orderCountries, setOrderCountries] = useState<string[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderOffset, setOrderOffset] = useState(0);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderRevision, setOrderRevision] = useState(0);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [packagingEntry,setPackagingEntry]=useState({tab:'consumption' as 'consumption'|'reporting',key:0});
  const [view, setView] = useState<
    'dashboard' | 'orders' | 'invoices' | 'documents' | 'refunds' | 'payouts' | 'inventory' | 'packaging' | 'support' | 'feeds' | 'performance' | 'settings'
  >('dashboard');
  useEffect(() => {
    if (sessionStorage.getItem('toolbox-refresh-sales') === '1') {
      sessionStorage.removeItem('toolbox-refresh-sales');
      setView('orders');
    }
  }, []);
  const [integrationTarget,setIntegrationTarget]=useState<'shopify'|'dinero'|'emballage'|null>(null);
  const [settingsTab, setSettingsTab] = useState<'dashboard' | 'integrations' | 'invoice-email' | 'inventory'>('dashboard');
  const [notice, setNotice] = useState('');
  const [accounts, setAccounts] = useState<Accounts>(emptyAccounts);
  const [automation, setAutomation] = useState<Automation>(defaultAutomation);
  const [invoiceEmail, setInvoiceEmail] = useState<InvoiceEmailSettings>(defaultInvoiceEmail);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(15);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [orderError, setOrderError] = useState('');
  useEffect(() => {
    fetch('/api/admin/settings').then(async response => {
      const data = await response.json() as { settings: AdminSettings | null; revision: string | null; error?: string };
      if (!response.ok) throw new Error(data.error);
      if (data.settings) { setAccounts(data.settings.accounts); setAutomation(data.settings.automation); setInvoiceEmail(data.settings.invoiceEmail); setSyncIntervalMinutes(data.settings.syncIntervalMinutes); }
      setSettingsRevision(data.revision); setSettingsReady(true);
    }).catch(error => setSettingsMessage(error.message || 'Indstillinger kunne ikke indlæses. Genindlæs siden.'));
  }, []);
  const orderPageSize = 25;
  const activePeriod = view === 'invoices' ? 'all' : orderPeriod;
  const filtered = salesOrders.filter(
    (order) =>
      order.id.includes(query) ||
      order.status.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    if(connections===null || !connections.has('shopify') || (view!=='orders' && view!=='invoices'))return;
    const controller = new AbortController();
    setOrdersLoading(true);
    fetch(`/api/shopify/orders?offset=${orderOffset}&limit=${orderPageSize}&period=${activePeriod}${view === 'orders' && orderCountry ? '&country=' + orderCountry : ''}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const data = await response.json() as { orders: OrderView[]; total: number; today?: number; countries?: string[]; error?: string }; if (!response.ok) throw new Error(data.error || 'Ordrer kunne ikke indlæses'); return data; })
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data.orders)) { if (orderOffset > 0 && orderOffset >= data.total) { setOrderOffset(Math.max(0, Math.ceil(data.total / orderPageSize) - 1) * orderPageSize); return; } setSalesOrders(data.orders); setOrderTotal(data.total || 0); setOrderCountries(data.countries || []); setOrdersToday(data.today ?? null); setOrderError(''); }
      })
      .catch(error => { if (!controller.signal.aborted) setOrderError(error.message || 'Ordrer kunne ikke indlæses'); })
      .finally(() => { if (!controller.signal.aborted) setOrdersLoading(false); });
    return () => controller.abort();
  }, [connections, orderOffset, orderRevision, syncState.revision, view, activePeriod, orderPageSize, orderCountry]);
  const syncOrders = async () => {
    setSyncingOrders(true);
    try {
      let after: string | null = null; let synced = 0; let invoices = 0; let warnings = 0; let historyWarning = ''; const seen = new Set<string>();
      do {
        const response: Response = await fetch('/api/shopify/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ after }) });
        const data: { orders: OrderView[]; synced: number; invoicesCreated: number; invoiceWarnings?: string[]; warning?: string; hasNextPage: boolean; endCursor: string | null; error?: string } = await response.json();
        if (!response.ok) throw new Error(data.error);
        synced += data.synced; invoices += data.invoicesCreated || 0; if (data.warning) historyWarning = data.warning;
        warnings += data.invoiceWarnings?.length || 0;
        after = data.hasNextPage ? data.endCursor : null;
        if (data.hasNextPage && (!after || seen.has(after) || seen.size >= 200)) throw new Error("Hentningen blev stoppet ved en ugyldig fortsættelse. Allerede hentede ordrer er bevaret.");
        if (after) seen.add(after);
        notify(`${synced} Shopify-ordrer hentet · ${invoices} PDF-fakturaer${warnings ? ` · ${warnings} fakturaer kræver kontrol under Indstillinger` : ''}${after ? ' · henter flere…' : ''}${historyWarning ? ` · ${historyWarning}` : ''}`);
      } while (after);
      // Afsendte ordrer faktureres, sendes og bogføres med det samme, hvis automatikken er slået til.
      notify(`${synced} Shopify-ordrer hentet · behandler afsendte ordrer…`);
      const fetched = `${synced} Shopify-ordrer hentet${historyWarning ? ` · ${historyWarning}` : ''}`;
      try {
        const response = await fetch('/api/shopify/orders/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const result: { status: string; invoices?: number; sent?: number; booked?: number; drafts?: number; failed?: number; error?: string } = await response.json();
        if (!response.ok) throw new Error(result.error);
        notify(`${fetched} · ${processedSummary(result)}`);
      } catch (error) {
        notify(`${fetched} · ${error instanceof Error && error.message ? error.message : 'Afsendte ordrer kunne ikke behandles nu. De behandles ved næste automatiske kørsel.'}`);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Shopify-ordrer kunne ikke synkroniseres');
    } finally {
      setSyncingOrders(false);
      setOrderOffset(0); setOrderRevision(value => value + 1);
    }
  };
  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  };
  const currentRequirement=view in integrationRequirements?integrationRequirements[view as IntegrationGatedView]:null;
  const integrationAvailable=(target:typeof view)=>{
    if(!(target in integrationRequirements))return true;
    return Boolean(connections && hasRequiredIntegration(target as IntegrationGatedView,connections));
  };
  const saveSettings = async () => {
    setSettingsSaving(true); setSettingsMessage('');
    try {
      const response = await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { accounts, automation, invoiceEmail, syncIntervalMinutes }, revision: settingsRevision }) });
      const data = await response.json() as { revision: string; error?: string; message?: string };
      if (!response.ok) throw new Error(data.error);
      setSettingsRevision(data.revision); setSettingsMessage(data.message || 'Indstillingerne er gemt.'); void syncState.refresh();
    } catch (error) { setSettingsMessage(error instanceof Error ? error.message : 'Kunne ikke gemme'); }
    finally { setSettingsSaving(false); }
  };
  const orderPagination = <nav aria-label="Ordrehistorik" className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 text-sm"><span>{ordersLoading ? 'Henter ordrer…' : orderTotal ? `${orderOffset + 1}–${Math.min(orderOffset + orderPageSize, orderTotal)} af ${orderTotal} ordrer · Side ${Math.floor(orderOffset / orderPageSize) + 1} af ${Math.max(1, Math.ceil(orderTotal / orderPageSize))}` : 'Ingen ordrer i perioden'}</span><div className="flex gap-2"><Button variant="outline" disabled={syncingOrders || ordersLoading || orderOffset === 0} onClick={() => setOrderOffset(value => Math.max(0, value - orderPageSize))}>Forrige</Button><Button variant="outline" disabled={syncingOrders || ordersLoading || orderOffset + orderPageSize >= orderTotal} onClick={() => setOrderOffset(value => value + orderPageSize)}>Næste</Button></div></nav>;
  return (
    <main className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[246px_1fr]">
      <aside className="sidebar-shell hidden min-h-screen flex-col lg:flex">
        <div className="flex h-24 items-center px-6">
          <img
            src="/brand/webshoptoolbox-logo.png"
            alt="WebshopToolbox"
            className="h-auto w-[136px]"
          />
        </div>
        <nav className="flex-1 px-3 py-4" aria-label="Primær navigation">
          <button className={`nav-item w-full ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('dashboard'); }}><LayoutDashboard/>Dashboard</button>
          <p className="nav-label mt-7">Bogføring</p>
          <button
            className={`nav-item w-full ${view === 'orders' ? 'active' : ''}`}
            onClick={() => { setOrderOffset(0); setView('orders'); }}
          >
            <PackageCheck />
            Salg
          </button>
          <button
            className={`nav-item w-full ${view === 'refunds' ? 'active' : ''}`}
            onClick={() => setView('refunds')}
          >
            <RotateCcw />
            Tilbagebetalinger
          </button>
          <button
            className={`nav-item w-full ${view === 'payouts' ? 'active' : ''}`}
            onClick={() => setView('payouts')}
          >
            <HandCoins />
            Udbetalinger
          </button>
          <button className={`nav-item w-full ${view === 'inventory' ? 'active' : ''}`} onClick={() => setView('inventory')}><Warehouse />Lager</button>
          <p className="nav-label mt-7">Dokumenter</p>
          <button
            className={`nav-item w-full ${view === 'invoices' ? 'active' : ''}`}
            onClick={() => { setOrderOffset(0); setView('invoices'); }}
          >
            <FileText />
            Fakturaer
          </button>
          <button className={`nav-item w-full ${view === 'documents' ? 'active' : ''}`} onClick={() => setView('documents')}><BookOpenCheck />Udbetalingsrapporter</button>
          <p className="nav-label mt-7">Tools</p>
          <button className={`nav-item w-full ${view === 'performance' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('performance'); }}><Activity />Performance</button>
          <button className={`nav-item w-full ${view === 'packaging' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('packaging'); }}><Boxes />Emballage</button>
          <button className={`nav-item w-full ${view === 'feeds' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('feeds'); }}><Rss />Produktfeeds</button>
          <p className="nav-label mt-7">System</p>
          <button className={`nav-item w-full ${view === 'support' ? 'active' : ''}`} onClick={() => setView('support')}><Lightbulb />Support</button>
          <button
            className={`nav-item w-full ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            <Settings2 />
            Indstillinger
          </button>
        </nav>
        <div className="mx-4 mb-3 overflow-hidden rounded-xl border border-white/10 bg-black/30 shadow-lg">
          <img src="/brand/webshoptoolbox-logo.png" alt="WebshopToolbox" className="h-auto w-full" />
        </div>
      </aside>
      <section className="min-w-0">
        <header className="flex h-20 items-center justify-between border-b border-border bg-white px-5 md:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger render={<Button variant="outline" size="icon" aria-label="Åbn menu" />}><Menu /></SheetTrigger>
              <SheetContent side="left" className="sidebar-shell overflow-y-auto p-4" showCloseButton={false}>
                <div className="flex items-center justify-between"><SheetTitle className="text-white">Menu</SheetTitle><Button variant="outline" onClick={() => setMobileOpen(false)}>Luk</Button></div>
                <SheetDescription className="text-slate-300">WebshopToolbox</SheetDescription>
                <nav className="flex-1 px-3 py-4" aria-label="Primær navigation">
          <button className={`nav-item w-full ${view === 'dashboard' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('dashboard'); }}><LayoutDashboard/>Dashboard</button>
          <p className="nav-label mt-7">Bogføring</p>
          <button
            className={`nav-item w-full ${view === 'orders' ? 'active' : ''}`}
            onClick={() => { setMobileOpen(false); setOrderOffset(0); setView('orders'); }}
          >
            <PackageCheck />
            Salg
          </button>
          <button
            className={`nav-item w-full ${view === 'refunds' ? 'active' : ''}`}
            onClick={() => { setMobileOpen(false); setView('refunds'); }}
          >
            <RotateCcw />
            Tilbagebetalinger
          </button>
          <button
            className={`nav-item w-full ${view === 'payouts' ? 'active' : ''}`}
            onClick={() => { setMobileOpen(false); setView('payouts'); }}
          >
            <HandCoins />
            Udbetalinger
          </button>
          <button className={`nav-item w-full ${view === 'inventory' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('inventory'); }}><Warehouse />Lager</button>
          <p className="nav-label mt-7">Dokumenter</p>
          <button
            className={`nav-item w-full ${view === 'invoices' ? 'active' : ''}`}
            onClick={() => { setMobileOpen(false); setOrderOffset(0); setView('invoices'); }}
          >
            <FileText />
            Fakturaer
          </button>
          <button className={`nav-item w-full ${view === 'documents' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('documents'); }}><BookOpenCheck />Udbetalingsrapporter</button>
          <p className="nav-label mt-7">Tools</p>
          <button className={`nav-item w-full ${view === 'performance' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('performance'); }}><Activity />Performance</button>
          <button className={`nav-item w-full ${view === 'packaging' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('packaging'); }}><Boxes />Emballage</button>
          <button className={`nav-item w-full ${view === 'feeds' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('feeds'); }}><Rss />Produktfeeds</button>
          <p className="nav-label mt-7">System</p>
          <button className={`nav-item w-full ${view === 'support' ? 'active' : ''}`} onClick={() => { setMobileOpen(false); setView('support'); }}><Lightbulb />Support</button>
          <button
            className={`nav-item w-full ${view === 'settings' ? 'active' : ''}`}
            onClick={() => { setMobileOpen(false); setView('settings'); }}
          >
            <Settings2 />
            Indstillinger
          </button>
        </nav>
                <div className="mx-3 mb-3 overflow-hidden rounded-xl border border-white/10 bg-black/30"><img src="/brand/webshoptoolbox-logo.png" alt="WebshopToolbox" className="h-auto w-full" /></div>
              </SheetContent>
            </Sheet>
            <img src="/brand/webshoptoolbox-logo.png" alt="WebshopToolbox" className="w-[105px]" />
          </div>
          <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
            <WebshopSelector />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell onReporting={()=>{setPackagingEntry(p=>({tab:'reporting',key:p.key+1}));setView('packaging');}}/>
            <CustomerIdentity />
          </div>
        </header>
        {view === 'performance' && <Performance onIntegrations={() => { setIntegrationTarget(null); setSettingsTab('integrations'); setView('settings'); }}/>}
        {view === 'dashboard' && <Dashboard onIntegrations={provider => { setIntegrationTarget(provider ?? null); setSettingsTab('integrations'); setView('settings'); }}/>}
        {currentRequirement && connections===null && !connectionsError && <div className="mx-auto max-w-[1440px] px-5 py-16 text-center text-sm text-muted-foreground">Kontrollerer integrationer…</div>}
        {currentRequirement && connectionsError && <div className="mx-auto max-w-[1440px] px-5 py-16 text-center"><p role="alert" className="text-sm text-red-700">{connectionsError}</p><Button className="mt-4" variant="outline" onClick={()=>void refreshConnections()}>Prøv igen</Button></div>}
        {currentRequirement && connections && !integrationAvailable(view) && <IntegrationRequired title={currentRequirement.title} providers={currentRequirement.providers} onIntegrations={()=>{setIntegrationTarget(currentRequirement.providers.length===1&&currentRequirement.providers[0]==='shopify'?'shopify':null);setSettingsTab('integrations');setView('settings');}}/>}
        {view === 'orders' && integrationAvailable('orders') && (
          <div
            className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9"
            id="orders"
          >
            <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <p className="eyebrow">Shopify · Dinero</p>
                <h1 className="page-title">
                  Salg
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Følg salg, realisering og bogføring ét sted.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="h-10 rounded-xl px-4" onClick={() => { sessionStorage.setItem('toolbox-refresh-sales', '1'); window.location.reload(); }}>
                  Opdater side
                </Button>
              <Button className="h-10 rounded-xl px-4 shadow-sm" onClick={syncOrders} disabled={syncingOrders}>
                <RefreshCw data-icon="inline-start" className={syncingOrders ? 'animate-spin' : ''} />
                {syncingOrders ? 'Synkroniserer…' : 'Synkronisér nu'}
              </Button>
              </div>
            </div>
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <Stat
                label="Ordrer i dag"
                value={ordersToday === null ? '—' : `${ordersToday} ordrer`}
                note="Oprettet i Shopify i dag"
                tone="lime"
              />
              <Stat
                label="Ikke bogført"
                value={`${salesOrders.filter((order) => order.status === 'Afventer').length} ordrer`}
                note="Afventer Dinero-workflow"
              />
              <Stat
                label="Kræver handling"
                value={`${salesOrders.filter((order) => order.status.startsWith('Fejlet')).length} ordrer`}
                note="Se fejl under Indstillinger"
                tone="warn"
              />
            </div>
            {orderError && <p role="alert" className="mb-4 text-red-700">{orderError}</p>}
            <p className="mb-4 text-sm text-muted-foreground">Automatisk overførsel og bogføring følger valgene under Indstillinger. Bogføringsstatus viser den senest registrerede behandling i Dinero.</p>
            <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_12px_40px_rgba(23,31,27,.045)]">
              <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-[320px]">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-10 rounded-xl bg-muted/50 pl-9"
                    placeholder="Søg på denne side"
                    aria-label="Søg i ordrer"
                  />
                </div>
                <label className="flex w-full flex-col gap-1.5 text-sm sm:w-56"><span>Periode</span><NativeSelect aria-label="Periode for salg" value={orderPeriod} onChange={event => { setOrderPeriod(event.target.value as OrderPeriod); setOrderOffset(0); setSalesOrders([]); setOrderTotal(0); setOrderError(''); }}>{orderPeriods.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label>
                {orderCountries.length > 1 && <label className="flex w-full flex-col gap-1.5 text-sm sm:w-48"><span>Land</span><NativeSelect aria-label="Land for salg" value={orderCountry} onChange={event => { setOrderCountry(event.target.value); setOrderOffset(0); setSalesOrders([]); setOrderTotal(0); setOrderError(''); }}><NativeSelectOption value="">Alle lande</NativeSelectOption>{orderCountries.map(code => <NativeSelectOption key={code} value={code}>{countryName(code)}</NativeSelectOption>)}<NativeSelectOption value="unknown">Ukendt land</NativeSelectOption></NativeSelect></label>}
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/45 hover:bg-muted/45">
                    <TableHead className="pl-5">Ordre</TableHead>
                    <TableHead>Dato</TableHead>
                    <TableHead>Betalingsudbyder</TableHead>
                    <TableHead>Afsendelse</TableHead>
                    <TableHead className="text-right">Beløb</TableHead>
                    <TableHead>Realiseret</TableHead>
                    <TableHead>Bogføring</TableHead>
                    <TableHead>
                      <span className="sr-only">Handling</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!filtered.length && <TableRow><TableCell colSpan={8} className="p-8 text-center">{orderError ? 'Ordrerne kunne ikke vises.' : 'Ingen ordrer i det valgte udsnit.'}</TableCell></TableRow>}
                  {filtered.map((order) => (
                    <OrderRow key={order.id} order={order} onBooked={() => setOrderRevision(value => value + 1)} />
                  ))}
                </TableBody>
              </Table>
              {orderPagination}
            </section>
          </div>
        )}
        {view === 'invoices' && integrationAvailable('invoices') && (
          <Invoices pagination={orderPagination} orders={salesOrders} onGenerated={(count) => notify(`${count} faktura${count === 1 ? '' : 'er'} er genereret`)} onSync={syncOrders} syncing={syncingOrders} />
        )}
        {view === 'documents' && integrationAvailable('documents') && <Documents syncRevision={syncState.revision} />}
        {view === 'refunds' && integrationAvailable('refunds') && (
          <Payments syncRevision={syncState.revision} kind="refund" />
        )}
        {view === 'payouts' && integrationAvailable('payouts') && (
          <ProviderLedger kind="payout" syncRevision={syncState.revision} />
        )}
        {view === 'inventory' && integrationAvailable('inventory') && <Inventory />}
        {view === 'packaging' && integrationAvailable('packaging') && <Packaging key={packagingEntry.key} initialTab={packagingEntry.tab} onIntegrations={()=>{setIntegrationTarget('emballage');setSettingsTab('integrations');setView('settings');}}/>}
        {view === 'feeds' && integrationAvailable('feeds') && <ProductFeeds />}
        {view === 'support' && <Support />}
        {view === 'settings' && (
          <div>
            <div className="mx-auto w-full max-w-[1440px] px-5 pt-6 md:px-8">
              <Tabs value={settingsTab} onValueChange={value => setSettingsTab(value as typeof settingsTab)}>
                <div className="overflow-x-auto pb-1">
                  <TabsList aria-label="Indstillinger">
                    <TabsTrigger value="dashboard" className="px-4">Generelt</TabsTrigger>
                    <TabsTrigger value="integrations" className="px-4">Integrationer og kontoplan</TabsTrigger>
                    <TabsTrigger value="invoice-email" className="px-4">Faktura-afsendelse</TabsTrigger>
                    <TabsTrigger value="inventory" className="px-4">Lager</TabsTrigger>
                  </TabsList>
                </div>
              </Tabs>
            </div>
            <Settings
            savedIntervalMinutes={syncState.status?.intervalMinutes}
            mode={settingsTab}
            initialIntegration={integrationTarget}
            accounts={accounts}
            setAccounts={setAccounts}
            onSave={saveSettings}
            automation={automation} setAutomation={setAutomation} invoiceEmail={invoiceEmail} setInvoiceEmail={setInvoiceEmail} syncIntervalMinutes={syncIntervalMinutes} setSyncIntervalMinutes={setSyncIntervalMinutes}
            ready={settingsReady} saving={settingsSaving} message={settingsMessage}
            onConnectionsChanged={refreshConnections}
          />
          </div>
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
function OrderRow({ order, onBooked }: { order: OrderView; onBooked: () => void }) {
  const state = order.status;
  const booked = state === 'Bogført';
  const handled = booked || state === 'Annulleret · håndteret';
  return (
    <TableRow className={state === 'Fejlet' ? 'bg-red-50/35' : ''}>
      <TableCell className="pl-5 font-semibold text-[#365f08]">
        <span className="inline-flex items-center gap-2">{order.country ? <CountryFlag code={order.country} /> : <span className="inline-block w-5" aria-hidden="true" />}{order.id}</span>
      </TableCell>
      <TableCell className="text-muted-foreground">{order.date}</TableCell>
      <TableCell>{order.paymentProvider || 'Afventer opdatering'}</TableCell>
      <TableCell>
        <span
          className={`status-dot ${order.shipped === 'Afsendt' ? 'ok' : 'wait'}`}
        />
        {order.shipped}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {order.amount} {order.currency || 'DKK'}
        {order.customerTotal && <span className="block text-xs font-normal text-muted-foreground">Kunden betalte {order.customerTotal}</span>}
      </TableCell>
      <TableCell className="text-muted-foreground">{order.realized}</TableCell>
      <TableCell>
        <Badge
          variant={state.startsWith('Fejlet') ? 'destructive' : 'secondary'}
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
        {order.externalId && <div className="flex flex-wrap justify-end gap-2">{order.shipped === 'Afsendt' && !handled && <SalesPreview externalId={order.externalId} />}<OrderLog externalId={order.externalId} />{order.shipped === 'Afsendt' && !handled && <ManualBookingAction kind="sale" externalId={order.externalId} onDone={onBooked} />}</div>}
      </TableCell>
    </TableRow>
  );
}

function Invoices({ orders, onGenerated, onSync, syncing, pagination }: { pagination: React.ReactNode; orders: OrderView[]; onGenerated: (count: number) => void; onSync: () => Promise<void>; syncing: boolean }) {
  const capabilities=useCapabilities();
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [pdfVersions, setPdfVersions] = useState<Record<string, string>>({});
  const [emailing, setEmailing] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [generating, setGenerating] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');
  const [invoiceMessage, setInvoiceMessage] = useState('');
  useEffect(() => { fetch('/api/invoices').then(async response => { if (!response.ok) throw new Error('Fakturastatus kunne ikke indlæses'); return response.json() as Promise<{ statuses: Record<string, string>; versions?: Record<string, string> }>; }).then(data => { setStatuses(data.statuses || {}); setPdfVersions(data.versions || {}); }).catch(error => setInvoiceError(error.message)); }, []);
  const generate = async (order: OrderView, regenerate = false) => {
    if (!order.externalId) return;
    const previousStatus = statuses[order.externalId];
    setInvoiceError(''); setGenerating(true);
    setStatuses(current => ({ ...current, [order.externalId!]: regenerate ? 'Regenererer…' : 'Genererer…' }));
    try {
      const response = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ externalId: order.externalId, regenerate }) });
      const data = await response.json() as { statuses: Record<string, string>; versions?: Record<string, string>; generated: number; error?: string };
      if (!response.ok) throw new Error(data.error || 'Fakturaen kunne ikke genereres');
      setStatuses(data.statuses || {}); setPdfVersions(data.versions || {}); onGenerated(data.generated);
    } catch (error) {
      setInvoiceError(error instanceof Error ? error.message : 'Fakturaen kunne ikke genereres');
      setStatuses(current => ({ ...current, [order.externalId!]: previousStatus === 'Genereret' ? 'Genereret' : 'Fejlet' }));
    } finally { setGenerating(false); }
  };
  const generateAll = async () => {
    setGenerating(true); setInvoiceError('');
    try {
      let offset = 0; let count = 0; let more = true; const warnings: string[] = [];
      while (more) {
        const response = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true, offset }) });
        const data = await response.json() as { statuses: Record<string, string>; versions?: Record<string, string>; generated: number; warnings?: string[]; hasMore: boolean; nextOffset: number; error?: string }; if (!response.ok) throw new Error(data.error);
        warnings.push(...(data.warnings || []));
        setStatuses(data.statuses || {}); setPdfVersions(data.versions || {}); count += data.generated || 0; more = data.hasMore; offset = data.nextOffset;
      }
      onGenerated(count);
      if (warnings.length) setInvoiceError(`${warnings.length} fakturaer kræver gennemgang. ${warnings.slice(0, 3).join(' ')} Se alle meddelelser under Indstillinger.`);
    } catch (error) { setInvoiceError(error instanceof Error ? error.message : 'Fakturaerne kunne ikke genereres'); } finally { setGenerating(false); }
  };
  const sendInvoice = async (order: OrderView) => {
    if (!order.externalId) return;
    setInvoiceError(''); setInvoiceMessage('');
    setEmailing(current => ({ ...current, [order.externalId!]: true }));
    try {
      const response = await fetch('/api/invoices/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ externalId: order.externalId }) });
      const data = await response.json() as { sent?: boolean; recipient?: string; invoiceNumber?: string; error?: string };
      if (!response.ok || !data.sent) throw new Error(data.error || 'Fakturaen kunne ikke sendes');
      setInvoiceMessage(`Faktura ${data.invoiceNumber || order.id.replace(/^#/, '')} er sendt til ${data.recipient}.`);
    } catch (error) { setInvoiceError(error instanceof Error ? error.message : 'Fakturaen kunne ikke sendes'); }
    finally { setEmailing(current => ({ ...current, [order.externalId!]: false })); }
  };
  const visibleOrders = orders.filter((order) => order.id.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Dokumenter · Shopify</p>
          <h1 className="page-title">
            Fakturaer
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Fakturaer oprettes først, når hele ordren er markeret som afsendt i Shopify. Opdateringen sker ved hentning fra Shopify.
          </p>
        </div>
        <div className="flex gap-2"><Button variant="outline" className="h-10 rounded-xl px-4" onClick={onSync} disabled={syncing}><RefreshCw className={syncing ? 'animate-spin' : ''} />{syncing ? 'Henter…' : 'Hent fra Shopify'}</Button><Button className="h-10 rounded-xl px-4" onClick={generateAll} disabled={generating || !orders.length}>
          <FileText />
          {generating ? 'Genererer…' : 'Generér alle manglende'}
        </Button></div>
      </div>
      {invoiceError && <p role="alert" className="mb-4 rounded-xl border border-red-200 p-4 text-sm text-red-700">{invoiceError}</p>}
      {invoiceMessage && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{invoiceMessage}</p>}
      <p className="mb-4 text-sm text-muted-foreground">En genereret faktura kan sendes manuelt til kundens mailadresse fra Shopify. Eksisterende PDF’er bevares, og ændrede fakturaer kræver særskilt gennemgang.</p>
      <section className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b p-4">
          <div className="relative max-w-[320px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
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
              <TableHead className="text-right">Beløb</TableHead>
              <TableHead>Fakturastatus</TableHead>
              <TableHead>
                <span className="sr-only">Handling</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleOrders.map((order) => {
              const savedStatus = order.externalId ? statuses[order.externalId] : null;
              const status = savedStatus === 'Genereret' ? savedStatus : order.shipped === 'Annulleret' ? 'Annulleret · ingen faktura' : savedStatus || (order.shipped === 'Afsendt' ? 'Afventer' : 'Afventer afsendelse');
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
                    {order.amount} {order.currency || 'DKK'}
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
                      <div className="flex flex-wrap justify-end gap-1"><a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={tier1Url(`/api/invoices/pdf?externalId=${encodeURIComponent(order.externalId || '')}&v=${encodeURIComponent(pdfVersions[order.externalId || ''] || 'legacy')}`)} target="_blank" rel="noreferrer"><FileText />PDF</a><Button variant="outline" size="sm" disabled={!capabilities.customerEmail || emailing[order.externalId || ""]} title={capabilities.customerEmail?undefined:"Kundemail er blokeret i testmiljøet"} onClick={() => sendInvoice(order)}><Mail />{emailing[order.externalId || ''] ? 'Sender…' : 'Send til kunde'}</Button><Button variant="outline" size="sm" disabled title="Eksisterende bilag bevares uændret" onClick={() => generate(order, true)}><RefreshCw />Regenerér</Button></div>
                    ) : order.shipped === 'Annulleret' ? null : (
                      <div className="flex justify-end gap-1"><Button
                        variant="outline"
                        size="sm"
                        onClick={() => generate(order)}
                        disabled={generating || order.shipped !== 'Afsendt' || status === 'Genererer…' || status === 'Regenererer…'}
                      >
                        <FileText />
                        {status === 'Fejlet' ? 'Generér igen' : 'Generér'}
                      </Button></div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {pagination}
      </section>
      {!orders.length && <div className="mt-4 rounded-xl border border-dashed bg-white p-8 text-center text-sm text-muted-foreground">Ingen Shopify-ordrer er hentet endnu. Forbind Shopify under Indstillinger, og vælg derefter “Hent fra Shopify”.</div>}
    </div>
  );
}


function Settings({
  mode, initialIntegration,
  accounts,
  setAccounts,
  onSave,
  onConnectionsChanged,
  automation, setAutomation, invoiceEmail, setInvoiceEmail, syncIntervalMinutes, setSyncIntervalMinutes, savedIntervalMinutes, ready, saving, message,
}: {
  mode: 'dashboard' | 'integrations' | 'invoice-email' | 'inventory';
  initialIntegration: 'shopify'|'dinero'|'emballage'|null;
  accounts: Accounts;
  setAccounts: React.Dispatch<React.SetStateAction<Accounts>>;
  onSave: () => Promise<void>;
  automation: Automation; setAutomation: React.Dispatch<React.SetStateAction<Automation>>;
  invoiceEmail: InvoiceEmailSettings; setInvoiceEmail: React.Dispatch<React.SetStateAction<InvoiceEmailSettings>>;
  syncIntervalMinutes: number; setSyncIntervalMinutes: React.Dispatch<React.SetStateAction<number>>;
  savedIntervalMinutes?: number;
  ready: boolean; saving: boolean; message: string;
  onConnectionsChanged: () => Promise<void>;
}) {
  const capabilities=useCapabilities();
  const [chart, setChart] = useState<
    Array<{ number: string; name: string; vatCode?: string }>
  >([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartMessage, setChartMessage] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [connecting, setConnecting] = useState<'shopify' | 'dinero' | null>(null);
  const library = useIntegrationLibrary();
  const [expandedEmballage, setExpandedEmballage] = useState(initialIntegration==='emballage');
  const [expandedFlatpay,setExpandedFlatpay]=useState(false);
  const [expandedViaBill, setExpandedViaBill] = useState(false);
  const [expandedPensopay, setExpandedPensopay] = useState(false);
  const [expandedIntegration, setExpandedIntegration] = useState<'shopify' | 'dinero' | null>(initialIntegration==='emballage'?null:initialIntegration);
  useEffect(()=>{
    if(mode!=='integrations' || !initialIntegration)return;
    if(initialIntegration==='emballage')setExpandedEmballage(true);else setExpandedIntegration(initialIntegration);
    const frame=requestAnimationFrame(()=>document.getElementById(initialIntegration+'-connection-panel')?.scrollIntoView({block:'center'}));
    return ()=>cancelAnimationFrame(frame);
  },[mode,initialIntegration]);
  const [connected, setConnected] = useState<Record<string, string>>({});
  const [shopify, setShopify] = useState({ shop: '', clientId: '', clientSecret: '' });
  const [dinero, setDinero] = useState({ clientId: '', clientSecret: '', apiKey: '', organizationId: '' });
  useEffect(() => {
    fetch('/api/integrations')
      .then((response) => response.json() as Promise<{ integrations: Array<{ provider: string; display_name: string }> }>)
      .then((data) => setConnected(Object.fromEntries((data.integrations ?? []).map((item: { provider: string; display_name: string }) => [item.provider, item.display_name]))))
      .catch(() => setConnectionMessage('Forbindelsesstatus kunne ikke hentes'));
  }, []);
  const toggleAutomation = (key: keyof typeof automation, value: boolean) => {
    const next = { ...automation, [key]: value };
    setAutomation(next);
  };
  const integrations = [
    {
      name: 'Shopify',
      provider: 'shopify' as const,
      detail: supportedModules('shopify'),
      icon: ShoppingBag,
      connected: Boolean(connected.shopify),
    },
    {
      name: 'Dinero',
      provider: 'dinero' as const,
      detail: supportedModules('dinero'),
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
      const data = await response.json() as { name: string; webshopId?:string; created?:boolean; error?: string };
      if (!response.ok) throw new Error(data.error);
      setConnected((current) => ({ ...current, [provider]: data.name }));
      await onConnectionsChanged();
      void library.refresh();
      if (provider === 'shopify') setShopify((current) => ({ ...current, clientSecret: '' }));
      else setDinero((current) => ({ ...current, clientSecret: '', apiKey: '' }));
      if (provider === 'dinero') { setChart([]); await loadChart(false); }
      setConnectionMessage(`${provider === 'shopify' ? 'Shopify' : 'Dinero'} er testet og forbundet med læseadgang`);
      if (provider === 'shopify' && data.created) { sessionStorage.setItem('toolbox-selected-shop',data.webshopId!); window.location.reload(); }
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : 'Forbindelsen kunne ikke oprettes');
    } finally {
      setConnecting(null);
    }
  };
  const loadChart = async (sync = false) => {
    setLoadingChart(true);
    setChartMessage('');
    try {
      const response = await fetch('/api/dinero/accounts', { method: sync ? 'POST' : 'GET', cache: 'no-store' });
      const data = await response.json() as { accounts: Array<{ number: string; name: string; vatCode?: string; hidden?: boolean }>; fetchedAt: string | null; error?: string };
      if (!response.ok) throw new Error(data.error);
      setChart(data.accounts.filter(account => !account.hidden));
      setChartMessage(data.fetchedAt ? `${data.accounts.length} konti gemt · Senest synkroniseret ${formatDateTime(data.fetchedAt)}` : 'Ingen kontoplan gemt endnu. Vælg Synkronisér kontoplan.');
    } catch (error) {
      setChartMessage(
        error instanceof Error
          ? `${error.message}${sync ? ' Den tidligere gemte kontoplan er ikke ændret.' : ''}`
          : 'Kontoplanen kunne ikke hentes',
      );
    } finally {
      setLoadingChart(false);
    }
  };
  useEffect(() => { void loadChart(false); }, []);
  const vatCodes = vatCodeOptions(chart);
  const Field = ({ name, label }: { name: keyof Accounts; label: string }) => (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {name === 'vatCode' || name === 'noVatCode' ? (
        <>
          <NativeSelect className="mt-1.5 w-full" value={accounts[name]} disabled={loadingChart}
            onChange={event => setAccounts(current => ({ ...current, [name]: event.target.value }))}>
            <NativeSelectOption value="">Vælg momskode</NativeSelectOption>
            {name === 'noVatCode' && <NativeSelectOption value="NONE">Ingen moms</NativeSelectOption>}
            {accounts[name] && !(name === 'noVatCode' && accounts[name] === 'NONE') && !vatCodes.includes(accounts[name]) && <NativeSelectOption value={accounts[name]} disabled>{accounts[name]} (nuværende valg – ikke i listen)</NativeSelectOption>}
            {vatCodes.map(code => <NativeSelectOption key={code} value={code}>{code}</NativeSelectOption>)}
          </NativeSelect>
          {!vatCodes.length && <span className="mt-1 block text-xs text-muted-foreground">Ingen momskoder i den gemte kontoplan. Synkronisér kontoplanen fra Dinero.</span>}
          {name === 'noVatCode' && <span className="mt-1 block text-xs text-muted-foreground">Vælg Ingen moms til dansk salg uden moms og en salgskonto uden momskode. Udenlandsk salg kræver særskilt afklaring.</span>}
        </>
      ) : chart.length ? (
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
            readOnly
            placeholder="Hent og vælg konto fra Dinero"
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
        <h1 className="page-title">
          {mode === 'dashboard' ? 'Indstillinger' : mode === 'integrations' ? 'Integrationer og kontoplan' : mode === 'invoice-email' ? 'Faktura-afsendelse' : 'Lager'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === 'dashboard' ? 'Overblik over drift, fejl og automatisk behandling.' : mode === 'integrations' ? 'Forbind systemerne, vælg historik og bestem hvordan posteringerne skal lande i Dinero.' : mode === 'invoice-email' ? 'Styr mailafsendelse, tilpas skabelonen og send en afgrænset test.' : 'Vælg lagerkonti og styr automatisk nedskrivning ved afsendte salg.'}
        </p>
      </div>
      {mode === 'integrations' && library.selection?.selected.includes('dinero') && chartMessage && !chart.length && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Der kræves handling</p>
            <p className="mt-1 text-xs">{chartMessage}</p>
          </div>
        </div>
      )}
      {mode === 'dashboard' && <>
      <fieldset disabled={!ready || saving} className="min-w-0">
      <h2 className="mb-3 text-sm font-semibold">Automatik og bilag</h2>
      <p className="mb-4 text-sm text-muted-foreground">Styr automatisk behandling og vedhæftning af bilag.</p>
      {!ready && !message && <p role="status" className="mb-4 text-sm">Indlæser fælles indstillinger…</p>}
      {message && <p role="status" className="mb-4 rounded-xl border p-4 text-sm">{message}</p>}
      <section className="mb-8 overflow-hidden rounded-2xl border bg-white">
        <div className="flex flex-col justify-between gap-4 border-b p-5 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold">Synkroniseringsinterval</p><p className="mt-1 text-xs text-muted-foreground">Gælder ordrer/salg og tilbagebetalinger. Vælg interval og tryk Gem indstillinger. Udbetalinger hentes hver time og hvert kvarter, når en udbetaling er på vej. Lager hentes hver 4. time og emballagehistorik én gang i døgnet. Synkronisér nu på den enkelte side henter altid med det samme.</p></div><label className="w-full sm:w-52"><span className="mb-2 block text-xs">{savedIntervalMinutes === undefined ? 'Aktivt interval hentes…' : `Gemt interval: ${savedIntervalMinutes} min.`}{savedIntervalMinutes !== undefined && savedIntervalMinutes !== syncIntervalMinutes && <strong className="mt-1 block text-amber-700">Ændringen er ikke gemt endnu</strong>}</span><span className="sr-only">Synkroniseringsinterval</span><NativeSelect className="w-full" value={String(syncIntervalMinutes)} onChange={event => setSyncIntervalMinutes(Number(event.target.value))}>{syncIntervals.map(minutes => <NativeSelectOption key={minutes} value={String(minutes)}>{`Hvert ${minutes}. minut`}</NativeSelectOption>)}</NativeSelect></label></div>
        <div className="flex items-center justify-between border-b p-5">
          <div><p className="text-sm font-semibold">Upload bilag til regnskabsprogram</p><p className="mt-1 text-xs text-muted-foreground">Vedhæft automatisk faktura eller dokumentation til posteringen i Dinero.</p></div>
          <Switch disabled={!capabilities.bookkeeping} checked={automation.attachments} onCheckedChange={(value) => toggleAutomation('attachments', value)} aria-label="Upload bilag til regnskabsprogram" />
        </div>
        <div className="p-5"><p className="mb-4 text-sm font-semibold">Automatiske moduler</p><div className="grid gap-3 sm:grid-cols-2">
          {[
            {key:'sales',bookingKey:'salesBookDinero',label:'Salg',description:'Behandl realiserede ordrer'},
            {key:'refunds',bookingKey:'refundsBookDinero',label:'Tilbagebetalinger',description:'Behandl gennemførte tilbagebetalinger'},
            {key:'payouts',bookingKey:'payoutsBookDinero',label:'Udbetalinger',description:'Behandl udbetalinger fra indløsere'},
          ].map(module => <div key={module.key} className="rounded-xl border bg-muted/30 p-4"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">{module.label}</p><p className="mt-1 text-xs text-muted-foreground">{module.description}</p></div><Switch checked={automation[module.key as keyof typeof automation]} onCheckedChange={value => toggleAutomation(module.key as keyof typeof automation,value)} aria-label={`Automatisk ${module.label}`} /></div><label className="mt-4 block"><span className="text-xs font-medium text-muted-foreground">Dinero-behandling</span><NativeSelect className="mt-1.5 w-full" value={automation[module.bookingKey as keyof typeof automation] ? 'book' : 'draft'} onChange={event => toggleAutomation(module.bookingKey as keyof typeof automation,event.target.value === 'book')}><NativeSelectOption value="draft">Opret kun kladde</NativeSelectOption><NativeSelectOption value="book">Bogfør automatisk</NativeSelectOption></NativeSelect></label></div>)}
        </div></div>
        <div className="flex justify-end border-t p-4"><Button className="h-10 rounded-xl px-4" onClick={onSave}><Save />{saving ? 'Gemmer…' : 'Gem indstillinger'}</Button></div>
      </section>
      </fieldset>
      </>}
      {mode === 'invoice-email' && <InvoiceIssuer/>}
      {mode === 'invoice-email' && <fieldset disabled={!ready || saving} className="min-w-0">
        {!ready && !message && <p role="status" className="mb-4 text-sm">Indlæser fælles indstillinger…</p>}
        {message && <p role="status" className="mb-4 rounded-xl border p-4 text-sm">{message}</p>}
        <section className="mb-8 overflow-hidden rounded-2xl border bg-white">
          <div className="flex items-center justify-between gap-4 border-b p-5">
            <div><h2 className="text-lg font-semibold">2. Mailtekst</h2><p className="mt-1 text-sm text-muted-foreground">Tilpas emne og besked til kunden. {capabilities.customerEmail?'Automatisk afsendelse følger dit tilvalg her.':'Automatisk kundemail er deaktiveret i testmiljøet.'}</p></div>
            <Switch disabled={!capabilities.customerEmail} checked={automation.invoiceEmails} onCheckedChange={(value) => toggleAutomation('invoiceEmails', value)} aria-label="Send faktura automatisk til kunden" />
          </div>
          <div className="grid gap-4 p-5">
            <label><span className="text-xs font-medium text-muted-foreground">Emne</span><Input className="mt-1.5" value={invoiceEmail.subject} onChange={event => setInvoiceEmail(current => ({ ...current, subject: event.target.value }))} /></label>
            <label><span className="text-xs font-medium text-muted-foreground">Mailtekst</span><Textarea className="mt-1.5 min-h-40" value={invoiceEmail.body} onChange={event => setInvoiceEmail(current => ({ ...current, body: event.target.value }))} /></label>
            <p className="text-xs text-muted-foreground">Du kan bruge: {'{{kundenavn}}'}, {'{{fakturanummer}}'} og {'{{ordrenummer}}'}.</p>

          </div>
          <div className="flex justify-end border-t p-4"><Button className="h-10 rounded-xl px-4" onClick={onSave}><Save />{saving ? 'Gemmer…' : 'Gem indstillinger'}</Button></div>
        </section>
      </fieldset>}
      {mode === 'invoice-email' && <InvoiceSender/>}
      {mode === 'inventory' && <fieldset disabled={!ready || saving} className="min-w-0">
        {message && <p role="status" className="mb-4 rounded-xl border p-4 text-sm">{message}</p>}
        <section className="overflow-hidden rounded-2xl border bg-white">
          <div className="border-b p-5"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold">Automatisk lagerbogføring</p><p className="mt-1 text-xs text-muted-foreground">Når en ordre bliver fuldt afsendt, behandles kostprisen som vareforbrug mod lagerkontoen. Kræver gyldige lagerkonti og kostpriser. Vareforbruget følger salgets valg mellem kladde og bogføring.</p></div><Switch disabled={!capabilities.bookkeeping} checked={automation.inventory} onCheckedChange={value => toggleAutomation('inventory', value)} aria-label="Automatisk lagerbogføring" /></div><label className="mt-4 block max-w-sm"><span className="text-xs font-medium text-muted-foreground">Lageroptælling i Dinero</span><NativeSelect className="mt-1.5 w-full" value={automation.inventoryBookDinero ? 'book' : 'draft'} onChange={event => toggleAutomation('inventoryBookDinero',event.target.value === 'book')}><NativeSelectOption value="draft">Opret kun kladde</NativeSelectOption><NativeSelectOption value="book">Bogfør automatisk</NativeSelectOption></NativeSelect></label></div>
          <div className="grid gap-5 p-5 sm:grid-cols-2"><Field name="inventory" label="Konto til varebeholdning"/><Field name="inventoryAdjustment" label="Modkonto til lagerregulering / vareforbrug"/><p className="sm:col-span-2 text-xs text-muted-foreground">Begge konti skal være aktive Dinero-konti uden moms. En optælling ændrer først antal i Shopify; bogføring af optællingsafvigelsen holdes adskilt fra den løbende salgsautomatik.</p></div>
          <div className="flex justify-end border-t p-4"><Button onClick={onSave}><Save />{saving ? 'Gemmer…' : 'Gem indstillinger'}</Button></div>
        </section>
      </fieldset>}
      {mode === 'integrations' && <>
      <HistorySettings />
      <IntegrationLibrary state={library} onAdded={id => { if(id==='flatpay')setExpandedFlatpay(true); else if (id === 'viabill') setExpandedViaBill(true); else if (id === 'pensopay') setExpandedPensopay(true); else if(id === 'emballage') setExpandedEmballage(true); else setExpandedIntegration(id); }} />
      <div className="mb-8 grid items-start gap-3 md:grid-cols-2">
        {integrations.map(({ name, provider, detail, icon: Icon, connected: isConnected }) => (
          <IntegrationCard key={name} name={name} description={detail} icon={Icon} connected={isConnected} expanded={expandedIntegration===provider} onToggle={()=>setExpandedIntegration(current=>current===provider?null:provider)} panelId={`${provider}-connection-panel`} >
                <p className="mb-4 text-xs text-muted-foreground">{provider === 'shopify' ? 'Den installerede app udveksler automatisk oplysningerne til et kortlivet adgangstoken. Testen læser kun butikkens navn.' : 'Forbind Dinero for at hente økonomi og kontoplan samt overføre bilag.'}</p>
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
                <IntegrationStartDate provider={provider}/>{connectionMessage && <p className="mt-3 text-sm text-[#5d712f]" role="status">{connectionMessage}</p>}
                {provider === 'shopify' && <div className="mt-4 rounded-xl border bg-white p-4"><p className="mb-3 text-sm font-semibold">Bogføring af Shopify Payments</p><Field name="shopifyPaymentsClearing" label="Mellemregningskonto" /></div>}
          </IntegrationCard>
        ))}
        {library.selection?.selected.includes('flatpay') && <FlatpayConnection accountField={<Field name="flatpayClearing" label="Mellemregningskonto" />} initialExpanded={expandedFlatpay} onConnected={()=>{void library.refresh();void onConnectionsChanged();}} footer={<RemoveIntegration state={library} provider="flatpay"/>}/>}
        {library.selection?.selected.includes('emballage') && <EmballageConnection initialExpanded={expandedEmballage} onConnected={() => { void library.refresh(); }}  footer={<RemoveIntegration state={library} provider="emballage" />}/>}
        {library.selection?.selected.includes('viabill') && <ViaBillConnection initialExpanded={expandedViaBill} onConnected={() => { void library.refresh(); void onConnectionsChanged(); }} accountField={<Field name="viaBillClearing" label="Mellemregningskonto" />}  footer={<RemoveIntegration state={library} provider="viabill" />}/>}
        {library.selection?.selected.includes('pensopay') && <PensopayConnection initialExpanded={expandedPensopay} onConnected={() => { void library.refresh(); void onConnectionsChanged(); }} footer={<RemoveIntegration state={library} provider="pensopay" />}/>}
      </div>
      {(library.selection?.selected.includes('dinero') || Boolean(connected.dinero)) && <fieldset disabled={!ready || saving} className="min-w-0">
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
              onClick={() => loadChart(true)}
              disabled={loadingChart}
            >
              <ArrowDownToLine />
              {loadingChart ? 'Indlæser…' : 'Synkronisér kontoplan'}
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
            <Field name="vatCode" label="Momskode for salg med moms" />
            <Field name="noVatCode" label="Momskode for salg uden moms" />
          </div>
          <div>
            <h3 className="mb-3 border-b pb-3 font-medium text-[#c06452]">
              Kontoplan for salg
            </h3>
            <div className="space-y-4">
              <Field name="goodsVat" label="Salg af varer med moms" />
              <Field name="goodsNoVat" label="Salg af varer uden moms" />
              <Field name="shippingVat" label="Salg af fragt med moms" />
              <Field name="shippingNoVat" label="Salg af fragt uden moms" />
              <Field name="servicesVat" label="Salg af ydelser med moms" />
              <Field name="servicesNoVat" label="Salg af ydelser uden moms" />
            </div>
          </div>
          <div>
            <h3 className="mb-3 border-b pb-3 font-medium text-[#c06452]">
              Kontoplan for refundering
            </h3>
            <div className="space-y-4">
              <Field
                name="refundGoodsVat"
                label="Refundering af varer med moms"
              />
              <Field
                name="refundGoodsNoVat"
                label="Refundering af varer uden moms"
              />
              <Field
                name="refundShippingVat"
                label="Refundering af fragt med moms"
              />
              <Field
                name="refundShippingNoVat"
                label="Refundering af fragt uden moms"
              />
              <Field
                name="refundServicesVat"
                label="Refundering af ydelser med moms"
              />
              <Field
                name="refundServicesNoVat"
                label="Refundering af ydelser uden moms"
              />
            </div>
          </div>
          <Field name="fees" label="Gebyrkonto" />
          <Field name="clearing" label="Mellemregningskonto" />
          <Field name="bank" label="Bankkonto til udbetalinger" />
        </div>
        <div className="flex justify-end border-t p-4">
          <Button className="h-10 rounded-xl px-4" onClick={onSave}>
            <Save />
            {saving ? 'Gemmer…' : 'Gem indstillinger'}
          </Button>
        </div>
      </section>
      </fieldset>}
      </>}
    </div>
  );
}
