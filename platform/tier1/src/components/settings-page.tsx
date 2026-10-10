'use client';
// Indstillinger: general settings, integrations and chart of accounts, invoice sending and inventory.
// Moved out of app/page.tsx unchanged.
import { formatDateTime } from '@/lib/format';
import { useCapabilities } from '@/platform/capabilities';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useAddingWebshop, useWorkspace } from '@/platform/workspace';
import { IntegrationStartDate } from '@/components/integration-start-date';
import {
  IntegrationLibrary,
  RemoveIntegration,
  useIntegrationLibrary,
} from '@/components/integration-library';
import { IntegrationCard } from '@/components/integration-card';
import { FlatpayConnection } from '@/components/flatpay-connection';
import { EmballageConnection } from '@/components/emballage-connection';
import { ShipmondoConnection } from '@/components/shipmondo-connection';
import { ViaBillConnection } from '@/components/viabill-connection';
import { PensopayConnection } from '@/components/pensopay-connection';
import { HistorySettings } from '@/components/history-settings';
import { InvoiceSender } from '@/components/invoice-sender';
import { InvoiceIssuer } from '@/components/invoice-issuer';
import { vatCodeOptions } from '@/lib/vat-code-options';
import {
  type Accounts,
  type Automation,
  type InvoiceEmailSettings,
} from '@/lib/admin-settings';
import { supportedModules } from '@/lib/integration-visibility';
import { syncIntervals } from '@/lib/sync-schedule';
import { InvoiceMarkets } from '@/components/invoice-markets';
import { WebshopInvoiceProfile } from '@/components/webshop-invoice-profile';
import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  AlertTriangle,
  ChevronDown,
  Landmark,
  Save,
  ShoppingBag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

export function Settings({
  mode,
  initialIntegration,
  accounts,
  setAccounts,
  onSave,
  onConnectionsChanged,
  onSettingsChanged,
  automation,
  setAutomation,
  invoiceEmail,
  setInvoiceEmail,
  syncIntervalMinutes,
  setSyncIntervalMinutes,
  savedIntervalMinutes,
  ready,
  saving,
  message,
}: {
  mode: 'dashboard' | 'integrations' | 'invoice-email' | 'inventory';
  initialIntegration: 'shopify' | 'dinero' | 'emballage' | null;
  accounts: Accounts;
  setAccounts: React.Dispatch<React.SetStateAction<Accounts>>;
  onSave: () => Promise<void>;
  automation: Automation;
  setAutomation: React.Dispatch<React.SetStateAction<Automation>>;
  invoiceEmail: InvoiceEmailSettings;
  setInvoiceEmail: React.Dispatch<React.SetStateAction<InvoiceEmailSettings>>;
  syncIntervalMinutes: number;
  setSyncIntervalMinutes: React.Dispatch<React.SetStateAction<number>>;
  savedIntervalMinutes?: number;
  ready: boolean;
  saving: boolean;
  message: string;
  onConnectionsChanged: () => Promise<void>;
  onSettingsChanged?: () => Promise<void>;
}) {
  const capabilities = useCapabilities();
  const workspace = useWorkspace(),
    adding = useAddingWebshop();
  // Another webshop is added from here by an administrator; support only looks.
  const canAddWebshop =
    workspace.company.role === 'admin' && !workspace.user.support;
  const [chart, setChart] = useState<
    Array<{ number: string; name: string; vatCode?: string }>
  >([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartMessage, setChartMessage] = useState('');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [connecting, setConnecting] = useState<'shopify' | 'dinero' | null>(
    null,
  );
  const library = useIntegrationLibrary();
  const [expandedShipmondo, setExpandedShipmondo] = useState(false);
  const [expandedEmballage, setExpandedEmballage] = useState(
    initialIntegration === 'emballage',
  );
  const [expandedFlatpay, setExpandedFlatpay] = useState(false);
  const [expandedViaBill, setExpandedViaBill] = useState(false);
  const [expandedPensopay, setExpandedPensopay] = useState(false);
  const [expandedIntegration, setExpandedIntegration] = useState<
    'shopify' | 'dinero' | null
  >(initialIntegration === 'emballage' ? null : initialIntegration);
  useEffect(() => {
    if (mode !== 'integrations' || !initialIntegration) return;
    if (initialIntegration === 'emballage') setExpandedEmballage(true);
    else setExpandedIntegration(initialIntegration);
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(initialIntegration + '-connection-panel')
        ?.scrollIntoView({ block: 'center' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [mode, initialIntegration]);
  const [connected, setConnected] = useState<Record<string, string>>({});
  // Danmark's sections reload when the webshop switches between shared and own invoice settings.
  const [profileRevision, setProfileRevision] = useState(0);
  const [shopify, setShopify] = useState({
    shop: '',
    clientId: '',
    clientSecret: '',
  });
  const [dinero, setDinero] = useState({
    clientId: '',
    clientSecret: '',
    apiKey: '',
    organizationId: '',
  });
  useEffect(() => {
    fetch('/api/integrations')
      .then(
        (response) =>
          response.json() as Promise<{
            integrations: Array<{ provider: string; display_name: string }>;
          }>,
      )
      .then((data) =>
        setConnected(
          Object.fromEntries(
            (data.integrations ?? []).map(
              (item: { provider: string; display_name: string }) => [
                item.provider,
                item.display_name,
              ],
            ),
          ),
        ),
      )
      .catch(() =>
        setConnectionMessage('Forbindelsesstatus kunne ikke hentes'),
      );
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
        body: JSON.stringify({
          provider,
          ...(provider === 'shopify' ? shopify : dinero),
        }),
      });
      const data = (await response.json()) as {
        name: string;
        webshopId?: string;
        created?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error);
      setConnected((current) => ({ ...current, [provider]: data.name }));
      await onConnectionsChanged();
      void library.refresh();
      if (provider === 'shopify')
        setShopify((current) => ({ ...current, clientSecret: '' }));
      else
        setDinero((current) => ({ ...current, clientSecret: '', apiKey: '' }));
      if (provider === 'dinero') {
        setChart([]);
        await loadChart(false);
      }
      setConnectionMessage(
        `${provider === 'shopify' ? 'Shopify' : 'Dinero'} er testet og forbundet med læseadgang`,
      );
      if (provider === 'shopify' && data.created) {
        sessionStorage.setItem('toolbox-selected-shop', data.webshopId!);
        window.location.reload();
      }
    } catch (error) {
      setConnectionMessage(
        error instanceof Error
          ? error.message
          : 'Forbindelsen kunne ikke oprettes',
      );
    } finally {
      setConnecting(null);
    }
  };
  const loadChart = async (sync = false) => {
    setLoadingChart(true);
    setChartMessage('');
    try {
      const response = await fetch('/api/dinero/accounts', {
        method: sync ? 'POST' : 'GET',
        cache: 'no-store',
      });
      const data = (await response.json()) as {
        accounts: Array<{
          number: string;
          name: string;
          vatCode?: string;
          hidden?: boolean;
        }>;
        fetchedAt: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error);
      setChart(data.accounts.filter((account) => !account.hidden));
      setChartMessage(
        data.fetchedAt
          ? `${data.accounts.length} konti gemt · Senest synkroniseret ${formatDateTime(data.fetchedAt)}`
          : 'Ingen kontoplan gemt endnu. Vælg Synkronisér kontoplan.',
      );
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
  useEffect(() => {
    void loadChart(false);
  }, []);
  const vatCodes = vatCodeOptions(chart);
  const Field = ({ name, label }: { name: keyof Accounts; label: string }) => (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {name === 'vatCode' || name === 'noVatCode' ? (
        <>
          <NativeSelect
            className="mt-1.5 w-full"
            value={accounts[name]}
            disabled={loadingChart}
            onChange={(event) =>
              setAccounts((current) => ({
                ...current,
                [name]: event.target.value,
              }))
            }
          >
            <NativeSelectOption value="">Vælg momskode</NativeSelectOption>
            {name === 'noVatCode' && (
              <NativeSelectOption value="NONE">Ingen moms</NativeSelectOption>
            )}
            {accounts[name] &&
              !(name === 'noVatCode' && accounts[name] === 'NONE') &&
              !vatCodes.includes(accounts[name]) && (
                <NativeSelectOption value={accounts[name]} disabled>
                  {accounts[name]} (nuværende valg – ikke i listen)
                </NativeSelectOption>
              )}
            {vatCodes.map((code) => (
              <NativeSelectOption key={code} value={code}>
                {code}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {!vatCodes.length && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Ingen momskoder i den gemte kontoplan. Synkronisér kontoplanen fra
              Dinero.
            </span>
          )}
          {name === 'noVatCode' && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Vælg Ingen moms til dansk salg uden moms og en salgskonto uden
              momskode. Udenlandsk salg kræver særskilt afklaring.
            </span>
          )}
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
          {mode === 'dashboard'
            ? 'Indstillinger'
            : mode === 'integrations'
              ? 'Integrationer og kontoplan'
              : mode === 'invoice-email'
                ? 'Faktura-afsendelse'
                : 'Lager'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === 'dashboard'
            ? 'Overblik over drift, fejl og automatisk behandling.'
            : mode === 'integrations'
              ? 'Forbind systemerne, vælg historik og bestem hvordan posteringerne skal lande i Dinero.'
              : mode === 'invoice-email'
                ? 'Styr mailafsendelse, tilpas skabelonen og send en afgrænset test.'
                : 'Vælg lagerkonti og styr automatisk nedskrivning ved afsendte salg.'}
        </p>
      </div>
      {mode === 'integrations' &&
        library.selection?.selected.includes('dinero') &&
        chartMessage &&
        !chart.length && (
          <div
            className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Der kræves handling</p>
              <p className="mt-1 text-xs">{chartMessage}</p>
            </div>
          </div>
        )}
      {mode === 'dashboard' && (
        <>
          <fieldset disabled={!ready || saving} className="min-w-0">
            <h2 className="mb-3 text-sm font-semibold">Automatik og bilag</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Styr automatisk behandling og vedhæftning af bilag.
            </p>
            {!ready && !message && (
              <p role="status" className="mb-4 text-sm">
                Indlæser fælles indstillinger…
              </p>
            )}
            {message && (
              <p role="status" className="mb-4 rounded-xl border p-4 text-sm">
                {message}
              </p>
            )}
            <section className="mb-8 overflow-hidden rounded-2xl border bg-white">
              <div className="flex flex-col justify-between gap-4 border-b p-5 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm font-semibold">
                    Synkroniseringsinterval
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Gælder ordrer/salg og tilbagebetalinger. Vælg interval og
                    tryk Gem indstillinger. Udbetalinger hentes hver time og
                    hvert kvarter, når en udbetaling er på vej. Lager hentes
                    hver 4. time og emballagehistorik én gang i døgnet.
                    “Opdatér” på den enkelte side henter altid med det samme.
                  </p>
                </div>
                <label className="w-full sm:w-52">
                  <span className="mb-2 block text-xs">
                    {savedIntervalMinutes === undefined
                      ? 'Aktivt interval hentes…'
                      : `Gemt interval: ${savedIntervalMinutes} min.`}
                    {savedIntervalMinutes !== undefined &&
                      savedIntervalMinutes !== syncIntervalMinutes && (
                        <strong className="mt-1 block text-amber-700">
                          Ændringen er ikke gemt endnu
                        </strong>
                      )}
                  </span>
                  <span className="sr-only">Synkroniseringsinterval</span>
                  <NativeSelect
                    className="w-full"
                    value={String(syncIntervalMinutes)}
                    onChange={(event) =>
                      setSyncIntervalMinutes(Number(event.target.value))
                    }
                  >
                    {syncIntervals.map((minutes) => (
                      <NativeSelectOption
                        key={minutes}
                        value={String(minutes)}
                      >{`Hvert ${minutes}. minut`}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              </div>
              <div className="flex items-center justify-between border-b p-5">
                <div>
                  <p className="text-sm font-semibold">
                    Upload bilag til regnskabsprogram
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Vedhæft automatisk faktura eller dokumentation til
                    posteringen i Dinero.
                  </p>
                </div>
                <Switch
                  disabled={!capabilities.bookkeeping}
                  checked={automation.attachments}
                  onCheckedChange={(value) =>
                    toggleAutomation('attachments', value)
                  }
                  aria-label="Upload bilag til regnskabsprogram"
                />
              </div>
              <div className="p-5">
                <p className="mb-4 text-sm font-semibold">
                  Automatiske moduler
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      key: 'sales',
                      bookingKey: 'salesBookDinero',
                      label: 'Salg',
                      description: 'Behandl realiserede ordrer',
                    },
                    {
                      key: 'refunds',
                      bookingKey: 'refundsBookDinero',
                      label: 'Tilbagebetalinger',
                      description: 'Behandl gennemførte tilbagebetalinger',
                    },
                    {
                      key: 'payouts',
                      bookingKey: 'payoutsBookDinero',
                      label: 'Udbetalinger',
                      description: 'Behandl udbetalinger fra indløsere',
                    },
                  ].map((module) => (
                    <div
                      key={module.key}
                      className="rounded-xl border bg-muted/30 p-4"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">{module.label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {module.description}
                          </p>
                        </div>
                        <Switch
                          checked={
                            automation[module.key as keyof typeof automation]
                          }
                          onCheckedChange={(value) =>
                            toggleAutomation(
                              module.key as keyof typeof automation,
                              value,
                            )
                          }
                          aria-label={`Automatisk ${module.label}`}
                        />
                      </div>
                      <label className="mt-4 block">
                        <span className="text-xs font-medium text-muted-foreground">
                          Dinero-behandling
                        </span>
                        <NativeSelect
                          className="mt-1.5 w-full"
                          value={
                            automation[
                              module.bookingKey as keyof typeof automation
                            ]
                              ? 'book'
                              : 'draft'
                          }
                          onChange={(event) =>
                            toggleAutomation(
                              module.bookingKey as keyof typeof automation,
                              event.target.value === 'book',
                            )
                          }
                        >
                          <NativeSelectOption value="draft">
                            Opret kun kladde
                          </NativeSelectOption>
                          <NativeSelectOption value="book">
                            Bogfør automatisk
                          </NativeSelectOption>
                        </NativeSelect>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end border-t p-4">
                <Button className="h-10 rounded-xl px-4" onClick={onSave}>
                  <Save />
                  {saving ? 'Gemmer…' : 'Gem indstillinger'}
                </Button>
              </div>
            </section>
          </fieldset>
        </>
      )}
      {/* One tab per country: Danmark is the company's (or the webshop's own) invoice settings, other markets have their own. */}
      {mode === 'invoice-email' && (
        <InvoiceMarkets
          key={profileRevision}
          home={
            <>
              <WebshopInvoiceProfile
                onChanged={async () => {
                  await onSettingsChanged?.();
                  setProfileRevision((value) => value + 1);
                }}
              />
              <InvoiceIssuer />
              <fieldset disabled={!ready || saving} className="min-w-0">
                {!ready && !message && (
                  <p role="status" className="mb-4 text-sm">
                    Indlæser fælles indstillinger…
                  </p>
                )}
                {message && (
                  <p
                    role="status"
                    className="mb-4 rounded-xl border p-4 text-sm"
                  >
                    {message}
                  </p>
                )}
                <section className="mb-8 overflow-hidden rounded-2xl border bg-white">
                  <div className="flex items-center justify-between gap-4 border-b p-5">
                    <div>
                      <h2 className="text-lg font-semibold">2. Mailtekst</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Tilpas emne og besked til kunden.{' '}
                        {capabilities.customerEmail
                          ? 'Automatisk afsendelse følger dit tilvalg her.'
                          : 'Automatisk kundemail er deaktiveret i testmiljøet.'}
                      </p>
                    </div>
                    <Switch
                      disabled={!capabilities.customerEmail}
                      checked={automation.invoiceEmails}
                      onCheckedChange={(value) =>
                        toggleAutomation('invoiceEmails', value)
                      }
                      aria-label="Send faktura automatisk til kunden"
                    />
                  </div>
                  <div className="grid gap-4 p-5">
                    <label>
                      <span className="text-xs font-medium text-muted-foreground">
                        Emne
                      </span>
                      <Input
                        className="mt-1.5"
                        value={invoiceEmail.subject}
                        onChange={(event) =>
                          setInvoiceEmail((current) => ({
                            ...current,
                            subject: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span className="text-xs font-medium text-muted-foreground">
                        Mailtekst
                      </span>
                      <Textarea
                        className="mt-1.5 min-h-40"
                        value={invoiceEmail.body}
                        onChange={(event) =>
                          setInvoiceEmail((current) => ({
                            ...current,
                            body: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Du kan bruge: {'{{kundenavn}}'}, {'{{fakturanummer}}'} og{' '}
                      {'{{ordrenummer}}'}.
                    </p>
                    <div className="border-t pt-4">
                      <h3 className="text-sm font-semibold">Kreditnota</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Sendes sammen med kreditnotaen, når en ordre
                        tilbagebetales.
                      </p>
                    </div>
                    <label>
                      <span className="text-xs font-medium text-muted-foreground">
                        Emne
                      </span>
                      <Input
                        className="mt-1.5"
                        value={invoiceEmail.creditSubject}
                        onChange={(event) =>
                          setInvoiceEmail((current) => ({
                            ...current,
                            creditSubject: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span className="text-xs font-medium text-muted-foreground">
                        Mailtekst
                      </span>
                      <Textarea
                        className="mt-1.5 min-h-40"
                        value={invoiceEmail.creditBody}
                        onChange={(event) =>
                          setInvoiceEmail((current) => ({
                            ...current,
                            creditBody: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Du kan bruge: {'{{kundenavn}}'}, {'{{kreditnotanummer}}'},{' '}
                      {'{{fakturanummer}}'}, {'{{ordrenummer}}'}, {'{{beløb}}'}{' '}
                      og {'{{virksomhedsnavn}}'}.
                    </p>
                  </div>
                  <div className="flex justify-end border-t p-4">
                    <Button className="h-10 rounded-xl px-4" onClick={onSave}>
                      <Save />
                      {saving ? 'Gemmer…' : 'Gem indstillinger'}
                    </Button>
                  </div>
                </section>
              </fieldset>
              <InvoiceSender />
            </>
          }
        />
      )}
      {mode === 'inventory' && (
        <fieldset disabled={!ready || saving} className="min-w-0">
          {message && (
            <p role="status" className="mb-4 rounded-xl border p-4 text-sm">
              {message}
            </p>
          )}
          <section className="overflow-hidden rounded-2xl border bg-white">
            <div className="border-b p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">
                    Automatisk lagerbogføring
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Når en ordre bliver fuldt afsendt, behandles kostprisen som
                    vareforbrug mod lagerkontoen. Kræver gyldige lagerkonti og
                    kostpriser. Vareforbruget følger salgets valg mellem kladde
                    og bogføring.
                  </p>
                </div>
                <Switch
                  disabled={!capabilities.bookkeeping}
                  checked={automation.inventory}
                  onCheckedChange={(value) =>
                    toggleAutomation('inventory', value)
                  }
                  aria-label="Automatisk lagerbogføring"
                />
              </div>
              <label className="mt-4 block max-w-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  Lageroptælling i Dinero
                </span>
                <NativeSelect
                  className="mt-1.5 w-full"
                  value={automation.inventoryBookDinero ? 'book' : 'draft'}
                  onChange={(event) =>
                    toggleAutomation(
                      'inventoryBookDinero',
                      event.target.value === 'book',
                    )
                  }
                >
                  <NativeSelectOption value="draft">
                    Opret kun kladde
                  </NativeSelectOption>
                  <NativeSelectOption value="book">
                    Bogfør automatisk
                  </NativeSelectOption>
                </NativeSelect>
              </label>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <Field name="inventory" label="Konto til varebeholdning" />
              <Field
                name="inventoryAdjustment"
                label="Modkonto til lagerregulering / vareforbrug"
              />
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                Begge konti skal være aktive Dinero-konti uden moms. En
                optælling ændrer først antal i Shopify; bogføring af
                optællingsafvigelsen holdes adskilt fra den løbende
                salgsautomatik.
              </p>
            </div>
            <div className="flex justify-end border-t p-4">
              <Button onClick={onSave}>
                <Save />
                {saving ? 'Gemmer…' : 'Gem indstillinger'}
              </Button>
            </div>
          </section>
        </fieldset>
      )}
      {mode === 'integrations' && (
        <>
          <HistorySettings />
          <IntegrationLibrary
            state={library}
            onAdded={(id) => {
              if (id === 'shipmondo') setExpandedShipmondo(true);
              else if (id === 'flatpay') setExpandedFlatpay(true);
              else if (id === 'viabill') setExpandedViaBill(true);
              else if (id === 'pensopay') setExpandedPensopay(true);
              else if (id === 'emballage') setExpandedEmballage(true);
              else setExpandedIntegration(id);
            }}
          />
          {adding ? (
            <div
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#c8d6a6] bg-[#f4f8ea] p-4"
              role="region"
              aria-label="Ny webshop"
            >
              <div>
                <p className="text-sm font-semibold">Tilføj en ny webshop</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Udfyld Shopify med den nye butiks adresse og appoplysninger.
                  Webshoppen oprettes og vælges, når forbindelsen er testet.
                  Dinero og kontoplanen deles med virksomhedens øvrige webshops.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  const previous = sessionStorage.getItem(
                    'toolbox-previous-shop',
                  );
                  workspace.choose(
                    workspace.webshops.find((shop) => shop.id === previous)
                      ?.id || workspace.webshops[0].id,
                  );
                }}
              >
                Fortryd
              </Button>
            </div>
          ) : (
            canAddWebshop &&
            connected.shopify && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4">
                <p className="text-sm text-muted-foreground">
                  Har virksomheden flere Shopify-butikker? Hver butik tilsluttes
                  som sin egen webshop.
                </p>
                <Button variant="outline" onClick={() => workspace.choose('')}>
                  Tilføj webshop
                </Button>
              </div>
            )
          )}
          <div className="mb-8 grid items-start gap-3 md:grid-cols-2">
            {library.selection?.selected.includes('shipmondo') && (
              <ShipmondoConnection
                initialExpanded={expandedShipmondo}
                onConnected={() => {
                  void library.refresh();
                  void onConnectionsChanged();
                }}
              />
            )}
            {integrations.map(
              ({
                name,
                provider,
                detail,
                icon: Icon,
                connected: isConnected,
              }) => (
                <IntegrationCard
                  key={name}
                  name={name}
                  description={detail}
                  icon={Icon}
                  connected={isConnected}
                  expanded={expandedIntegration === provider}
                  onToggle={() =>
                    setExpandedIntegration((current) =>
                      current === provider ? null : provider,
                    )
                  }
                  panelId={`${provider}-connection-panel`}
                >
                  <p className="mb-4 text-xs text-muted-foreground">
                    {provider === 'shopify'
                      ? 'Den installerede app udveksler automatisk oplysningerne til et kortlivet adgangstoken. Testen læser kun butikkens navn.'
                      : 'Forbind Dinero for at hente økonomi og kontoplan samt overføre bilag.'}
                  </p>
                  {provider === 'shopify' ? (
                    <div className="space-y-3">
                      <Input
                        value={shopify.shop}
                        onChange={(event) =>
                          setShopify((current) => ({
                            ...current,
                            shop: event.target.value,
                          }))
                        }
                        placeholder="butik.myshopify.com"
                        aria-label="Shopify butiksadresse"
                      />
                      <Input
                        value={shopify.clientId}
                        onChange={(event) =>
                          setShopify((current) => ({
                            ...current,
                            clientId: event.target.value,
                          }))
                        }
                        placeholder="Client ID"
                        aria-label="Shopify Client ID"
                      />
                      <Input
                        type="password"
                        autoComplete="off"
                        value={shopify.clientSecret}
                        onChange={(event) =>
                          setShopify((current) => ({
                            ...current,
                            clientSecret: event.target.value,
                          }))
                        }
                        placeholder="Client Secret"
                        aria-label="Shopify Client Secret"
                      />
                      <Button
                        className="w-full"
                        onClick={() => connect('shopify')}
                        disabled={connecting !== null}
                      >
                        {connecting === 'shopify'
                          ? 'Tester…'
                          : isConnected
                            ? 'Test og opdatér forbindelse'
                            : adding
                              ? 'Test og opret webshop'
                              : 'Test og forbind'}
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        value={dinero.clientId}
                        onChange={(event) =>
                          setDinero((current) => ({
                            ...current,
                            clientId: event.target.value,
                          }))
                        }
                        placeholder="Client ID"
                        aria-label="Dinero Client ID"
                      />
                      <Input
                        type="password"
                        autoComplete="off"
                        value={dinero.clientSecret}
                        onChange={(event) =>
                          setDinero((current) => ({
                            ...current,
                            clientSecret: event.target.value,
                          }))
                        }
                        placeholder="Client secret"
                        aria-label="Dinero Client secret"
                      />
                      <Input
                        type="password"
                        autoComplete="off"
                        value={dinero.apiKey}
                        onChange={(event) =>
                          setDinero((current) => ({
                            ...current,
                            apiKey: event.target.value,
                          }))
                        }
                        placeholder="API-nøgle"
                        aria-label="Dinero API-nøgle"
                      />
                      <Input
                        value={dinero.organizationId}
                        onChange={(event) =>
                          setDinero((current) => ({
                            ...current,
                            organizationId: event.target.value,
                          }))
                        }
                        placeholder="Organisation-ID"
                        aria-label="Dinero organisation-ID"
                      />
                      <Button
                        className="sm:col-span-2"
                        onClick={() => connect('dinero')}
                        disabled={connecting !== null}
                      >
                        {connecting === 'dinero'
                          ? 'Tester…'
                          : isConnected
                            ? 'Test og opdatér forbindelse'
                            : 'Test og forbind'}
                      </Button>
                    </div>
                  )}
                  {/* Start dates belong to a webshop; a new one gets them once it exists. */}
                  {!(adding && provider === 'shopify') && (
                    <IntegrationStartDate provider={provider} />
                  )}
                  {connectionMessage && (
                    <p className="mt-3 text-sm text-[#5d712f]" role="status">
                      {connectionMessage}
                    </p>
                  )}
                  {provider === 'shopify' && (
                    <div className="mt-4 rounded-xl border bg-white p-4">
                      <p className="mb-3 text-sm font-semibold">
                        Bogføring af Shopify Payments
                      </p>
                      <Field
                        name="shopifyPaymentsClearing"
                        label="Mellemregningskonto"
                      />
                    </div>
                  )}
                </IntegrationCard>
              ),
            )}
            {library.selection?.selected.includes('flatpay') && (
              <FlatpayConnection
                accountField={
                  <Field name="flatpayClearing" label="Mellemregningskonto" />
                }
                initialExpanded={expandedFlatpay}
                onConnected={() => {
                  void library.refresh();
                  void onConnectionsChanged();
                }}
                footer={
                  <RemoveIntegration state={library} provider="flatpay" />
                }
              />
            )}
            {library.selection?.selected.includes('emballage') && (
              <EmballageConnection
                initialExpanded={expandedEmballage}
                onConnected={() => {
                  void library.refresh();
                }}
                footer={
                  <RemoveIntegration state={library} provider="emballage" />
                }
              />
            )}
            {library.selection?.selected.includes('viabill') && (
              <ViaBillConnection
                initialExpanded={expandedViaBill}
                onConnected={() => {
                  void library.refresh();
                  void onConnectionsChanged();
                }}
                accountField={
                  <Field name="viaBillClearing" label="Mellemregningskonto" />
                }
                footer={
                  <RemoveIntegration state={library} provider="viabill" />
                }
              />
            )}
            {library.selection?.selected.includes('pensopay') && (
              <PensopayConnection
                initialExpanded={expandedPensopay}
                onConnected={() => {
                  void library.refresh();
                  void onConnectionsChanged();
                }}
                footer={
                  <RemoveIntegration state={library} provider="pensopay" />
                }
              />
            )}
          </div>
          {(library.selection?.selected.includes('dinero') ||
            Boolean(connected.dinero)) && (
            <fieldset disabled={!ready || saving} className="min-w-0">
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
                        Konti bruges, når ordrer, fragt og refunderinger
                        bogføres.
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
                    <Field
                      name="noVatCode"
                      label="Momskode for salg uden moms"
                    />
                  </div>
                  <div>
                    <h3 className="mb-3 border-b pb-3 font-medium text-[#c06452]">
                      Kontoplan for salg
                    </h3>
                    <div className="space-y-4">
                      <Field name="goodsVat" label="Salg af varer med moms" />
                      <Field
                        name="goodsNoVat"
                        label="Salg af varer uden moms"
                      />
                      <Field
                        name="shippingVat"
                        label="Salg af fragt med moms"
                      />
                      <Field
                        name="shippingNoVat"
                        label="Salg af fragt uden moms"
                      />
                      <Field
                        name="servicesVat"
                        label="Salg af ydelser med moms"
                      />
                      <Field
                        name="servicesNoVat"
                        label="Salg af ydelser uden moms"
                      />
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
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}
