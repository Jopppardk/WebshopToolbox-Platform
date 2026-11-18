// Tools → Anmeldelser: the webshop's own Trustpilot invitation mails. A visual editor for the Danish and the Swedish
// mail (click a text in the mail to write in it, add images, stars, buttons, lines and space), when they are sent,
// a test mail and the latest invitations. The mail is rendered with the same code the server sends it with.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  CircleAlert,
  CircleCheck,
  Copy,
  Heading,
  Image as ImageIcon,
  Italic,
  Link2,
  LoaderCircle,
  Minus,
  MoveVertical,
  MousePointerClick,
  Send,
  Star,
  Trash2,
  Type,
  Underline,
  Upload,
} from 'lucide-react';
import { tier1Fetch } from '@/platform/transport';
import { PageTitle, useWorkspace } from '@/platform/workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { CountryFlag } from '@/components/country-flag';
import { useConfirm } from '@/components/confirm-dialog';
import { formatDateTime } from '@/lib/format';
import {
  blockId,
  localeCountry,
  localeNames,
  newBlock,
  renderBlock,
  reviewLocales,
  reviewVariables,
  sanitizeRich,
  trustpilotGreen,
  type Align,
  type ReviewBlock,
  type ReviewBlockType,
  type ReviewLocale,
  type ReviewSettings,
  type ReviewTemplate,
} from '@/lib/review-mail';

type LogRow = {
  orderId: string;
  orderName: string;
  locale: ReviewLocale | null;
  recipient: string | null;
  sender: string | null;
  status: 'sending' | 'sent' | 'uncertain' | 'skipped';
  reason: string | null;
  createdAt: string;
  sentAt: string | null;
};
type Info = {
  settings: ReviewSettings;
  revision: number;
  startAt: string | null;
  store: string;
  domain: string;
  senders: Record<
    ReviewLocale,
    { from: string; name: string; domains: string[]; store: string }
  >;
  counts: {
    sent: number;
    recent: number;
    uncertain: number;
    queued: number;
    ready: number;
  };
  log: LogRow[];
  testRecipient: string;
  customerMail: boolean;
  localPreview: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await tier1Fetch('/api/reviews' + path, init);
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(value.error || 'Handlingen kunne ikke gennemføres.');
  return value;
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const palette: Array<[ReviewBlockType, string, typeof Type]> = [
  ['heading', 'Overskrift', Heading],
  ['text', 'Tekst', Type],
  ['image', 'Billede', ImageIcon],
  ['stars', 'Stjerner', Star],
  ['button', 'Knap', MousePointerClick],
  ['divider', 'Streg', Minus],
  ['spacer', 'Luft', MoveVertical],
];
const blockNames: Record<ReviewBlockType, string> = {
  heading: 'Overskrift',
  text: 'Tekst',
  image: 'Billede',
  stars: 'Stjerner',
  button: 'Knap',
  divider: 'Streg',
  spacer: 'Luft',
};

/**
 * Formatting in the editable mail text. execCommand is deprecated but still the only way all browsers edit
 * contentEditable with undo; the result is cleaned by sanitizeRich before it is saved or sent.
 */
function edit(command: string, value?: string) {
  // oxlint-disable-next-line typescript/no-deprecated -- See above: contentEditable formatting with undo.
  document.execCommand(command, false, value);
}

/** One block in the canvas, drawn with the mail's own HTML. Texts are edited in place. */
function BlockView({
  block,
  template,
  selected,
  onSelect,
  onText,
}: {
  block: ReviewBlock;
  template: ReviewTemplate;
  selected: boolean;
  onSelect: () => void;
  onText: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const html = renderBlock(block, template, null, true);
  // Written by hand rather than by React, so typing is never interrupted by a re-render of the same text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const edit = el.querySelector<HTMLElement>('[data-edit]');
    if (edit && edit.contains(document.activeElement)) return;
    el.innerHTML = html;
    const next = el.querySelector<HTMLElement>('[data-edit]');
    if (next) {
      next.contentEditable = 'true';
      next.spellcheck = true;
      next.style.outline = 'none';
      next.style.cursor = 'text';
    }
  }, [html]);
  const rich = block.type === 'heading' || block.type === 'text';
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- A mail element: its text is edited in place (contentEditable) and the panel holds its settings.
    <div
      ref={ref}
      role="group"
      aria-label={blockNames[block.type]}
      data-block={block.id}
      onMouseDown={onSelect}
      onFocus={onSelect}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) e.preventDefault();
      }}
      onInput={() => {
        const edit = ref.current?.querySelector<HTMLElement>('[data-edit]');
        if (rich && edit) onText(edit.innerHTML);
      }}
      onBlur={() => {
        const edit = ref.current?.querySelector<HTMLElement>('[data-edit]');
        if (rich && edit) onText(sanitizeRich(edit.innerHTML));
      }}
      onPaste={(e) => {
        if (!rich) return;
        // Only plain text is pasted, so formatting from other programs never reaches the mail.
        e.preventDefault();
        edit('insertText', e.clipboardData.getData('text/plain'));
      }}
      onKeyDown={(e) => {
        // Enter gives a line break (one <br>), the same in every mail client.
        if (rich && e.key === 'Enter') {
          e.preventDefault();
          edit('insertLineBreak');
        }
      }}
      className={`relative cursor-pointer rounded-md outline-offset-4 transition-[outline-color] ${
        selected
          ? 'outline-2 outline-[#2f6b4f] outline'
          : 'outline-1 outline-transparent outline hover:outline-[#c9bfae] hover:outline-dashed'
      }`}
    />
  );
}

/**
 * An own sender address: the part before @ is typed, the domain is chosen among the approved ones. An empty first
 * part sends from the language's standard address.
 */
function SenderAddress({
  value,
  domains,
  suggested,
  fallback,
  onChange,
}: {
  value: string;
  domains: string[];
  suggested?: string;
  fallback: string;
  onChange: (address: string) => void;
}) {
  const at = value.lastIndexOf('@'),
    local = at < 0 ? value : value.slice(0, at);
  const [domain, setDomain] = useState(
    at < 0 ? suggested || domains[0] || '' : value.slice(at + 1),
  );
  // A saved address on a domain that is no longer approved stays visible, so it can be changed or cleared.
  const options =
    domain && !domains.includes(domain) ? [domain, ...domains] : domains;
  const set = (nextLocal: string, nextDomain: string) =>
    onChange(nextLocal ? nextLocal + '@' + nextDomain : '');
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Input
        aria-label="Afsenderadresse før @"
        value={local}
        placeholder={options.length ? 'kontakt' : fallback}
        disabled={!options.length}
        onChange={(e) =>
          set(e.target.value.replace(/[@\s]/g, '').toLowerCase(), domain)
        }
        className="h-9 max-w-48"
      />
      <span>@</span>
      <select
        aria-label="Domæne"
        className="h-9 rounded-lg border bg-white px-2 text-sm"
        value={domain}
        disabled={!options.length}
        onChange={(e) => {
          setDomain(e.target.value);
          set(local, e.target.value);
        }}
      >
        {options.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </span>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && (
        <span className="text-xs [overflow-wrap:anywhere] text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-11 cursor-pointer rounded-lg border border-[#e0d6c6] bg-white p-1"
          aria-label={label}
        />
        <Input
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase());
          }}
          className="h-9 font-mono text-xs"
          maxLength={7}
        />
      </span>
    </Field>
  );
}
function AlignField({
  value,
  onChange,
}: {
  value: Align;
  onChange: (value: Align) => void;
}) {
  return (
    <Field label="Placering">
      <span className="grid grid-cols-3 gap-1 rounded-lg bg-[#f4efe7] p-1">
        {(
          [
            ['left', 'Venstre'],
            ['center', 'Midte'],
            ['right', 'Højre'],
          ] as const
        ).map(([key, name]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`rounded-md px-2 py-1.5 text-xs font-medium ${value === key ? 'bg-white shadow-sm' : 'text-muted-foreground'}`}
          >
            {name}
          </button>
        ))}
      </span>
    </Field>
  );
}
function RangeField({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={`${label}: ${value} ${unit}`}>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[#2f6b4f]"
      />
    </Field>
  );
}

/** Formatting for the text being edited: bold, italic, underline, link and the order's details. */
function TextToolbar() {
  const [linking, setLinking] = useState(false),
    [url, setUrl] = useState('https://'),
    saved = useRef<Range | null>(null);
  const run = edit;
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const apply = () => {
    const selection = window.getSelection();
    if (saved.current && selection) {
      selection.removeAllRanges();
      selection.addRange(saved.current);
      const host = saved.current.startContainer.parentElement?.closest(
        '[contenteditable="true"]',
      ) as HTMLElement | null;
      host?.focus();
    }
    if (/^(https?:\/\/\S+|mailto:\S+|\{\{trustpilot\}\})$/.test(url.trim()))
      run('createLink', url.trim());
    setLinking(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[#e9e2d7] bg-white px-2 py-1.5 shadow-sm">
      {(
        [
          ['bold', Bold, 'Fed'],
          ['italic', Italic, 'Kursiv'],
          ['underline', Underline, 'Understreget'],
        ] as const
      ).map(([command, Icon, name]) => (
        <button
          key={command}
          type="button"
          title={name}
          aria-label={name}
          onMouseDown={keep}
          onClick={() => run(command)}
          className="grid size-8 place-items-center rounded-md hover:bg-[#f4efe7]"
        >
          <Icon className="size-4" />
        </button>
      ))}
      <button
        type="button"
        title="Link"
        aria-label="Link"
        onMouseDown={(e) => {
          e.preventDefault();
          const selection = window.getSelection();
          saved.current =
            selection && selection.rangeCount
              ? selection.getRangeAt(0).cloneRange()
              : null;
          setLinking((v) => !v);
        }}
        className="grid size-8 place-items-center rounded-md hover:bg-[#f4efe7]"
      >
        <Link2 className="size-4" />
      </button>
      {linking && (
        <span className="flex items-center gap-1">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            className="h-8 w-56 text-xs"
            placeholder="https://… eller {{trustpilot}}"
          />
          <Button size="sm" className="h-8" onClick={apply}>
            Indsæt
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onMouseDown={keep}
            onClick={() => setUrl('{{trustpilot}}')}
          >
            Trustpilot
          </Button>
        </span>
      )}
      <span className="mx-1 h-5 w-px bg-[#e9e2d7]" />
      {reviewVariables.map(([token, name]) => (
        <button
          key={token}
          type="button"
          title={`Indsæt ${name.toLowerCase()}`}
          onMouseDown={keep}
          onClick={() => run('insertText', token)}
          className="rounded-md px-2 py-1 font-mono text-[11px] text-[#7a5c30] hover:bg-[#f4efe7]"
        >
          {token}
        </button>
      ))}
    </div>
  );
}

function BlockPanel({
  block,
  onChange,
}: {
  block: ReviewBlock;
  onChange: (block: ReviewBlock) => void;
}) {
  const [uploading, setUploading] = useState(false),
    [error, setError] = useState('');
  const set = (patch: Partial<ReviewBlock>) =>
    onChange({ ...block, ...patch } as ReviewBlock);
  switch (block.type) {
    case 'heading':
    case 'text':
      return (
        <div className="grid gap-4">
          <p className="text-xs text-muted-foreground">
            Klik i teksten i mailen for at skrive. Markér tekst for fed, kursiv
            eller link.
          </p>
          <RangeField
            label="Skriftstørrelse"
            value={block.size}
            min={11}
            max={48}
            unit="px"
            onChange={(size) => set({ size })}
          />
          <ColorField
            label="Tekstfarve"
            value={block.color}
            onChange={(color) => set({ color })}
          />
          <AlignField
            value={block.align}
            onChange={(align) => set({ align })}
          />
        </div>
      );
    case 'image':
      return (
        <div className="grid gap-4">
          <Field label="Billede" hint="PNG, JPG, GIF eller WebP, højst 2 MB.">
            <span className="flex gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-[#e0d6c6] bg-white px-3 text-sm font-medium hover:bg-[#faf7f2]">
                {uploading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                Upload
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="sr-only"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setError('');
                    setUploading(true);
                    try {
                      const { url } = await api<{ url: string }>('/images', {
                        method: 'POST',
                        headers: { 'Content-Type': file.type },
                        body: file,
                      });
                      set({
                        src: url,
                        alt: block.alt || file.name.replace(/\.\w+$/, ''),
                      });
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : 'Upload fejlede.',
                      );
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
              </label>
            </span>
          </Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Field label="Eller billedadresse">
            <Input
              value={block.src}
              onChange={(e) => set({ src: e.target.value })}
              placeholder="https://…"
              className="h-9 text-xs"
            />
          </Field>
          <Field
            label="Alternativ tekst"
            hint="Vises, hvis mailprogrammet ikke viser billeder."
          >
            <Input
              value={block.alt}
              onChange={(e) => set({ alt: e.target.value })}
              className="h-9"
            />
          </Field>
          <RangeField
            label="Bredde"
            value={block.width}
            min={10}
            max={100}
            unit="%"
            onChange={(width) => set({ width })}
          />
          <AlignField
            value={block.align}
            onChange={(align) => set({ align })}
          />
          <Field label="Link (valgfrit)">
            <Input
              value={block.href}
              onChange={(e) => set({ href: e.target.value })}
              placeholder="https://… eller {{trustpilot}}"
              className="h-9 text-xs"
            />
          </Field>
        </div>
      );
    case 'stars':
      return (
        <div className="grid gap-4">
          <p className="text-xs text-muted-foreground">
            Hver stjerne åbner Trustpilot med det antal stjerner valgt.
          </p>
          <Field label="Tekst over stjernerne">
            <Input
              value={block.caption}
              onChange={(e) => set({ caption: e.target.value })}
              className="h-9"
            />
          </Field>
          <RangeField
            label="Størrelse"
            value={block.size}
            min={24}
            max={64}
            unit="px"
            onChange={(size) => set({ size })}
          />
          <ColorField
            label="Farve"
            value={block.color}
            onChange={(color) => set({ color })}
          />
          <AlignField
            value={block.align}
            onChange={(align) => set({ align })}
          />
        </div>
      );
    case 'button':
      return (
        <div className="grid gap-4">
          <Field label="Knaptekst">
            <Input
              value={block.text}
              onChange={(e) => set({ text: e.target.value })}
              className="h-9"
            />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">Link til Trustpilot</span>
            <Switch
              checked={block.href === '{{trustpilot}}'}
              onCheckedChange={(on) =>
                set({ href: on ? '{{trustpilot}}' : 'https://' })
              }
            />
          </label>
          {block.href !== '{{trustpilot}}' && (
            <Field label="Link">
              <Input
                value={block.href}
                onChange={(e) => set({ href: e.target.value })}
                className="h-9 text-xs"
              />
            </Field>
          )}
          <ColorField
            label="Knapfarve"
            value={block.background}
            onChange={(background) => set({ background })}
          />
          <ColorField
            label="Tekstfarve"
            value={block.color}
            onChange={(color) => set({ color })}
          />
          <RangeField
            label="Runde hjørner"
            value={block.radius}
            min={0}
            max={30}
            unit="px"
            onChange={(radius) => set({ radius })}
          />
          <AlignField
            value={block.align}
            onChange={(align) => set({ align })}
          />
        </div>
      );
    case 'divider':
      return (
        <ColorField
          label="Farve"
          value={block.color}
          onChange={(color) => set({ color })}
        />
      );
    case 'spacer':
      return (
        <RangeField
          label="Højde"
          value={block.height}
          min={4}
          max={120}
          unit="px"
          onChange={(height) => set({ height })}
        />
      );
  }
}

function MailEditor({
  template,
  locale,
  onChange,
}: {
  template: ReviewTemplate;
  locale: ReviewLocale;
  onChange: (template: ReviewTemplate) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const index = template.blocks.findIndex((b) => b.id === selected),
    current = index >= 0 ? template.blocks[index] : null;
  const setBlocks = (blocks: ReviewBlock[]) =>
    onChange({ ...template, blocks });
  const update = (block: ReviewBlock) =>
    setBlocks(template.blocks.map((b) => (b.id === block.id ? block : b)));
  const add = (type: ReviewBlockType) => {
    const block = newBlock(type, locale),
      at = index >= 0 ? index + 1 : template.blocks.length;
    setBlocks([
      ...template.blocks.slice(0, at),
      block,
      ...template.blocks.slice(at),
    ]);
    setSelected(block.id);
  };
  const move = (step: number) => {
    const to = index + step;
    if (index < 0 || to < 0 || to >= template.blocks.length) return;
    const blocks = [...template.blocks];
    [blocks[index], blocks[to]] = [blocks[to], blocks[index]];
    setBlocks(blocks);
  };
  const design = template.design;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <div className="sticky top-2 z-10 mb-3">
          <TextToolbar />
        </div>
        <div
          role="presentation"
          className="overflow-hidden rounded-2xl border border-[#e9e2d7]"
          style={{ background: design.background }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="px-3 py-8 sm:px-6">
            <div
              className="mx-auto w-full max-w-[600px] rounded-2xl py-6"
              style={{ background: design.card }}
            >
              {template.blocks.map((block) => (
                <div key={block.id} className="px-5 sm:px-8">
                  <BlockView
                    block={block}
                    template={template}
                    selected={block.id === selected}
                    onSelect={() => setSelected(block.id)}
                    onText={(html) => update({ ...block, html } as ReviewBlock)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <aside className="grid content-start gap-4">
        <section className="rounded-2xl border border-[#e9e2d7] bg-white p-4">
          <p className="mb-3 text-sm font-semibold">Tilføj element</p>
          <div className="grid grid-cols-4 gap-2">
            {palette.map(([type, name, Icon]) => (
              <button
                key={type}
                type="button"
                onClick={() => add(type)}
                className="grid place-items-center gap-1 rounded-xl border border-[#efe8dd] px-1 py-2.5 text-[11px] font-medium hover:border-[#c9bfae] hover:bg-[#faf7f2]"
              >
                <Icon className="size-4 text-[#7a5c30]" />
                {name}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Nye elementer indsættes under det valgte.
          </p>
        </section>
        {current && (
          <section className="rounded-2xl border border-[#cfe0d6] bg-white p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {blockNames[current.type]}
              </p>
              <span className="flex gap-1">
                {(
                  [
                    [ArrowUp, 'Flyt op', () => move(-1)],
                    [ArrowDown, 'Flyt ned', () => move(1)],
                    [
                      Copy,
                      'Kopiér',
                      () => {
                        const copy = { ...current, id: blockId() };
                        setBlocks([
                          ...template.blocks.slice(0, index + 1),
                          copy,
                          ...template.blocks.slice(index + 1),
                        ]);
                        setSelected(copy.id);
                      },
                    ],
                    [
                      Trash2,
                      'Slet',
                      () => {
                        setBlocks(
                          template.blocks.filter((b) => b.id !== current.id),
                        );
                        setSelected(null);
                      },
                    ],
                  ] as const
                ).map(([Icon, name, action]) => (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    aria-label={name}
                    onClick={action}
                    className="grid size-8 place-items-center rounded-md hover:bg-[#f4efe7]"
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </span>
            </div>
            <BlockPanel block={current} onChange={update} />
          </section>
        )}
        <section className="grid gap-4 rounded-2xl border border-[#e9e2d7] bg-white p-4">
          <p className="text-sm font-semibold">Mailens design</p>
          <ColorField
            label="Baggrund"
            value={design.background}
            onChange={(background) =>
              onChange({ ...template, design: { ...design, background } })
            }
          />
          <ColorField
            label="Indholdsfelt"
            value={design.card}
            onChange={(card) =>
              onChange({ ...template, design: { ...design, card } })
            }
          />
          <Field label="Skrifttype">
            <span className="grid grid-cols-2 gap-1 rounded-lg bg-[#f4efe7] p-1">
              {(
                [
                  ['sans', 'Moderne'],
                  ['serif', 'Klassisk'],
                ] as const
              ).map(([font, name]) => (
                <button
                  key={font}
                  type="button"
                  onClick={() =>
                    onChange({ ...template, design: { ...design, font } })
                  }
                  className={`rounded-md px-2 py-1.5 text-xs font-medium ${design.font === font ? 'bg-white shadow-sm' : 'text-muted-foreground'}`}
                  style={{
                    fontFamily: font === 'serif' ? 'Georgia, serif' : undefined,
                  }}
                >
                  {name}
                </button>
              ))}
            </span>
          </Field>
        </section>
      </aside>
    </div>
  );
}

const statusBadge: Record<LogRow['status'], [string, string]> = {
  sent: ['Sendt', 'bg-[#e3f3ea] text-[#1f6b45]'],
  skipped: ['Ikke sendt', 'bg-[#f1eee9] text-[#6b665e]'],
  uncertain: ['Uafklaret', 'bg-[#fdf0d8] text-[#8a5a12]'],
  sending: ['Uafklaret', 'bg-[#fdf0d8] text-[#8a5a12]'],
};

export function ReviewInvitations() {
  const { webshopId } = useWorkspace();
  return <ReviewPage key={webshopId || 'none'} />;
}
function ReviewPage() {
  const [info, setInfo] = useState<Info | null>(null),
    [settings, setSettings] = useState<ReviewSettings | null>(null),
    [locale, setLocale] = useState<ReviewLocale>('da'),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState<'' | 'save' | 'test'>(''),
    [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
      null,
    ),
    [recipient, setRecipient] = useState('');
  const { confirm, dialog } = useConfirm();
  const load = (value: Info) => {
    setInfo(value);
    setSettings(value.settings);
    setDirty(false);
    setRecipient((r) => r || value.testRecipient);
  };
  useEffect(() => {
    api<Info>('')
      .then(load)
      .catch((e) => setMessage({ ok: false, text: e.message }));
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (next: ReviewSettings) => {
    setSettings(next);
    setDirty(true);
  };
  const setTemplate = (template: ReviewTemplate) =>
    settings &&
    change({
      ...settings,
      templates: { ...settings.templates, [locale]: template },
    });
  const save = async () => {
    if (!settings || !info) return false;
    setBusy('save');
    setMessage(null);
    try {
      load(
        await api<Info>('', json('PUT', { settings, revision: info.revision })),
      );
      return true;
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy('');
    }
  };
  const test = async () => {
    if (dirty && !(await save())) return;
    setBusy('test');
    setMessage(null);
    try {
      const result = await api<{ status: string; recipient: string }>(
        '/test',
        json('POST', {
          locale,
          recipient,
          requestId: crypto.randomUUID(),
        }),
      );
      setMessage(
        result.status === 'accepted'
          ? { ok: true, text: `Testmailen er sendt til ${result.recipient}.` }
          : result.status === 'preview'
            ? {
                ok: true,
                text: 'Lokal test: mailen er dannet, men ikke sendt.',
              }
            : {
                ok: false,
                text: 'Afsendelsen kunne ikke bekræftes. Tjek indbakken, før du prøver igen.',
              },
      );
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };
  if (!info || !settings)
    return (
      <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
        <p className="eyebrow">Tools · Trustpilot</p>
        <PageTitle title="Anmeldelser" />
        {message ? (
          <p className="mt-6 text-sm text-destructive">{message.text}</p>
        ) : (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Henter…
          </p>
        )}
      </div>
    );
  const template = settings.templates[locale],
    sender = info.senders[locale],
    language = localeNames[locale].toLowerCase(),
    // A Swedish mail suggests the .se domain, a Danish one the .dk domain, when both are approved.
    suggested =
      sender.domains.find((d) => d.endsWith(locale === 'sv' ? '.se' : '.dk')) ||
      sender.domains[0];
  return (
    <div className="mx-auto max-w-[1440px] px-5 py-7 md:px-8 md:py-9">
      {dialog}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Tools · Trustpilot</p>
          <PageTitle title="Anmeldelser" />
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Send dine egne invitationer til at anmelde webshoppen på Trustpilot,
            på dansk til danske kunder og på svensk til svenske.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <span className="text-xs text-muted-foreground">Ikke gemt</span>
          )}
          <Button
            className="h-10 rounded-xl px-5"
            disabled={!!busy || !dirty}
            onClick={save}
          >
            {busy === 'save' && (
              <LoaderCircle className="size-4 animate-spin" />
            )}
            Gem
          </Button>
        </div>
      </header>
      {message && (
        <p
          role="status"
          className={`mb-5 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${message.ok ? 'bg-[#e3f3ea] text-[#1f6b45]' : 'bg-[#fdecea] text-[#9b2c1f]'}`}
        >
          {message.ok ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
          )}
          {message.text}
        </p>
      )}
      <section className="mb-6 grid gap-5 rounded-2xl border border-[#e9e2d7] bg-white p-5 shadow-[0_8px_30px_rgba(70,50,20,0.04)] lg:grid-cols-[1fr_auto] sm:p-6">
        <div className="flex items-start gap-4">
          <Switch
            checked={settings.enabled}
            aria-label="Send invitationer automatisk"
            onCheckedChange={async (enabled) => {
              if (
                enabled &&
                !(await confirm({
                  title: 'Send invitationer automatisk?',
                  message:
                    'Ordrer, der sendes fra nu af, får en invitation, når ventetiden er gået. Tidligere ordrer får ingen. Slå Trustpilots egen automatiske invitation fra, så kunderne ikke får to mails.',
                  confirmLabel: 'Slå til',
                }))
              )
                return;
              change({ ...settings, enabled });
            }}
            className="mt-1"
          />
          <div>
            <p className="font-semibold">Send invitationer automatisk</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {settings.enabled
                ? info.startAt
                  ? `Slået til ${formatDateTime(info.startAt)}. Ordrer afsendt derefter får én invitation, når ventetiden for kundens sprog er gået.`
                  : 'Gem for at slå til. Kun ordrer, der afsendes fra nu af, får en invitation.'
                : 'Slået fra. Ingen invitationer sendes.'}
            </p>
            {!info.customerMail && (
              <p className="mt-2 text-xs text-[#8a5a12]">
                Kundemails er ikke slået til i dette miljø, så her sendes kun
                testmails.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Husk at slå Trustpilots automatiske invitationer fra i Trustpilot
              Business, så kunderne ikke får to mails.
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          {(
            [
              [
                info.counts.ready
                  ? `I kø · ${info.counts.ready.toLocaleString('da-DK')} klar`
                  : 'I kø',
                info.counts.queued,
              ],
              ['Sendt, 30 dage', info.counts.recent],
              ['Sendt i alt', info.counts.sent],
              ['Uafklarede', info.counts.uncertain],
            ] as [string, number][]
          ).map(([name, value]) => (
            <div
              key={name}
              className="min-w-24 rounded-xl bg-[#faf7f2] px-3 py-2.5"
            >
              <dd className="text-xl font-semibold tabular-nums">
                {value.toLocaleString('da-DK')}
              </dd>
              <dt className="text-[11px] text-muted-foreground">{name}</dt>
            </div>
          ))}
        </dl>
      </section>

      <div
        className="mb-4 inline-flex gap-1 rounded-xl bg-[#f4efe7] p-1"
        role="tablist"
      >
        {reviewLocales.map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={l === locale}
            type="button"
            onClick={() => setLocale(l)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${l === locale ? 'bg-white shadow-sm' : 'text-muted-foreground'}`}
          >
            <CountryFlag code={localeCountry[l]} />
            {localeNames[l]}
            {!settings.templates[l].enabled && (
              <Badge variant="outline" className="text-[10px]">
                Fra
              </Badge>
            )}
          </button>
        ))}
      </div>

      <section className="mb-6 grid gap-5 rounded-2xl border border-[#e9e2d7] bg-white p-5 sm:p-6">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex items-start gap-3 text-sm xl:col-span-1">
            <Switch
              checked={template.enabled}
              onCheckedChange={(enabled) =>
                setTemplate({ ...template, enabled })
              }
              className="mt-1"
            />
            <span>
              <span className="font-medium">Send til {language}e kunder</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {locale === 'da'
                  ? 'Ordrer til Danmark.'
                  : 'Ordrer til Sverige (eller dit svenske marked).'}
              </span>
            </span>
          </label>
          <Field
            label="Send efter afsendelse"
            hint="Dage efter ordren er afsendt, så kunden har nået at få varen."
          >
            <span className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={60}
                value={template.delayDays}
                onChange={(e) =>
                  setTemplate({
                    ...template,
                    delayDays: Math.max(
                      0,
                      Math.min(60, Number(e.target.value) || 0),
                    ),
                  })
                }
                className="h-9 w-20"
              />
              <span className="text-sm text-muted-foreground">dage</span>
            </span>
          </Field>
          <div className="xl:col-span-2">
            <Field
              label="Trustpilot-link"
              hint={`Siden hvor kunden skriver anmeldelsen. Fx https://${locale === 'sv' ? 'se' : 'dk'}.trustpilot.com/evaluate/${info.domain}`}
            >
              <Input
                value={template.trustpilotUrl}
                onChange={(e) =>
                  setTemplate({ ...template, trustpilotUrl: e.target.value })
                }
                className="h-9 text-xs"
              />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Field label="Emne">
              <Input
                value={template.subject}
                onChange={(e) =>
                  setTemplate({ ...template, subject: e.target.value })
                }
                maxLength={200}
                className="h-9"
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Forhåndstekst" hint="Vises efter emnet i indbakken.">
              <Input
                value={template.preheader}
                onChange={(e) =>
                  setTemplate({ ...template, preheader: e.target.value })
                }
                maxLength={200}
                className="h-9"
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field
              label="Afsenderadresse"
              hint={
                sender.domains.length
                  ? `Vælg et af jeres godkendte domæner. Står feltet før @ tomt, sendes fra ${sender.from}.`
                  : `Sendes fra ${sender.from}. For at vælge en anden adresse skal jeres domæne først godkendes under Indstillinger → Integrationer → Cloudflare E-mail.`
              }
            >
              <SenderAddress
                key={locale}
                value={template.fromAddress ?? ''}
                domains={sender.domains}
                suggested={suggested}
                fallback={sender.from}
                onChange={(fromAddress) =>
                  setTemplate({ ...template, fromAddress })
                }
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Afsendernavn" hint={`Tom = ${sender.name}.`}>
              <Input
                value={template.fromName ?? ''}
                placeholder={sender.name}
                maxLength={120}
                onChange={(e) =>
                  setTemplate({ ...template, fromName: e.target.value })
                }
                className="h-9"
              />
            </Field>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Felter:{' '}
          {reviewVariables
            .map(([t, n]) => `${t} (${n.toLowerCase()})`)
            .join(', ')}{' '}
          udfyldes for hver ordre. {'{{trustpilot}}'} er Trustpilot-linket.
          Mangler kundens fornavn, udelades det.
        </p>
      </section>

      <MailEditor
        key={locale + ':' + info.revision}
        template={template}
        locale={locale}
        onChange={setTemplate}
      />

      <section className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-[#e9e2d7] bg-white p-5 sm:p-6">
        <div className="grow">
          <p className="font-semibold">Send testmail</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Den {language}e mail med eksempeldata (Anna, ordre #1001). Ændringer
            gemmes først.
          </p>
        </div>
        <Input
          type="email"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          className="h-10 w-72"
          aria-label="Modtager af testmail"
        />
        <Button
          className="h-10 rounded-xl px-4"
          variant="outline"
          disabled={!!busy || !recipient}
          onClick={test}
        >
          {busy === 'test' ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {dirty ? 'Gem og send test' : 'Send testmail'}
        </Button>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-[#e9e2d7] bg-white">
        <div className="border-b border-[#f0ece6] px-5 py-4 sm:px-6">
          <p className="font-semibold">Seneste invitationer</p>
        </div>
        {info.log.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 font-medium sm:px-6">Ordre</th>
                  <th className="px-3 py-2.5 font-medium">Sprog</th>
                  <th className="px-3 py-2.5 font-medium">Modtager</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Tidspunkt</th>
                  <th className="px-3 py-2.5 font-medium">Bemærkning</th>
                </tr>
              </thead>
              <tbody>
                {info.log.map((row) => (
                  <tr key={row.orderId} className="border-t border-[#f4f0ea]">
                    <td className="px-5 py-2.5 font-medium sm:px-6">
                      {row.orderName}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.locale ? (
                        <CountryFlag code={localeCountry[row.locale]} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {row.recipient || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[row.status][1]}`}
                      >
                        {statusBadge[row.status][0]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.sentAt || row.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {row.reason || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground sm:px-6">
            Ingen invitationer endnu.
          </p>
        )}
      </section>
      <p className="mt-4 text-xs text-muted-foreground">
        Stjernerne og knappen fører til Trustpilot{' '}
        <span style={{ color: trustpilotGreen }}>★</span>. Anmeldelser fra et
        almindeligt Trustpilot-link vises ikke som “verificeret” hos Trustpilot.
      </p>
    </div>
  );
}
export default ReviewInvitations;
