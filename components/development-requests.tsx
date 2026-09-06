'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleDot,
  Clock3,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Send,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

type Status =
  | 'proposed'
  | 'clarification'
  | 'ready'
  | 'in_progress'
  | 'testing'
  | 'production'
  | 'rejected';
type Priority = 'low' | 'medium' | 'high' | 'critical';
type FeatureRequest = {
  id: string;
  title: string;
  description: string;
  desired_outcome: string | null;
  area: string;
  priority: Priority;
  status: Status;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
const statusLabels: Record<Status, string> = {
  proposed: 'Forslag',
  clarification: 'Afventer afklaring',
  ready: 'Klar',
  in_progress: 'I gang',
  testing: 'Test',
  production: 'I produktion',
  rejected: 'Fravalgt',
};
const priorityLabels: Record<Priority, string> = {
  low: 'Lav',
  medium: 'Normal',
  high: 'Høj',
  critical: 'Kritisk',
};
const statusClasses: Record<Status, string> = {
  proposed: 'border-stone-200 bg-stone-50 text-stone-700',
  clarification: 'border-amber-200 bg-amber-50 text-amber-800',
  ready: 'border-blue-200 bg-blue-50 text-blue-800',
  in_progress: 'border-violet-200 bg-violet-50 text-violet-800',
  testing: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  production: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rejected: 'border-red-200 bg-red-50 text-red-800',
};
const areas = [
  'Generelt',
  'Salg',
  'Tilbagebetalinger',
  'Udbetalinger',
  'Fakturaer',
  'Lager',
  'Emballage',
  'Integrationer',
  'Drift og sikkerhed',
];
const date = (value: string) =>
  new Intl.DateTimeFormat('da-DK', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Copenhagen',
  }).format(new Date(value));

export function DevelopmentRequests() {
  const [items, setItems] = useState<FeatureRequest[]>([]),
    [busy, setBusy] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [filter, setFilter] = useState<'active' | 'all' | Status>('active');
  const [form, setForm] = useState({
    title: '',
    description: '',
    desiredOutcome: '',
    area: 'Generelt',
    priority: 'medium' as Priority,
  });
  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/feature-requests', {
        cache: 'no-store',
      });
      const data = (await response.json()) as {
        requests?: FeatureRequest[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error);
      setItems(data.requests || []);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Forslagene kunne ikke indlæses.',
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const submit = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/feature-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error);
      setForm({
        title: '',
        description: '',
        desiredOutcome: '',
        area: 'Generelt',
        priority: 'medium',
      });
      setMessage('Forslaget er gemt og klar til prioritering.');
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Forslaget kunne ikke gemmes.',
      );
    } finally {
      setSaving(false);
    }
  };
  const setStatus = async (id: string, status: Status) => {
    setError('');
    const previous = items;
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item)),
    );
    try {
      const response = await fetch('/api/admin/feature-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error);
    } catch (caught) {
      setItems(previous);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Status kunne ikke opdateres.',
      );
    }
  };
  const visible = useMemo(
    () =>
      items.filter((item) =>
        filter === 'all' || filter === 'active'
          ? filter === 'all' ||
            !['production', 'rejected'].includes(item.status)
          : item.status === filter,
      ),
    [items, filter],
  );
  const counts = useMemo(
    () => ({
      active: items.filter(
        (item) => !['production', 'rejected'].includes(item.status),
      ).length,
      progress: items.filter((item) =>
        ['in_progress', 'testing'].includes(item.status),
      ).length,
      ready: items.filter((item) => item.status === 'ready').length,
      done: items.filter((item) => item.status === 'production').length,
    }),
    [items],
  );
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">System · Produktudvikling</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em]">
            Udvikling
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Saml idéer ét sted, prioritér dem og følg dem hele vejen til
            produktion.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={busy ? 'animate-spin' : ''} />
          Opdatér
        </Button>
      </div>
      {(error || message) && (
        <p
          role={error ? 'alert' : 'status'}
          className={`mb-5 rounded-xl border p-4 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
          {error || message}
        </p>
      )}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary
          icon={<Lightbulb />}
          label="Åbne forslag"
          value={counts.active}
        />
        <Summary
          icon={<CircleDot />}
          label="Klar til udvikling"
          value={counts.ready}
        />
        <Summary
          icon={<Clock3 />}
          label="I gang eller test"
          value={counts.progress}
        />
        <Summary
          icon={<Rocket />}
          label="I produktion"
          value={counts.done}
          good
        />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[390px_1fr]">
        <section className="rounded-2xl border bg-white p-5 shadow-[0_12px_40px_rgba(23,31,27,.045)] xl:sticky xl:top-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[#f1e7d7] text-[#6d5430]">
              <Plus />
            </span>
            <div>
              <h2 className="font-semibold">Nyt forslag</h2>
              <p className="text-sm text-muted-foreground">
                Beskriv behovet – løsningen kan afklares senere.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <label
              htmlFor="feature-title"
              className="block text-sm font-medium"
            >
              Titel
              <Input
                id="feature-title"
                className="mt-1.5"
                value={form.title}
                maxLength={140}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder="Fx bedre filtrering af udbetalinger"
              />
            </label>
            <label
              htmlFor="feature-description"
              className="block text-sm font-medium"
            >
              Hvad skal forbedres?
              <Textarea
                id="feature-description"
                className="mt-1.5 min-h-28"
                value={form.description}
                maxLength={4000}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="Beskriv problemet eller behovet…"
              />
            </label>
            <label
              htmlFor="feature-outcome"
              className="block text-sm font-medium"
            >
              Ønsket resultat{' '}
              <span className="font-normal text-muted-foreground">
                (valgfrit)
              </span>
              <Textarea
                id="feature-outcome"
                className="mt-1.5 min-h-20"
                value={form.desiredOutcome}
                maxLength={2000}
                onChange={(event) =>
                  setForm({ ...form, desiredOutcome: event.target.value })
                }
                placeholder="Hvordan ser en god løsning ud?"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label htmlFor="feature-area" className="text-sm font-medium">
                Område
                <NativeSelect
                  id="feature-area"
                  className="mt-1.5 w-full"
                  value={form.area}
                  onChange={(event) =>
                    setForm({ ...form, area: event.target.value })
                  }
                >
                  {areas.map((area) => (
                    <NativeSelectOption key={area} value={area}>
                      {area}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label htmlFor="feature-priority" className="text-sm font-medium">
                Prioritet
                <NativeSelect
                  id="feature-priority"
                  className="mt-1.5 w-full"
                  value={form.priority}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      priority: event.target.value as Priority,
                    })
                  }
                >
                  {(Object.keys(priorityLabels) as Priority[]).map(
                    (priority) => (
                      <NativeSelectOption key={priority} value={priority}>
                        {priorityLabels[priority]}
                      </NativeSelectOption>
                    ),
                  )}
                </NativeSelect>
              </label>
            </div>
            <Button
              className="w-full"
              onClick={() => void submit()}
              disabled={
                saving ||
                form.title.trim().length < 3 ||
                form.description.trim().length < 5
              }
            >
              {saving ? <Loader2 className="animate-spin" /> : <Send />}
              {saving ? 'Gemmer…' : 'Indsend forslag'}
            </Button>
          </div>
        </section>
        <section className="overflow-hidden rounded-2xl border bg-white shadow-[0_12px_40px_rgba(23,31,27,.045)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div>
              <h2 className="font-semibold">Forslagsoversigt</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {visible.length} af {items.length} forslag vises
              </p>
            </div>
            <NativeSelect
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as typeof filter)
              }
            >
              <NativeSelectOption value="active">Åbne</NativeSelectOption>
              <NativeSelectOption value="all">Alle</NativeSelectOption>
              {(Object.keys(statusLabels) as Status[]).map((status) => (
                <NativeSelectOption key={status} value={status}>
                  {statusLabels[status]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="divide-y">
            {busy && (
              <div className="grid min-h-44 place-items-center text-sm text-muted-foreground">
                <Loader2 className="mb-2 animate-spin" />
                Indlæser forslag…
              </div>
            )}
            {!busy && !visible.length && (
              <div className="p-12 text-center">
                <Lightbulb className="mx-auto mb-3 size-9 text-muted-foreground" />
                <p className="font-medium">Ingen forslag i denne visning</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Brug formularen til at oprette det første.
                </p>
              </div>
            )}
            {visible.map((item) => (
              <article key={item.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={statusClasses[item.status]}
                      >
                        {statusLabels[item.status]}
                      </Badge>
                      <Badge variant="outline">{item.area}</Badge>
                      <span
                        className={`text-xs font-medium ${item.priority === 'critical' ? 'text-red-700' : item.priority === 'high' ? 'text-amber-700' : 'text-muted-foreground'}`}
                      >
                        {priorityLabels[item.priority]} prioritet
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold">{item.title}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {item.description}
                    </p>
                    {item.desired_outcome && (
                      <div className="mt-3 rounded-xl bg-muted/55 p-3 text-sm">
                        <span className="font-medium">Ønsket resultat: </span>
                        {item.desired_outcome}
                      </div>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                      Oprettet {date(item.created_at)}
                      {item.created_by ? ` af ${item.created_by}` : ''}
                    </p>
                  </div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Status
                    <NativeSelect
                      className="mt-1 w-[180px]"
                      value={item.status}
                      onChange={(event) =>
                        void setStatus(item.id, event.target.value as Status)
                      }
                    >
                      {(Object.keys(statusLabels) as Status[]).map((status) => (
                        <NativeSelectOption key={status} value={status}>
                          {statusLabels[status]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Summary({
  icon,
  label,
  value,
  good = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  good?: boolean;
}) {
  return (
    <div className="stat-card">
      <div
        className={`mb-3 grid size-9 place-items-center rounded-lg ${good ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f1e7d7] text-[#6d5430]'}`}
      >
        {icon}
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {good && value > 0 && (
        <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="size-3" />
          Leveret
        </p>
      )}
    </div>
  );
}
