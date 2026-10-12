'use client';
import { tier1Fetch as fetch } from '@/platform/transport';
import { NotificationBell } from '@/components/notification-bell';
import { Dashboard } from '@/components/dashboard';
import { IntegrationRequired } from '@/components/integration-required';
import {
  CustomAppPage,
  CustomAppsNav,
  useCustomApps,
} from '@/components/custom-apps';
import { Rss, Truck } from 'lucide-react';
import {
  CustomerIdentity,
  PageTitle,
  WebshopSelector,
  useAddingWebshop,
} from '@/platform/workspace';
import {
  emptyAccounts,
  defaultAutomation,
  defaultInvoiceEmail,
  type Accounts,
  type Automation,
  type AdminSettings,
  type InvoiceEmailSettings,
} from '@/lib/admin-settings';
import { orderPeriods, type OrderPeriod } from '@/lib/order-period';
import {
  hasRequiredIntegration,
  integrationRequirements,
  type IntegrationGatedView,
} from '@/lib/integration-visibility';
import { useSyncStatus } from '@/components/sync-status';
import { countryName } from '@/components/country-flag';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Activity,
  BookOpenCheck,
  LayoutDashboard,
  Boxes,
  Check,
  FileText,
  HandCoins,
  Lightbulb,
  Menu,
  PackageCheck,
  Warehouse,
  RotateCcw,
  Search,
  Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshButton } from '@/components/refresh-button';
import { fetchRecentOrders } from '@/lib/recent-orders';
import { Input } from '@/components/ui/input';
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
import { OrderRow, Stat, type OrderView } from '@/components/sales-orders';
// Each view is its own file, loaded the first time it is opened; the dashboard and Salg are in the main file.
const ProviderLedger = lazy(() =>
  import('@/components/provider-ledger').then((m) => ({
    default: m.ProviderLedger,
  })),
);
const Documents = lazy(() =>
  import('@/components/documents').then((m) => ({ default: m.Documents })),
);
const Inventory = lazy(() =>
  import('@/components/inventory').then((m) => ({ default: m.Inventory })),
);
const Packaging = lazy(() =>
  import('@/components/packaging').then((m) => ({ default: m.Packaging })),
);
const ProductFeeds = lazy(() =>
  import('@/components/product-feeds').then((m) => ({
    default: m.ProductFeeds,
  })),
);
const Performance = lazy(() =>
  import('@/components/performance').then((m) => ({ default: m.Performance })),
);
const Shipments = lazy(() =>
  import('@/components/shipments').then((m) => ({ default: m.Shipments })),
);
const OrderRefunds = lazy(() =>
  import('@/components/order-refunds').then((m) => ({
    default: m.OrderRefunds,
  })),
);
const Payments = lazy(() =>
  import('@/components/payments').then((m) => ({ default: m.Payments })),
);
const Invoices = lazy(() =>
  import('@/components/invoices-overview').then((m) => ({
    default: m.Invoices,
  })),
);
const Settings = lazy(() =>
  import('@/components/settings-page').then((m) => ({ default: m.Settings })),
);
const Support = lazy(() =>
  import('@/platform/support').then((m) => ({ default: m.Support })),
);
const viewLoading = (
  <p
    aria-live="polite"
    className="mx-auto max-w-[1440px] px-5 py-9 text-sm text-muted-foreground md:px-8"
  >
    Indlæser…
  </p>
);

export default function Home() {
  const syncState = useSyncStatus();
  // "Tilføj webshop" opens the Shopify connection directly; the new webshop is created when it is connected.
  const adding = useAddingWebshop();
  const [connections, setConnections] = useState<Set<string> | null>(null);
  const [connectionsError, setConnectionsError] = useState('');
  const refreshConnections = async () => {
    try {
      const response = await fetch('/api/integrations', { cache: 'no-store' });
      const data = (await response.json()) as {
        integrations?: Array<{ provider: string }>;
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.integrations))
        throw new Error(data.error || 'Forbindelsesstatus kunne ikke hentes.');
      setConnections(new Set(data.integrations.map((item) => item.provider)));
      setConnectionsError('');
    } catch (error) {
      setConnectionsError(
        error instanceof Error
          ? error.message
          : 'Forbindelsesstatus kunne ikke hentes.',
      );
    }
  };
  useEffect(() => {
    void refreshConnections();
  }, []);
  const [query, setQuery] = useState('');
  const [salesOrders, setSalesOrders] = useState<OrderView[]>([]);
  const [ordersToday, setOrdersToday] = useState<number | null>(null);
  const [orderPeriod, setOrderPeriod] = useState<OrderPeriod>('all');
  const [orderCountry, setOrderCountry] = useState(''),
    [orderCountries, setOrderCountries] = useState<string[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderOffset, setOrderOffset] = useState(0);
  const [orderTotal, setOrderTotal] = useState(0);
  // The printer icon on Salg is shown when Shipmondo is connected with a printer chosen.
  const [labelsEnabled, setLabelsEnabled] = useState(false);
  const [orderRevision, setOrderRevision] = useState(0);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [packagingEntry, setPackagingEntry] = useState({
    tab: 'consumption' as 'consumption' | 'reporting',
    key: 0,
  });
  const [view, setView] = useState<
    | 'dashboard'
    | 'orders'
    | 'invoices'
    | 'documents'
    | 'refunds'
    | 'payouts'
    | 'inventory'
    | 'packaging'
    | 'support'
    | 'feeds'
    | 'performance'
    | 'shipments'
    | 'settings'
    | 'custom-app'
  >(adding ? 'settings' : 'dashboard');
  const customApps = useCustomApps();
  const [customAppId, setCustomAppId] = useState<string | null>(null);
  const openCustomApp = (id: string) => {
    setMobileOpen(false);
    setCustomAppId(id);
    setView('custom-app');
  };
  const customApp =
    view === 'custom-app'
      ? customApps.find((app) => app.id === customAppId)
      : undefined;
  const [integrationTarget, setIntegrationTarget] = useState<
    'shopify' | 'dinero' | 'emballage' | null
  >(adding ? 'shopify' : null);
  const [settingsTab, setSettingsTab] = useState<
    'dashboard' | 'integrations' | 'invoice-email' | 'inventory'
  >(adding ? 'integrations' : 'dashboard');
  const [notice, setNotice] = useState('');
  const [accounts, setAccounts] = useState<Accounts>(emptyAccounts);
  const [automation, setAutomation] = useState<Automation>(defaultAutomation);
  const [invoiceEmail, setInvoiceEmail] =
    useState<InvoiceEmailSettings>(defaultInvoiceEmail);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(15);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [orderError, setOrderError] = useState('');
  // Also reloaded when a webshop switches between the company's and its own invoice settings (mail texts).
  const loadSettings = () =>
    fetch('/api/admin/settings')
      .then(async (response) => {
        const data = (await response.json()) as {
          settings: AdminSettings | null;
          revision: string | null;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error);
        if (data.settings) {
          setAccounts(data.settings.accounts);
          setAutomation(data.settings.automation);
          setInvoiceEmail(data.settings.invoiceEmail);
          setSyncIntervalMinutes(data.settings.syncIntervalMinutes);
        }
        setSettingsRevision(data.revision);
        setSettingsReady(true);
      })
      .catch((error) =>
        setSettingsMessage(
          error.message ||
            'Indstillinger kunne ikke indlæses. Genindlæs siden.',
        ),
      );
  useEffect(() => {
    void loadSettings();
  }, []);
  const orderPageSize = 25;
  const activePeriod = view === 'invoices' ? 'all' : orderPeriod;
  const filtered = salesOrders.filter(
    (order) =>
      order.id.includes(query) ||
      order.status.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    if (
      connections === null ||
      !connections.has('shopify') ||
      (view !== 'orders' && view !== 'invoices')
    )
      return;
    const controller = new AbortController();
    setOrdersLoading(true);
    fetch(
      `/api/shopify/orders?offset=${orderOffset}&limit=${orderPageSize}&period=${activePeriod}${view === 'orders' && orderCountry ? '&country=' + orderCountry : ''}`,
      { signal: controller.signal, cache: 'no-store' },
    )
      .then(async (response) => {
        const data = (await response.json()) as {
          orders: OrderView[];
          total: number;
          today?: number;
          countries?: string[];
          labels?: boolean;
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || 'Ordrer kunne ikke indlæses');
        return data;
      })
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data.orders)) {
          if (orderOffset > 0 && orderOffset >= data.total) {
            setOrderOffset(
              Math.max(0, Math.ceil(data.total / orderPageSize) - 1) *
                orderPageSize,
            );
            return;
          }
          setSalesOrders(data.orders);
          setLabelsEnabled(data.labels === true);
          setOrderTotal(data.total || 0);
          setOrderCountries(data.countries || []);
          setOrdersToday(data.today ?? null);
          setOrderError('');
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setOrderError(error.message || 'Ordrer kunne ikke indlæses');
      })
      .finally(() => {
        if (!controller.signal.aborted) setOrdersLoading(false);
      });
    return () => controller.abort();
  }, [
    connections,
    orderOffset,
    orderRevision,
    syncState.revision,
    view,
    activePeriod,
    orderPageSize,
    orderCountry,
  ]);
  // "Opdatér" on Salg and Fakturaer: new and changed orders from Shopify, then the list again. Fulfilled orders
  // are invoiced, mailed and booked by the automatic run as before, never by this button.
  const syncOrders = async () => {
    setSyncingOrders(true);
    try {
      const { synced, warning } = await fetchRecentOrders();
      notify(
        `${synced} Shopify-ordrer hentet${warning ? ` · ${warning}` : ''}`,
      );
    } finally {
      setSyncingOrders(false);
      setOrderOffset(0);
      setOrderRevision((value) => value + 1);
      void syncState.refresh();
    }
  };
  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  };
  const currentRequirement =
    view in integrationRequirements
      ? integrationRequirements[view as IntegrationGatedView]
      : null;
  const integrationAvailable = (target: typeof view) => {
    if (!(target in integrationRequirements)) return true;
    return Boolean(
      connections &&
      hasRequiredIntegration(target as IntegrationGatedView, connections),
    );
  };
  const saveSettings = async () => {
    setSettingsSaving(true);
    setSettingsMessage('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { accounts, automation, invoiceEmail, syncIntervalMinutes },
          revision: settingsRevision,
        }),
      });
      const data = (await response.json()) as {
        revision: string;
        error?: string;
        message?: string;
      };
      if (!response.ok) throw new Error(data.error);
      setSettingsRevision(data.revision);
      setSettingsMessage(data.message || 'Indstillingerne er gemt.');
      void syncState.refresh();
    } catch (error) {
      setSettingsMessage(
        error instanceof Error ? error.message : 'Kunne ikke gemme',
      );
    } finally {
      setSettingsSaving(false);
    }
  };
  const orderPagination = (
    <nav
      aria-label="Ordrehistorik"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-4 text-sm"
    >
      <span>
        {ordersLoading
          ? 'Henter ordrer…'
          : orderTotal
            ? `${orderOffset + 1}–${Math.min(orderOffset + orderPageSize, orderTotal)} af ${orderTotal} ordrer · Side ${Math.floor(orderOffset / orderPageSize) + 1} af ${Math.max(1, Math.ceil(orderTotal / orderPageSize))}`
            : 'Ingen ordrer i perioden'}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={syncingOrders || ordersLoading || orderOffset === 0}
          onClick={() =>
            setOrderOffset((value) => Math.max(0, value - orderPageSize))
          }
        >
          Forrige
        </Button>
        <Button
          variant="outline"
          disabled={
            syncingOrders ||
            ordersLoading ||
            orderOffset + orderPageSize >= orderTotal
          }
          onClick={() => setOrderOffset((value) => value + orderPageSize)}
        >
          Næste
        </Button>
      </div>
    </nav>
  );
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
          <button
            className={`nav-item w-full ${view === 'dashboard' ? 'active' : ''}`}
            onClick={() => {
              setMobileOpen(false);
              setView('dashboard');
            }}
          >
            <LayoutDashboard />
            Dashboard
          </button>
          <p className="nav-label mt-7">Bogføring</p>
          <button
            className={`nav-item w-full ${view === 'orders' ? 'active' : ''}`}
            onClick={() => {
              setOrderOffset(0);
              setView('orders');
            }}
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
          <button
            className={`nav-item w-full ${view === 'inventory' ? 'active' : ''}`}
            onClick={() => setView('inventory')}
          >
            <Warehouse />
            Lager
          </button>
          <p className="nav-label mt-7">Dokumenter</p>
          <button
            className={`nav-item w-full ${view === 'invoices' ? 'active' : ''}`}
            onClick={() => {
              setOrderOffset(0);
              setView('invoices');
            }}
          >
            <FileText />
            Fakturaer
          </button>
          <button
            className={`nav-item w-full ${view === 'documents' ? 'active' : ''}`}
            onClick={() => setView('documents')}
          >
            <BookOpenCheck />
            Udbetalingsrapporter
          </button>
          <p className="nav-label mt-7">Tools</p>
          <button
            className={`nav-item w-full ${view === 'performance' ? 'active' : ''}`}
            onClick={() => {
              setMobileOpen(false);
              setView('performance');
            }}
          >
            <Activity />
            Performance
          </button>
          <button
            className={`nav-item w-full ${view === 'shipments' ? 'active' : ''}`}
            onClick={() => {
              setMobileOpen(false);
              setView('shipments');
            }}
          >
            <Truck />
            Forsendelser
          </button>
          <button
            className={`nav-item w-full ${view === 'packaging' ? 'active' : ''}`}
            onClick={() => {
              setMobileOpen(false);
              setView('packaging');
            }}
          >
            <Boxes />
            Emballage
          </button>
          <button
            className={`nav-item w-full ${view === 'feeds' ? 'active' : ''}`}
            onClick={() => {
              setMobileOpen(false);
              setView('feeds');
            }}
          >
            <Rss />
            Produktfeeds
          </button>
          <CustomAppsNav
            apps={customApps}
            active={view === 'custom-app' ? customAppId : null}
            onOpen={openCustomApp}
          />
          <p className="nav-label mt-7">System</p>
          <button
            className={`nav-item w-full ${view === 'support' ? 'active' : ''}`}
            onClick={() => setView('support')}
          >
            <Lightbulb />
            Support
          </button>
          <button
            className={`nav-item w-full ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            <Settings2 />
            Indstillinger
          </button>
        </nav>
        <div className="mx-4 mb-3 overflow-hidden rounded-xl border border-white/10 bg-black/30 shadow-lg">
          <img
            src="/brand/webshoptoolbox-logo.png"
            alt="WebshopToolbox"
            className="h-auto w-full"
          />
        </div>
      </aside>
      <section className="min-w-0">
        <header className="flex h-20 items-center justify-between border-b border-border bg-white px-5 md:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                render={
                  <Button variant="outline" size="icon" aria-label="Åbn menu" />
                }
              >
                <Menu />
              </SheetTrigger>
              <SheetContent
                side="left"
                className="sidebar-shell overflow-y-auto p-4"
                showCloseButton={false}
              >
                <div className="flex items-center justify-between">
                  <SheetTitle className="text-white">Menu</SheetTitle>
                  <Button
                    variant="outline"
                    onClick={() => setMobileOpen(false)}
                  >
                    Luk
                  </Button>
                </div>
                <SheetDescription className="text-slate-300">
                  WebshopToolbox
                </SheetDescription>
                <div className="mt-3 text-sm text-slate-300">
                  <WebshopSelector />
                </div>
                <nav
                  className="flex-1 px-3 py-4"
                  aria-label="Primær navigation"
                >
                  <button
                    className={`nav-item w-full ${view === 'dashboard' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('dashboard');
                    }}
                  >
                    <LayoutDashboard />
                    Dashboard
                  </button>
                  <p className="nav-label mt-7">Bogføring</p>
                  <button
                    className={`nav-item w-full ${view === 'orders' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setOrderOffset(0);
                      setView('orders');
                    }}
                  >
                    <PackageCheck />
                    Salg
                  </button>
                  <button
                    className={`nav-item w-full ${view === 'refunds' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('refunds');
                    }}
                  >
                    <RotateCcw />
                    Tilbagebetalinger
                  </button>
                  <button
                    className={`nav-item w-full ${view === 'payouts' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('payouts');
                    }}
                  >
                    <HandCoins />
                    Udbetalinger
                  </button>
                  <button
                    className={`nav-item w-full ${view === 'inventory' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('inventory');
                    }}
                  >
                    <Warehouse />
                    Lager
                  </button>
                  <p className="nav-label mt-7">Dokumenter</p>
                  <button
                    className={`nav-item w-full ${view === 'invoices' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setOrderOffset(0);
                      setView('invoices');
                    }}
                  >
                    <FileText />
                    Fakturaer
                  </button>
                  <button
                    className={`nav-item w-full ${view === 'documents' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('documents');
                    }}
                  >
                    <BookOpenCheck />
                    Udbetalingsrapporter
                  </button>
                  <p className="nav-label mt-7">Tools</p>
                  <button
                    className={`nav-item w-full ${view === 'performance' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('performance');
                    }}
                  >
                    <Activity />
                    Performance
                  </button>
                  <button
                    className={`nav-item w-full ${view === 'shipments' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('shipments');
                    }}
                  >
                    <Truck />
                    Forsendelser
                  </button>
                  <button
                    className={`nav-item w-full ${view === 'packaging' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('packaging');
                    }}
                  >
                    <Boxes />
                    Emballage
                  </button>
                  <button
                    className={`nav-item w-full ${view === 'feeds' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('feeds');
                    }}
                  >
                    <Rss />
                    Produktfeeds
                  </button>
                  <CustomAppsNav
                    apps={customApps}
                    active={view === 'custom-app' ? customAppId : null}
                    onOpen={openCustomApp}
                  />
                  <p className="nav-label mt-7">System</p>
                  <button
                    className={`nav-item w-full ${view === 'support' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('support');
                    }}
                  >
                    <Lightbulb />
                    Support
                  </button>
                  <button
                    className={`nav-item w-full ${view === 'settings' ? 'active' : ''}`}
                    onClick={() => {
                      setMobileOpen(false);
                      setView('settings');
                    }}
                  >
                    <Settings2 />
                    Indstillinger
                  </button>
                </nav>
                <div className="mx-3 mb-3 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                  <img
                    src="/brand/webshoptoolbox-logo.png"
                    alt="WebshopToolbox"
                    className="h-auto w-full"
                  />
                </div>
              </SheetContent>
            </Sheet>
            <img
              src="/brand/webshoptoolbox-logo.png"
              alt="WebshopToolbox"
              className="w-[105px]"
            />
          </div>
          <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
            <WebshopSelector />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell
              onReporting={() => {
                setPackagingEntry((p) => ({
                  tab: 'reporting',
                  key: p.key + 1,
                }));
                setView('packaging');
              }}
            />
            <CustomerIdentity />
          </div>
        </header>
        <Suspense fallback={viewLoading}>
          {customApp && <CustomAppPage key={customApp.id} app={customApp} />}
          {view === 'performance' && (
            <Performance
              onIntegrations={() => {
                setIntegrationTarget(null);
                setSettingsTab('integrations');
                setView('settings');
              }}
            />
          )}
          {view === 'dashboard' && (
            <Dashboard
              onIntegrations={(provider) => {
                setIntegrationTarget(provider ?? null);
                setSettingsTab('integrations');
                setView('settings');
              }}
              onOpen={(target) => {
                // Markets are set up under Indstillinger → Faktura-afsendelse.
                if (target === 'settings') setSettingsTab('invoice-email');
                setView(target);
              }}
            />
          )}
          {currentRequirement && connections === null && !connectionsError && (
            <div className="mx-auto max-w-[1440px] px-5 py-16 text-center text-sm text-muted-foreground">
              Kontrollerer integrationer…
            </div>
          )}
          {currentRequirement && connectionsError && (
            <div className="mx-auto max-w-[1440px] px-5 py-16 text-center">
              <p role="alert" className="text-sm text-red-700">
                {connectionsError}
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => void refreshConnections()}
              >
                Prøv igen
              </Button>
            </div>
          )}
          {currentRequirement && connections && !integrationAvailable(view) && (
            <IntegrationRequired
              title={currentRequirement.title}
              providers={currentRequirement.providers}
              onIntegrations={() => {
                setIntegrationTarget(
                  currentRequirement.providers.length === 1 &&
                    currentRequirement.providers[0] === 'shopify'
                    ? 'shopify'
                    : null,
                );
                setSettingsTab('integrations');
                setView('settings');
              }}
            />
          )}
          {view === 'orders' && integrationAvailable('orders') && (
            <div
              className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9"
              id="orders"
            >
              <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
                <div>
                  <p className="eyebrow">Shopify · Dinero</p>
                  <PageTitle title="Salg" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Følg salg, realisering og bogføring ét sted.
                  </p>
                </div>
                <RefreshButton onRefresh={syncOrders} />
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
              {orderError && (
                <p role="alert" className="mb-4 text-red-700">
                  {orderError}
                </p>
              )}
              <p className="mb-4 text-sm text-muted-foreground">
                Automatisk overførsel og bogføring følger valgene under
                Indstillinger. Bogføringsstatus viser den senest registrerede
                behandling i Dinero.
              </p>
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
                  <label className="flex w-full flex-col gap-1.5 text-sm sm:w-56">
                    <span>Periode</span>
                    <NativeSelect
                      aria-label="Periode for salg"
                      value={orderPeriod}
                      onChange={(event) => {
                        setOrderPeriod(event.target.value as OrderPeriod);
                        setOrderOffset(0);
                        setSalesOrders([]);
                        setOrderTotal(0);
                        setOrderError('');
                      }}
                    >
                      {orderPeriods.map(([value, label]) => (
                        <NativeSelectOption key={value} value={value}>
                          {label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  {orderCountries.length > 1 && (
                    <label className="flex w-full flex-col gap-1.5 text-sm sm:w-48">
                      <span>Land</span>
                      <NativeSelect
                        aria-label="Land for salg"
                        value={orderCountry}
                        onChange={(event) => {
                          setOrderCountry(event.target.value);
                          setOrderOffset(0);
                          setSalesOrders([]);
                          setOrderTotal(0);
                          setOrderError('');
                        }}
                      >
                        <NativeSelectOption value="">
                          Alle lande
                        </NativeSelectOption>
                        {orderCountries.map((code) => (
                          <NativeSelectOption key={code} value={code}>
                            {countryName(code)}
                          </NativeSelectOption>
                        ))}
                        <NativeSelectOption value="unknown">
                          Ukendt land
                        </NativeSelectOption>
                      </NativeSelect>
                    </label>
                  )}
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
                    {!filtered.length && (
                      <TableRow>
                        <TableCell colSpan={8} className="p-8 text-center">
                          {orderError
                            ? 'Ordrerne kunne ikke vises.'
                            : 'Ingen ordrer i det valgte udsnit.'}
                        </TableCell>
                      </TableRow>
                    )}
                    {filtered.map((order) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        labels={labelsEnabled}
                        onBooked={() => setOrderRevision((value) => value + 1)}
                      />
                    ))}
                  </TableBody>
                </Table>
                {orderPagination}
              </section>
            </div>
          )}
          {view === 'invoices' && integrationAvailable('invoices') && (
            <Invoices
              pagination={orderPagination}
              orders={salesOrders}
              onGenerated={(count) =>
                notify(
                  `${count} faktura${count === 1 ? '' : 'er'} er genereret`,
                )
              }
              onSync={syncOrders}
            />
          )}
          {view === 'documents' && integrationAvailable('documents') && (
            <Documents syncRevision={syncState.revision} />
          )}
          {view === 'refunds' && integrationAvailable('refunds') && (
            // Refunds per order across all gateways; the providers' own refund records stay available for control.
            <Tabs defaultValue="orders" className="gap-0">
              <div className="mx-auto w-full max-w-[1440px] px-5 pt-6 md:px-8">
                <TabsList aria-label="Tilbagebetalinger">
                  <TabsTrigger value="orders" className="px-4">
                    Ordrer
                  </TabsTrigger>
                  <TabsTrigger value="providers" className="px-4">
                    Udbyderposter
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="orders">
                <OrderRefunds syncRevision={syncState.revision} />
              </TabsContent>
              <TabsContent value="providers">
                <Payments syncRevision={syncState.revision} kind="refund" />
              </TabsContent>
            </Tabs>
          )}
          {view === 'payouts' && integrationAvailable('payouts') && (
            <ProviderLedger kind="payout" syncRevision={syncState.revision} />
          )}
          {view === 'inventory' && integrationAvailable('inventory') && (
            <Inventory />
          )}
          {view === 'packaging' && integrationAvailable('packaging') && (
            <Packaging
              key={packagingEntry.key}
              initialTab={packagingEntry.tab}
              onIntegrations={() => {
                setIntegrationTarget('emballage');
                setSettingsTab('integrations');
                setView('settings');
              }}
            />
          )}
          {view === 'feeds' && integrationAvailable('feeds') && (
            <ProductFeeds />
          )}
          {view === 'shipments' && integrationAvailable('shipments') && (
            <Shipments
              onIntegrations={() => {
                setIntegrationTarget('shopify');
                setSettingsTab('integrations');
                setView('settings');
              }}
            />
          )}
          {view === 'support' && <Support />}
          {view === 'settings' && (
            <div>
              <div className="mx-auto w-full max-w-[1440px] px-5 pt-6 md:px-8">
                <Tabs
                  value={settingsTab}
                  onValueChange={(value) =>
                    setSettingsTab(value as typeof settingsTab)
                  }
                >
                  <div className="overflow-x-auto pb-1">
                    <TabsList aria-label="Indstillinger">
                      <TabsTrigger value="dashboard" className="px-4">
                        Generelt
                      </TabsTrigger>
                      <TabsTrigger value="integrations" className="px-4">
                        Integrationer og kontoplan
                      </TabsTrigger>
                      <TabsTrigger value="invoice-email" className="px-4">
                        Faktura-afsendelse
                      </TabsTrigger>
                      <TabsTrigger value="inventory" className="px-4">
                        Lager
                      </TabsTrigger>
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
                automation={automation}
                setAutomation={setAutomation}
                invoiceEmail={invoiceEmail}
                setInvoiceEmail={setInvoiceEmail}
                syncIntervalMinutes={syncIntervalMinutes}
                setSyncIntervalMinutes={setSyncIntervalMinutes}
                ready={settingsReady}
                saving={settingsSaving}
                message={settingsMessage}
                onConnectionsChanged={refreshConnections}
                onSettingsChanged={loadSettings}
              />
            </div>
          )}
        </Suspense>
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
