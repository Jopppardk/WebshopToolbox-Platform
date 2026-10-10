// Danmark's tab, Indstillinger → Faktura-afsendelse: whether the selected webshop invoices with the company's
// settings or with its own (company details, design, logo, mail texts and sender from its own domain).
import { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import { tier1Fetch as fetch } from '@/platform/transport';
import { useWorkspace } from '@/platform/workspace';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/confirm-dialog';

export function WebshopInvoiceProfile({
  onChanged,
}: {
  onChanged: () => void | Promise<void>;
}) {
  const { webshops, webshopId, company, user } = useWorkspace();
  const [own, setOwn] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
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
  const name = webshops.find((s) => s.id === webshopId)?.name || 'webshoppen';
  // Only relevant with more than one webshop, or when this one already has its own.
  if (!webshopId || own === null || (webshops.length < 2 && !own)) return null;
  async function change(next: boolean) {
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
  return (
    <section
      aria-label="Fakturaopsætning for webshoppen"
      className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-white p-5"
    >
      <div className="flex max-w-2xl gap-3">
        <Store className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold">Egen opsætning for {name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {own
              ? `Firmaoplysninger, design, logo, mailtekster og afsender herunder gælder kun ${name}. Andre markeder for ${name} arver dem.`
              : `${name} bruger virksomhedens fælles opsætning. Slå til for at give webshoppen egne firmaoplysninger, logo, mailtekster og afsender fra eget domæne. Den starter som en kopi af den fælles opsætning.`}
          </p>
          {message && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {message}
            </p>
          )}
        </div>
      </div>
      <Switch
        checked={own}
        disabled={busy || company.role !== 'admin' || !!user.support}
        onCheckedChange={(value) => void change(value)}
        aria-label={`Egen fakturaopsætning for ${name}`}
      />
      {dialog}
    </section>
  );
}
