'use client';
import { TestModeNote } from '@/components/test-mode-note';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ShoppingBag,
  Landmark,
  CreditCard,
  PackageCheck,
  Plus,
  Library,
  Check,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  integrationCatalog,
  type IntegrationId,
  type IntegrationSelection,
} from '@/lib/integration-catalog';
export function useIntegrationLibrary() {
  const [selection, setSelection] = useState<IntegrationSelection | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<IntegrationId | null>(null);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++revision.current;
    try {
      const response = await fetch('/api/integrations/selection', {
        cache: 'no-store',
      });
      const data = (await response.json()) as IntegrationSelection & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          data.error || 'Valgte integrationer kunne ikke hentes.',
        );
      if (version === revision.current) {
        setSelection(data);
        setError('');
      }
    } catch (e) {
      if (version === revision.current)
        setError(
          e instanceof Error
            ? e.message
            : 'Valgte integrationer kunne ikke hentes.',
        );
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  const change = async (provider: IntegrationId, action: 'add' | 'remove') => {
    ++revision.current;
    setBusy(provider);
    setError('');
    try {
      const response = await fetch('/api/integrations/selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, action }),
      });
      const data = (await response.json()) as IntegrationSelection & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || 'Valget kunne ikke gemmes.');
      setSelection(data);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Valget kunne ikke gemmes.');
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { selection, error, busy, refresh, change };
}
type State = ReturnType<typeof useIntegrationLibrary>;
const icons = {
  flatpay: CreditCard,
  shopify: ShoppingBag,
  dinero: Landmark,
  viabill: CreditCard,
  pensopay: CreditCard,
  emballage: PackageCheck,
};
export function IntegrationLibrary({
  state,
  onAdded,
}: {
  state: State;
  onAdded: (id: IntegrationId) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Dine integrationer</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Tilføj de tjenester, du vil bruge. Valget gemmes fælles for alle
            enheder.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!state.selection || state.busy !== null}
          onClick={() => setOpen(true)}
        >
          <Plus />
          Tilføj integration
        </Button>
      </div>
      {state.error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {state.error}
          <Button
            variant="outline"
            size="sm"
            className="ml-3"
            disabled={state.busy !== null}
            onClick={() => void state.refresh()}
          >
            Hent igen
          </Button>
        </div>
      )}
      {!state.selection && !state.error && (
        <p className="mb-4 text-sm text-muted-foreground">
          Henter dine integrationer…
        </p>
      )}
      {state.selection?.selected.length === 0 && (
        <div className="mb-6 rounded-2xl border border-dashed bg-white p-8 text-center">
          <Library className="mx-auto mb-3 size-8 text-[#9b7742]" />
          <h3 className="font-semibold">Vælg din første integration</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Åbn biblioteket, og tilføj den tjeneste, du vil forbinde.
          </p>
          <Button className="mt-4" onClick={() => setOpen(true)}>
            <Plus />
            Åbn integrationsbibliotek
          </Button>
        </div>
      )}
      <TestModeNote>
        Testmiljøet tillader kontrol og datahentning. Bogføring og ekstern
        indberetning er blokeret.
      </TestModeNote>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Integrationsbibliotek</SheetTitle>
            <SheetDescription>
              Tilføj en integration, og forbind derefter din konto under Dine
              integrationer.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 p-4">
            {state.error && (
              <p
                role="alert"
                className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
              >
                {state.error}
              </p>
            )}
            {integrationCatalog.map((item) => {
              const Icon = icons[item.id],
                selected = state.selection?.selected.includes(item.id);
              return (
                <article
                  key={item.id}
                  className="rounded-2xl border bg-white p-5"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-xl bg-[#f4eadc] text-[#8a6636]">
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <h3 className="font-semibold">{item.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {item.category}
                      </p>
                    </div>
                  </div>
                  <p className="my-4 text-sm text-muted-foreground">
                    {item.description}
                  </p>
                  <Button
                    className="w-full"
                    variant={selected ? 'outline' : 'default'}
                    disabled={selected || state.busy !== null}
                    onClick={async () => {
                      if (await state.change(item.id, 'add')) {
                        setOpen(false);
                        onAdded(item.id);
                      }
                    }}
                  >
                    {selected ? <Check /> : <Plus />}
                    {selected
                      ? 'Tilføjet'
                      : state.busy === item.id
                        ? 'Tilføjer…'
                        : 'Tilføj integration'}
                  </Button>
                </article>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
export function RemoveIntegration({
  state,
  provider,
  disabled = false,
}: {
  state: State;
  provider: IntegrationId;
  disabled?: boolean;
}) {
  if (!state.selection || state.selection.connected.includes(provider))
    return null;
  return (
    <div className="flex justify-end px-3 py-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || state.busy !== null}
        onClick={() => void state.change(provider, 'remove')}
      >
        <Trash2 className="size-3.5" />
        Fjern fra oversigt
      </Button>
    </div>
  );
}
