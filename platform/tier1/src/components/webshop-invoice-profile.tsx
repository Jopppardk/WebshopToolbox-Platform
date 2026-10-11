// Danmark's tab, Indstillinger → Faktura-afsendelse: whether the selected webshop invoices with the company's
// settings or with its own (company details, design, logo, mail texts and sender from its own domain).
// With several webshops the choice is shown as two cards, and a bar says which invoice is being edited and
// which webshops a change reaches.
import { listNames } from '@/lib/format';
import { useEffect, useState } from 'react';
import { Building2, Store } from 'lucide-react';
import { tier1Fetch as fetch, tier1FetchFor } from '@/platform/transport';
import { useWorkspace } from '@/platform/workspace';
import { useConfirm } from '@/components/confirm-dialog';

export function WebshopInvoiceProfile({
  onChanged,
}: {
  onChanged: () => void | Promise<void>;
}) {
  const { webshops, webshopId, company, user } = useWorkspace();
  const [own, setOwn] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    // The other webshops' choice, to name the webshops that use the shared invoice. Unknown when not readable.
    [others, setOthers] = useState<Record<string, boolean | null>>({});
  const { confirm, dialog } = useConfirm();
  useEffect(() => {
    void fetch('/api/invoices/settings')
      .then(async (r) => {
        const d = (await r.json()) as { own?: boolean; error?: string };
        if (!r.ok) throw Error(d.error);
        setOwn(d.own === true);
      })
      .catch((e: Error) => setMessage(e.message));
  }, []);
  useEffect(() => {
    for (const shop of webshops)
      if (shop.id !== webshopId)
        void tier1FetchFor(shop.id, '/api/invoices/settings')
          .then(async (r) => {
            const d = (await r.json()) as { own?: boolean };
            return r.ok ? d.own === true : null;
          })
          .catch(() => null)
          .then((value) =>
            setOthers((current) => ({ ...current, [shop.id]: value })),
          );
  }, [webshops, webshopId]);
  const name = webshops.find((s) => s.id === webshopId)?.name || 'webshoppen';
  // Only relevant with more than one webshop, or when this one already has its own.
  if (!webshopId || own === null || (webshops.length < 2 && !own)) return null;
  const shared = webshops
    .filter((shop) =>
      shop.id === webshopId ? !own : others[shop.id] === false,
    )
    .map((shop) => shop.name);
  const unknown = webshops.some(
    (shop) => shop.id !== webshopId && others[shop.id] == null,
  );
  const sharedText = shared.length
    ? `Bruges af ${listNames(shared)}${unknown ? ' m.fl.' : ''}.`
    : 'Bruges af webshops uden egen faktura.';
  const locked = busy || company.role !== 'admin' || !!user.support;
  async function change(next: boolean) {
    if (next === own || locked) return;
    if (
      !next &&
      !(await confirm({
        title: 'Brug virksomhedens fælles opsætning?',
        message: `${name}s egne firmaoplysninger, design, logo, mailtekster og afsender slettes. Nye fakturaer og mails bruger virksomhedens fælles opsætning.`,
        confirmLabel: 'Brug fælles opsætning',
      }))
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/invoices/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ own: next }),
      });
      const d = (await r.json()) as { own?: boolean; error?: string };
      if (!r.ok) throw Error(d.error);
      setOwn(next);
      await onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Kunne ikke ændres.');
    } finally {
      setBusy(false);
    }
  }
  const option = (active: boolean) =>
    'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition disabled:cursor-not-allowed ' +
    (active
      ? 'border-[#9a7440] bg-[#fbf7f0] ring-1 ring-[#9a7440]'
      : 'bg-white hover:border-[#c09960] disabled:hover:border-border');
  return (
    <>
      <section
        aria-label="Fakturaopsætning for webshoppen"
        className="mb-4 rounded-2xl border bg-white p-5"
      >
        <h2 className="text-sm font-semibold">
          Hvilken faktura bruger {name}?
        </h2>
        <div
          role="radiogroup"
          aria-label={`Faktura for ${name}`}
          className="mt-3 grid gap-3 md:grid-cols-2"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!own}
            disabled={locked}
            className={option(!own)}
            onClick={() => void change(false)}
          >
            <Building2 className="mt-0.5 size-5 shrink-0 text-[#9a7440]" />
            <span>
              <span className="block text-sm font-semibold">
                Fælles faktura for {company.name}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Én opsætning for alle webshops uden egen faktura. {sharedText}
              </span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={own}
            disabled={locked}
            className={option(own)}
            onClick={() => void change(true)}
          >
            <Store className="mt-0.5 size-5 shrink-0 text-[#9a7440]" />
            <span>
              <span className="block text-sm font-semibold">
                Egen faktura for {name}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Egne firmaoplysninger, logo, mailtekster og afsender fra eget
                domæne. Starter som en kopi af den fælles faktura.
              </span>
            </span>
          </button>
        </div>
        {message && (
          <p role="alert" className="mt-3 text-xs text-red-700">
            {message}
          </p>
        )}
        {dialog}
      </section>
      <EditingBar
        own={own}
        text={
          own
            ? `Ændringer herunder gælder kun ${name}. Andre markeder for ${name} arver dem.`
            : `Ændringer herunder gælder alle webshops, der bruger den fælles faktura. ${sharedText}`
        }
        label={own ? `fakturaen for ${name}` : 'den fælles faktura'}
      />
    </>
  );
}

// Stays in view while the sections below are edited.
export function EditingBar({
  own,
  label,
  text,
}: {
  own: boolean;
  label: string;
  text: string;
}) {
  return (
    <div
      role="note"
      aria-label="Du retter"
      className={
        'sticky top-2 z-10 mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm ' +
        (own
          ? 'border-[#9a7440] bg-[#f7efe3] text-[#5c4320]'
          : 'border-sky-200 bg-sky-50 text-sky-950')
      }
    >
      {own ? (
        <Store className="mt-0.5 size-4 shrink-0" />
      ) : (
        <Building2 className="mt-0.5 size-4 shrink-0" />
      )}
      <p>
        <span className="font-semibold">Du retter {label}.</span> {text}
      </p>
    </div>
  );
}
