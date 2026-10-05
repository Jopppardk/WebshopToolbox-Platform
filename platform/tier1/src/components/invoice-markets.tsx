'use client';
// Indstillinger → Faktura-afsendelse, one tab per country: Danmark holds the company's invoice settings as before;
// every other active Shopify market (e.g. Sverige) gets its own language, store name, contact, footer, VAT and mail.
import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, ExternalLink, LoaderCircle, Save } from 'lucide-react';
import { tier1Fetch as fetch, tier1Url } from '@/platform/transport';
import { useCapabilities } from '@/platform/capabilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CountryFlag, countryName } from '@/components/country-flag';

type Locale = 'da' | 'sv' | 'en';
type MarketSettings = { enabled: boolean; locale: Locale; storeName: string; contact: string; footer: string; invoiceSubject: string; invoiceBody: string; vatMode: 'domestic'; revision: number; updatedAt: string | null };
type Market = { id: string; name: string; countries: string[]; currency: string; url: string; active: boolean; settings: MarketSettings };
type Payload = { home: { name: string; countries: string[]; currency: string } | null; markets: Market[]; templates: Record<Locale, { subject: string; body: string }>; error: string | null };
// Shopify's market names are often English ("Sweden"); a one-country market is shown by its Danish country name.
const display = (m: { name: string; countries: string[] }) => m.countries.length === 1 ? countryName(m.countries[0]) : m.name;
const languages: Array<[Locale, string]> = [['sv', 'Svensk'], ['en', 'Engelsk'], ['da', 'Dansk']];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>{children}{hint && <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span>}</label>;
}

function MarketPanel({ market, templates, onSaved }: { market: Market; templates: Payload['templates']; onSaved: () => Promise<void> }) {
  const capabilities = useCapabilities();
  const [value, setValue] = useState<MarketSettings>(market.settings), [busy, setBusy] = useState(false), [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null), [dirty, setDirty] = useState(false);
  useEffect(() => { setValue(market.settings); setDirty(false); }, [market]);
  const change = (patch: Partial<MarketSettings>) => { setValue(v => ({ ...v, ...patch })); setDirty(true); setMessage(null); };
  const country = market.countries[0];
  async function save() {
    setBusy(true); setMessage(null);
    try {
      const r = await fetch('/api/markets/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketId: market.id, ...value }) });
      const d = await r.json() as { error?: string };
      if (!r.ok) throw Error(d.error || 'Kunne ikke gemmes.');
      await onSaved(); setDirty(false);
      setMessage({ ok: true, text: value.enabled ? `Gemt. Ordrer fra ${display(market)} faktureres og bogføres nu.` : 'Gemt. Markedet er slået fra, så ordrer herfra afventer fortsat.' });
    } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : 'Kunne ikke gemmes.' }); } finally { setBusy(false); }
  }
  return <fieldset disabled={busy} className="min-w-0 space-y-6">
    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5">
        <div className="flex items-start gap-3">{country && <CountryFlag code={country} className="mt-1 h-5 w-7" />}
          <div><h2 className="text-lg font-semibold">{display(market)}</h2><p className="mt-1 text-sm text-muted-foreground">{market.currency} · {market.countries.join(', ')}{market.url && <> · {market.url.replace(/^https:\/\//, '')}</>}{!market.active && ' · Ikke længere aktivt i Shopify'}</p></div></div>
        <label className="flex items-center gap-3 text-sm font-medium">Fakturér og bogfør ordrer herfra<Switch checked={value.enabled} disabled={!market.active && !value.enabled} onCheckedChange={enabled => change({ enabled })} aria-label={`Fakturér og bogfør ordrer fra ${display(market)}`} /></label>
      </div>
      <p className="px-5 pt-4 text-sm text-muted-foreground">Fakturaen laves i {market.currency} med de beløb, kunden betalte. Bogføringen i Dinero sker i DKK med Shopifys omregnede beløb, ligesom danske ordrer. Virksomhedsnavn, adresse, CVR, logo og layout følger fanen Danmark.</p>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Sprog på faktura og mail"><select className="h-10 w-full rounded-lg border bg-white px-3 text-sm" value={value.locale} onChange={e => change({ locale: e.target.value as Locale })}>{languages.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
        <Field label="Butik / domæne på fakturaen" hint={'Vises som fx "Order #2690 · Sabeln.se".'}><Input maxLength={80} value={value.storeName} onChange={e => change({ storeName: e.target.value })} /></Field>
        <Field label="Kontaktoplysninger i bundlinjen (valgfri)" hint="Tomt felt bruger kontaktoplysningerne fra Danmark."><Input maxLength={100} placeholder="fx info@sabeln.se · sabeln.se" value={value.contact} onChange={e => change({ contact: e.target.value })} /></Field>
        <Field label="Egen bundtekst (valgfri)" hint="Tomt felt bruger bundteksten fra Danmark."><Input maxLength={180} placeholder="fx Tack för att du handlar hos oss" value={value.footer} onChange={e => change({ footer: e.target.value })} /></Field>
      </div>
      <div className="border-t p-5">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Moms</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-xl border border-[#9a7440] bg-[#fbf7f0] p-3 text-sm"><input type="radio" checked readOnly className="mt-1" /><span><span className="block font-medium">Dansk moms</span><span className="text-xs text-muted-foreground">Ikke OSS-registreret. Bogføres med U25 som danske ordrer.</span></span></label>
          <label className="flex items-start gap-3 rounded-xl border p-3 text-sm text-muted-foreground"><input type="radio" disabled className="mt-1" /><span><span className="block font-medium">OSS · moms i kundens land</span><span className="text-xs">Kommer senere, når virksomheden er OSS-registreret.</span></span></label>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t bg-[#fcfbf9] p-4">
        {value.revision > 0 && <Button variant="outline" render={<a href={tier1Url(`/api/invoices/preview?marketId=${encodeURIComponent(market.id)}&v=${value.revision}`)} target="_blank" rel="noreferrer" />}><ExternalLink />Se gemt eksempel (PDF)</Button>}
      </div>
    </section>
    <section className="overflow-hidden rounded-2xl border bg-white">
      <div className="border-b p-5"><h2 className="text-lg font-semibold">Mailtekst for {display(market)}</h2><p className="mt-1 text-sm text-muted-foreground">{capabilities.customerEmail ? 'Sendes, når automatisk afsendelse er slået til på fanen Danmark. Kreditnotaer får en tilsvarende tekst på samme sprog.' : 'Automatisk kundemail er deaktiveret i testmiljøet.'}</p></div>
      <div className="grid gap-4 p-5">
        <Field label="Emne"><Input value={value.invoiceSubject} onChange={e => change({ invoiceSubject: e.target.value })} /></Field>
        <Field label="Mailtekst"><Textarea className="min-h-40" value={value.invoiceBody} onChange={e => change({ invoiceBody: e.target.value })} /></Field>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Du kan bruge: {'{{kundenavn}}'}, {'{{fakturanummer}}'}, {'{{ordrenummer}}'}, {'{{butik}}'} og {'{{virksomhedsnavn}}'}.</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => change({ invoiceSubject: templates[value.locale].subject, invoiceBody: templates[value.locale].body })}>Brug standardtekst på {languages.find(([id]) => id === value.locale)?.[1].toLocaleLowerCase('da')}</Button></div>
      </div>
    </section>
    <div className="flex flex-wrap items-center justify-end gap-3">
      {message && <p role="status" className={'mr-auto flex items-center gap-2 text-sm ' + (message.ok ? 'text-emerald-800' : 'text-red-800')}>{message.ok ? <CircleCheck className="size-4" /> : <CircleAlert className="size-4" />}{message.text}</p>}
      {dirty && !message && <span className="mr-auto text-xs text-muted-foreground">Der er ændringer, som endnu ikke er gemt.</span>}
      <Button className="h-10 rounded-xl px-4" onClick={() => void save()}><Save />{busy ? 'Gemmer…' : `Gem ${display(market)}`}</Button>
    </div>
  </fieldset>;
}

export function InvoiceMarkets({ home }: { home: ReactNode }) {
  const [data, setData] = useState<Payload | null>(null), [error, setError] = useState(''), [tab, setTab] = useState('home');
  async function load() { const r = await fetch('/api/markets/settings'); const d = await r.json() as Payload & { error?: string }; if (!r.ok) throw Error(d.error || 'Markederne kunne ikke hentes.'); setData(d); }
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : 'Markederne kunne ikke hentes.')); }, []);
  const markets = data?.markets ?? [], selected = markets.find(m => m.id === tab);
  const homeCountry = data?.home?.countries[0] ?? 'DK';
  const tabClass = (active: boolean) => 'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ' + (active ? 'bg-white shadow-sm ring-1 ring-black/5' : 'text-muted-foreground hover:text-foreground');
  return <>
    <div className="mb-6">
      <div role="tablist" aria-label="Land" className="inline-flex flex-wrap gap-1 rounded-xl bg-muted/60 p-1">
        <button type="button" role="tab" aria-selected={tab === 'home'} className={tabClass(tab === 'home')} onClick={() => setTab('home')}><CountryFlag code={homeCountry} />{data?.home ? display(data.home) : 'Danmark'}</button>
        {markets.map(m => <button type="button" role="tab" key={m.id} aria-selected={tab === m.id} className={tabClass(tab === m.id)} onClick={() => setTab(m.id)}>{m.countries[0] && <CountryFlag code={m.countries[0]} />}{display(m)}<span className={'size-1.5 rounded-full ' + (m.settings.enabled ? 'bg-emerald-500' : 'bg-slate-300')} title={m.settings.enabled ? 'Slået til' : 'Ikke slået til'} /></button>)}
        {!data && !error && <span className="inline-flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Henter markeder…</span>}
      </div>
      {(error || data?.error) && <p className="mt-2 text-xs text-muted-foreground">Andre markeder kan ikke vises: {error || data?.error}</p>}
      {data && !markets.length && !data.error && <p className="mt-2 text-xs text-muted-foreground">Der er ingen andre aktive markeder i Shopify. Opret et marked i Shopify for at fakturere til andre lande.</p>}
    </div>
    {selected && data ? <MarketPanel market={selected} templates={data.templates} onSaved={load} /> : home}
  </>;
}
