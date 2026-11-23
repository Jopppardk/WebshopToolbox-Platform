// Trustpilot-invitationer (Tools → Anmeldelser): the mail template, its blocks and how it is rendered.
// Shared by the server (sending, test mails, validation on save) and the portal's editor, so what the editor shows
// is the same HTML the customer receives. Everything a user typed is escaped or passed through a small allowlist
// sanitizer; only fixed tags and inline styles generated here reach the mail.

export const reviewLocales = ['da', 'sv'] as const;
export type ReviewLocale = (typeof reviewLocales)[number];
export type Align = 'left' | 'center' | 'right';
export type ReviewBlock =
  | {
      id: string;
      type: 'image';
      src: string;
      alt: string;
      width: number;
      align: Align;
      href: string;
    }
  | {
      id: string;
      type: 'heading' | 'text';
      html: string;
      align: Align;
      color: string;
      size: number;
    }
  | {
      id: string;
      type: 'stars';
      caption: string;
      align: Align;
      color: string;
      size: number;
    }
  | {
      id: string;
      type: 'button';
      text: string;
      href: string;
      align: Align;
      background: string;
      color: string;
      radius: number;
    }
  | { id: string; type: 'divider'; color: string }
  | { id: string; type: 'spacer'; height: number };
export type ReviewBlockType = ReviewBlock['type'];
export type RichBlock = Extract<ReviewBlock, { html: string }>;
export type ReviewDesign = {
  background: string;
  card: string;
  text: string;
  font: 'sans' | 'serif';
};
export type ReviewTemplate = {
  enabled: boolean;
  delayDays: number;
  /** Hour of day (Danish time) the invitations go out; null sends as soon as the delay has passed. */
  sendHour: number | null;
  subject: string;
  preheader: string;
  trustpilotUrl: string;
  /** Own sender address on the verified domain of the language's invoice sender; '' uses that sender as is. */
  fromAddress: string;
  /** Sender name in the inbox; '' uses the invoice sender's name. */
  fromName: string;
  design: ReviewDesign;
  blocks: ReviewBlock[];
};
export type ReviewSettings = {
  enabled: boolean;
  templates: Record<ReviewLocale, ReviewTemplate>;
};
export type ReviewVars = {
  firstName: string;
  orderName: string;
  store: string;
};

export const trustpilotGreen = '#00b67a';
export const reviewVariables = [
  ['{{fornavn}}', 'Kundens fornavn'],
  ['{{ordrenummer}}', 'Ordrenummer'],
  ['{{butik}}', 'Butikkens navn'],
] as const;
export const localeNames: Record<ReviewLocale, string> = {
  da: 'Dansk',
  sv: 'Svensk',
};
export const localeCountry: Record<ReviewLocale, string> = {
  da: 'DK',
  sv: 'SE',
};
const fonts = {
  sans: "Helvetica, Arial, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
};
export const sampleVars = (store: string): ReviewVars => ({
  firstName: 'Anna',
  orderName: '#1001',
  store,
});

export class ReviewTemplateError extends Error {}
const fail = (message: string): never => {
  throw new ReviewTemplateError(message);
};

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const color = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
const number = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
/**
 * The default hour for new and older templates: mid-morning on the day the delay ends. Review platforms report the
 * most answers to product review requests around 10 (Feefo) and 10-12 (Kudobuzz); see docs/platform/REVIEW-INVITATIONS.md.
 */
export const recommendedSendHour = 10;
/** A saved hour (0-23), null for "as soon as the delay has passed", or the recommended hour when never chosen. */
export const sendHourOf = (value: unknown): number | null =>
  value === null
    ? null
    : typeof value === 'number' && Number.isInteger(value)
      ? Math.min(23, Math.max(0, value))
      : recommendedSendHour;
/** Hours after the chosen hour in which the runs still send (a busy shop sends at most a few mails per run). */
export const sendWindowHours = 3;
const zone = 'Europe/Copenhagen',
  zoneParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
/** Danish calendar date and hour of an instant. */
function danish(ms: number) {
  const p = Object.fromEntries(
    zoneParts.formatToParts(ms).map((x) => [x.type, Number(x.value)]),
  );
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute };
}
/** The instant of a Danish date (the day may run past the month) at the given hour. */
function danishAt(y: number, m: number, d: number, hour: number) {
  const wanted = Date.UTC(y, m - 1, d, hour);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const l = danish(guess);
    guess -= Date.UTC(l.y, l.m - 1, l.d, l.h, l.min) - wanted;
  }
  return guess;
}
/**
 * When an order's invitation is due: the delay counted in Danish calendar days from the shipping day, at the chosen
 * hour; without an hour, exactly the delay after shipping.
 */
export function invitationDueAt(
  shippedMs: number,
  delayDays: number,
  sendHour: number | null,
) {
  if (sendHour === null) return shippedMs + delayDays * 86400000;
  const l = danish(shippedMs);
  return danishAt(l.y, l.m, l.d + delayDays, sendHour);
}
/** Whether the runs may send at this instant: within the window after the chosen hour (any time without one). */
export function inSendWindow(nowMs: number, sendHour: number | null) {
  return (
    sendHour === null ||
    (danish(nowMs).h - sendHour + 24) % 24 < sendWindowHours
  );
}
/** When a due invitation goes out: now within the window, otherwise when the window next opens. */
export function nextSendAt(nowMs: number, sendHour: number | null) {
  if (inSendWindow(nowMs, sendHour)) return nowMs;
  const l = danish(nowMs),
    today = danishAt(l.y, l.m, l.d, sendHour as number);
  return today > nowMs
    ? today
    : danishAt(l.y, l.m, l.d + 1, sendHour as number);
}
const align = (value: unknown): Align =>
  value === 'left' || value === 'right' ? value : 'center';
const plain = (value: unknown, max: number) =>
  typeof value === 'string'
    ? // oxlint-disable-next-line eslint/no-control-regex -- Remove control characters from text typed in the editor.
      value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, max)
    : '';
/** A link or image address: http(s) without credentials, mailto, or the {{trustpilot}} placeholder. */
export function safeUrl(value: unknown, kind: 'link' | 'image'): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return '';
  if (kind === 'link' && s === '{{trustpilot}}') return s;
  if (s.length > 600) return '';
  if (kind === 'link' && /^mailto:[^\s<>"']+@[^\s<>"']+$/i.test(s)) return s;
  try {
    const url = new URL(s);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return '';
    return url.href;
  } catch {
    return '';
  }
}

const inlineTags = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'a']);
const blockTags = new Set(['div', 'p']);
/**
 * Formatted text from the editor (contentEditable): bold, italic, underline, links and line breaks survive, every
 * other tag and every attribute except a checked link address is dropped. Paragraph tags become line breaks, so
 * the result renders the same in every mail client.
 */
export function sanitizeRich(value: unknown, max = 4000): string {
  const source = typeof value === 'string' ? value.slice(0, max * 2) : '';
  const out: string[] = [],
    open: string[] = [];
  for (const token of source.split(/(<[^>]*>)/)) {
    if (!token) continue;
    if (!token.startsWith('<')) {
      // Text as the browser serialises it: entities stay, a stray & or > is escaped.
      out.push(
        token
          .replace(/&(?!(?:[a-z]{2,8}|#\d{1,6}|#x[0-9a-f]{1,6});)/gi, '&amp;')
          .replace(/>/g, '&gt;'),
      );
      continue;
    }
    const m = token.match(/^<\s*(\/)?\s*([a-z0-9]+)([^>]*)>$/i);
    if (!m) continue;
    const closing = !!m[1],
      tag = m[2].toLowerCase();
    if (blockTags.has(tag)) {
      // <div>line</div><div>line</div> → line<br>line
      if (!closing && out.length && !out.join('').endsWith('<br>'))
        out.push('<br>');
      continue;
    }
    if (!inlineTags.has(tag)) continue;
    const name = tag === 'strong' ? 'b' : tag === 'em' ? 'i' : tag;
    if (name === 'br') {
      out.push('<br>');
      continue;
    }
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      // Close what was opened inside it as well, so the tags stay balanced.
      for (const inner of open.splice(at).reverse()) out.push(`</${inner}>`);
      continue;
    }
    if (name === 'a') {
      const href = m[3].match(/href\s*=\s*("([^"]*)"|'([^']*)')/i),
        url = safeUrl(
          (href?.[2] ?? href?.[3] ?? '').replace(/&amp;/g, '&'),
          'link',
        );
      if (!url) continue;
      out.push(`<a href="${escapeHtml(url)}">`);
    } else out.push(`<${name}>`);
    open.push(name);
  }
  for (const inner of open.reverse()) out.push(`</${inner}>`);
  const html = out
    .join('')
    .replace(/^(<br>)+|(<br>)+$/g, '')
    .replace(/(<br>){3,}/g, '<br><br>');
  if (html.length > max) fail('En tekstblok er for lang.');
  return html;
}

let counter = 0;
export const blockId = () =>
  'b' + Date.now().toString(36) + (counter++).toString(36);

/** A new block of a type, as added from the editor's palette. */
export function newBlock(
  type: ReviewBlockType,
  locale: ReviewLocale,
): ReviewBlock {
  const id = blockId(),
    sv = locale === 'sv';
  switch (type) {
    case 'image':
      return {
        id,
        type,
        src: '',
        alt: '',
        width: 40,
        align: 'center',
        href: '',
      };
    case 'heading':
      return {
        id,
        type,
        html: sv ? 'Ny rubrik' : 'Ny overskrift',
        align: 'center',
        color: '#17201b',
        size: 26,
      };
    case 'text':
      return {
        id,
        type,
        html: sv ? 'Skriv din text här.' : 'Skriv din tekst her.',
        align: 'center',
        color: '#4a524d',
        size: 16,
      };
    case 'stars':
      return {
        id,
        type,
        caption: sv
          ? 'Klicka på en stjärna för att betygsätta oss'
          : 'Klik på en stjerne for at bedømme os',
        align: 'center',
        color: trustpilotGreen,
        size: 40,
      };
    case 'button':
      return {
        id,
        type,
        text: sv ? 'Skriv ett omdöme' : 'Skriv en anmeldelse',
        href: '{{trustpilot}}',
        align: 'center',
        background: trustpilotGreen,
        color: '#ffffff',
        radius: 8,
      };
    case 'divider':
      return { id, type, color: '#e6e1d8' };
    case 'spacer':
      return { id, type, height: 24 };
  }
}

/** The Trustpilot page where a customer writes a review of the domain, in the customer's language. */
export const trustpilotEvaluateUrl = (locale: ReviewLocale, domain: string) =>
  `https://${locale === 'sv' ? 'se' : 'dk'}.trustpilot.com/evaluate/${domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')}`;

export function defaultTemplate(
  locale: ReviewLocale,
  domain: string,
): ReviewTemplate {
  const sv = locale === 'sv';
  const text = (html: string, extra: Partial<ReviewBlock> = {}) =>
    ({
      ...newBlock('text', locale),
      html,
      ...extra,
    }) as ReviewBlock;
  return {
    enabled: true,
    delayDays: sv ? 7 : 5,
    sendHour: recommendedSendHour,
    subject: sv
      ? 'Hur var din upplevelse hos {{butik}}?'
      : 'Hvordan var din oplevelse hos {{butik}}?',
    preheader: sv
      ? 'Dela din upplevelse på Trustpilot – det tar bara en minut.'
      : 'Del din oplevelse på Trustpilot – det tager kun et minut.',
    trustpilotUrl: trustpilotEvaluateUrl(locale, domain),
    fromAddress: '',
    fromName: '',
    design: {
      background: '#f4efe7',
      card: '#ffffff',
      text: '#17201b',
      font: 'sans',
    },
    blocks: [
      {
        ...(newBlock('heading', locale) as RichBlock),
        html: '<b>{{butik}}</b>',
        size: 20,
        color: '#7a5c30',
      },
      { ...newBlock('divider', locale) },
      { ...newBlock('spacer', locale), height: 8 } as ReviewBlock,
      {
        ...(newBlock('heading', locale) as RichBlock),
        html: sv
          ? 'Hur var din upplevelse, {{fornavn}}?'
          : 'Hvordan var din oplevelse, {{fornavn}}?',
        size: 28,
      },
      text(
        sv
          ? 'Tack för att du handlade hos {{butik}}. Vi hoppas att du är nöjd med din order {{ordrenummer}}.<br><br>Vill du hjälpa oss och andra kunder genom att dela din upplevelse på Trustpilot? Det tar bara en minut.'
          : 'Tak fordi du handlede hos {{butik}}. Vi håber, du er glad for din ordre {{ordrenummer}}.<br><br>Vil du hjælpe os og andre kunder ved at dele din oplevelse på Trustpilot? Det tager kun et minut.',
      ),
      newBlock('stars', locale),
      newBlock('button', locale),
      { ...newBlock('spacer', locale), height: 16 } as ReviewBlock,
      newBlock('divider', locale),
      text(
        sv
          ? 'Har du frågor om din order kan du bara svara på det här mejlet.<br><br>Med vänliga hälsningar<br><b>{{butik}}</b>'
          : 'Har du spørgsmål til din ordre, kan du blot svare på denne mail.<br><br>Mange hilsner<br><b>{{butik}}</b>',
        { size: 14, color: '#6b736e' },
      ),
    ],
  };
}

export const defaultSettings = (domain: string): ReviewSettings => ({
  enabled: false,
  templates: {
    da: defaultTemplate('da', domain),
    sv: defaultTemplate('sv', domain),
  },
});

/** Checks and cleans a template as saved from the editor. Throws ReviewTemplateError with the reason. */
export function normalizeTemplate(
  input: unknown,
  locale: ReviewLocale,
): ReviewTemplate {
  const t = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >;
  const name = localeNames[locale].toLowerCase();
  const subject = plain(t.subject, 200).trim();
  if (!subject) fail(`Udfyld emnelinjen i den ${name}e mail.`);
  const trustpilotUrl = safeUrl(t.trustpilotUrl, 'image');
  if (!trustpilotUrl || !trustpilotUrl.startsWith('https://'))
    fail(`Angiv et Trustpilot-link (https://…) til den ${name}e mail.`);
  const fromAddress = plain(t.fromAddress, 254).trim().toLowerCase();
  if (
    fromAddress &&
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      fromAddress,
    )
  )
    fail(`Angiv en gyldig afsenderadresse til den ${name}e mail.`);
  const fromName = plain(t.fromName, 120).trim();
  if (/[<>"]/.test(fromName))
    fail(`Afsendernavnet i den ${name}e mail må ikke indeholde < > eller ".`);
  const d = (t.design || {}) as Record<string, unknown>;
  const blocks: unknown[] = Array.isArray(t.blocks) ? t.blocks : [];
  if (!blocks.length) fail(`Den ${name}e mail har intet indhold.`);
  if (blocks.length > 40) fail('Mailen kan højst have 40 elementer.');
  const ids = new Set<string>();
  const clean = blocks.map((value): ReviewBlock => {
    const raw = (value && typeof value === 'object' ? value : {}) as Record<
      string,
      unknown
    >;
    let id =
      typeof raw?.id === 'string' && /^[\w-]{1,40}$/.test(raw.id)
        ? raw.id
        : blockId();
    if (ids.has(id)) id = blockId();
    ids.add(id);
    switch (raw?.type) {
      case 'image':
        return {
          id,
          type: 'image',
          src: safeUrl(raw.src, 'image'),
          alt: plain(raw.alt, 200),
          width: number(raw.width, 10, 100, 40),
          align: align(raw.align),
          href: safeUrl(raw.href, 'link'),
        };
      case 'heading':
      case 'text':
        return {
          id,
          type: raw.type,
          html: sanitizeRich(raw.html),
          align: align(raw.align),
          color: color(
            raw.color,
            raw.type === 'heading' ? '#17201b' : '#4a524d',
          ),
          size: number(raw.size, 11, 48, raw.type === 'heading' ? 26 : 16),
        };
      case 'stars':
        return {
          id,
          type: 'stars',
          caption: plain(raw.caption, 200),
          align: align(raw.align),
          color: color(raw.color, trustpilotGreen),
          size: number(raw.size, 24, 64, 40),
        };
      case 'button':
        return {
          id,
          type: 'button',
          text: plain(raw.text, 80).trim() || 'Trustpilot',
          href: safeUrl(raw.href, 'link') || '{{trustpilot}}',
          align: align(raw.align),
          background: color(raw.background, trustpilotGreen),
          color: color(raw.color, '#ffffff'),
          radius: number(raw.radius, 0, 30, 8),
        };
      case 'divider':
        return { id, type: 'divider', color: color(raw.color, '#e6e1d8') };
      case 'spacer':
        return { id, type: 'spacer', height: number(raw.height, 4, 120, 24) };
      default:
        return fail('Mailen indeholder et ukendt element.');
    }
  });
  return {
    enabled: t.enabled !== false,
    delayDays: number(t.delayDays, 0, 60, locale === 'sv' ? 7 : 5),
    sendHour: sendHourOf(t.sendHour),
    subject,
    preheader: plain(t.preheader, 200).trim(),
    trustpilotUrl,
    fromAddress,
    fromName,
    design: {
      background: color(d.background, '#f4efe7'),
      card: color(d.card, '#ffffff'),
      text: color(d.text, '#17201b'),
      font: d.font === 'serif' ? 'serif' : 'sans',
    },
    blocks: clean,
  };
}

export function normalizeSettings(input: unknown): ReviewSettings {
  const s = (input && typeof input === 'object' ? input : {}) as {
    enabled?: unknown;
    templates?: Record<string, unknown>;
  };
  return {
    enabled: s.enabled === true,
    templates: {
      da: normalizeTemplate(s.templates?.da, 'da'),
      sv: normalizeTemplate(s.templates?.sv, 'sv'),
    },
  };
}

/** Fills {{fornavn}}, {{ordrenummer}} and {{butik}} in text that is already HTML (values are escaped). */
export function fillVars(html: string, vars: ReviewVars) {
  return html
    .replace(/(,|\s|&nbsp;)*\{\{\s*fornavn\s*\}\}/gi, (match) =>
      vars.firstName
        ? match.replace(/\{\{\s*fornavn\s*\}\}/i, escapeHtml(vars.firstName))
        : '',
    )
    .replace(/\{\{\s*ordrenummer\s*\}\}/gi, escapeHtml(vars.orderName))
    .replace(/\{\{\s*butik\s*\}\}/gi, escapeHtml(vars.store));
}
const trustpilotLinks = (html: string, trustpilot: string) =>
  html.replace(
    /href="\{\{trustpilot\}\}"/g,
    `href="${escapeHtml(trustpilot)}"`,
  );
const linkOf = (href: string, trustpilot: string) =>
  href === '{{trustpilot}}' ? trustpilot : href;
/** A star link: Trustpilot's review form opens with that many stars chosen. */
export const starLink = (trustpilot: string, stars: number) =>
  trustpilot + (trustpilot.includes('?') ? '&' : '?') + 'stars=' + stars;

/**
 * A block's own table: Outlook for Windows (Word's renderer) ignores padding and margin on div and a, and auto
 * margins on tables, so spacing, alignment and colour sit on table cells and the align attribute.
 */
const box = (
  content: string,
  style: string,
  alignTo: Align = 'left',
  edit = false,
) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse"><tr><td${edit ? ' data-edit="html"' : ''} align="${alignTo}" style="${style}">${content}</td></tr></table>`;

/**
 * One block as mail HTML (a table row's content). With `editor`, the text a user edits in place carries
 * data-edit, so the editor can make exactly that element editable.
 */
export function renderBlock(
  block: ReviewBlock,
  template: Pick<ReviewTemplate, 'trustpilotUrl' | 'design'>,
  vars: ReviewVars | null,
  editor = false,
): string {
  const font = fonts[template.design.font],
    fill = (html: string) => (vars ? fillVars(html, vars) : html),
    tp = template.trustpilotUrl;
  switch (block.type) {
    case 'image': {
      if (!block.src)
        return editor
          ? `<div style="padding:24px;border:2px dashed #d8d2c7;border-radius:8px;text-align:center;color:#8a8f8b;font-family:${font};font-size:14px">Vælg et billede i panelet til højre</div>`
          : '';
      const img = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" width="${Math.round((536 * block.width) / 100)}" style="display:inline-block;width:${block.width}%;max-width:100%;height:auto;border:0;outline:none;text-decoration:none">`;
      return box(
        block.href && !editor
          ? `<a href="${escapeHtml(linkOf(block.href, tp))}" target="_blank">${img}</a>`
          : img,
        `text-align:${block.align};line-height:0;font-size:0`,
        block.align,
      );
    }
    case 'heading':
    case 'text': {
      const heading = block.type === 'heading';
      // A link to {{trustpilot}} in the text goes to the language's Trustpilot page.
      const fillText = (html: string) =>
        editor ? fill(html) : fill(trustpilotLinks(html, tp));
      return box(
        fillText(block.html) || (editor ? '&nbsp;' : ''),
        `padding:6px 0;font-family:${font};font-size:${block.size}px;line-height:${heading ? 1.25 : 1.6};mso-line-height-rule:at-least;color:${block.color};text-align:${block.align};${heading ? 'font-weight:700;' : ''}`,
        block.align,
        editor,
      );
    }
    case 'stars': {
      const size = block.size;
      const cell = (n: number) =>
        `${n > 1 ? '<td width="6" style="width:6px;font-size:1px;line-height:1px">&nbsp;</td>' : ''}<td width="${size}" height="${size}" align="center" valign="middle" bgcolor="${block.color}" style="width:${size}px;height:${size}px;background:${block.color};border-radius:4px;text-align:center;vertical-align:middle"><a href="${escapeHtml(editor ? '#' : starLink(tp, n))}" target="_blank" style="display:block;width:${size}px;height:${size}px;line-height:${size}px;color:#ffffff;font-size:${Math.round(size * 0.72)}px;font-family:Arial,sans-serif;text-align:center;text-decoration:none;mso-line-height-rule:exactly">&#9733;</a></td>`;
      const margin =
        block.align === 'left'
          ? '0 auto 0 0'
          : block.align === 'right'
            ? '0 0 0 auto'
            : '0 auto';
      return box(
        `${
          block.caption
            ? `<div style="font-family:${font};font-size:14px;line-height:1.4;color:#6b736e;text-align:${block.align};padding-bottom:10px">${fill(escapeHtml(block.caption))}</div>`
            : ''
        }<table role="presentation" align="${block.align}" cellpadding="0" cellspacing="0" border="0" style="margin:${margin};border-collapse:separate"><tr>${[1, 2, 3, 4, 5].map(cell).join('')}</tr></table>`,
        `padding:8px 0;text-align:${block.align}`,
        block.align,
      );
    }
    case 'button': {
      const href = editor ? '#' : linkOf(block.href, tp);
      // The padding sits on the link (the whole button is clickable); Outlook, which ignores it there, uses
      // mso-padding-alt on the cell instead.
      return box(
        `<table role="presentation" align="${block.align}" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td align="center" bgcolor="${block.background}" style="background:${block.background};border-radius:${block.radius}px;mso-padding-alt:16px 32px"><a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;background:${block.background};color:${block.color};font-family:${font};font-size:16px;font-weight:700;line-height:20px;text-decoration:none;padding:16px 32px;border-radius:${block.radius}px;mso-padding-alt:0">${fill(escapeHtml(block.text))}</a></td></tr></table>`,
        `padding:12px 0;text-align:${block.align}`,
        block.align,
      );
    }
    case 'divider':
      return box(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr><td height="1" bgcolor="${block.color}" style="height:1px;line-height:1px;font-size:1px;background:${block.color}">&nbsp;</td></tr></table>`,
        'padding:12px 0',
      );
    case 'spacer':
      return box(
        '&nbsp;',
        `height:${block.height}px;line-height:${block.height}px;font-size:1px;mso-line-height-rule:exactly`,
      ).replace('<td align', `<td height="${block.height}" align`);
  }
}

const textOf = (html: string) =>
  html
    .replace(/<br>/g, '\n')
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** The whole mail: subject, HTML and a plain text version for clients that do not show HTML. */
export function renderReviewMail(
  template: ReviewTemplate,
  vars: ReviewVars,
  locale: ReviewLocale,
) {
  const subject = textOf(fillVars(escapeHtml(template.subject), vars)).trim();
  const preheader = textOf(fillVars(escapeHtml(template.preheader), vars));
  const rows = template.blocks
    .map((b) => renderBlock(b, template, vars))
    .filter(Boolean)
    .map(
      (html) =>
        `<tr><td style="padding:0 32px;font-family:${fonts[template.design.font]}">${html}</td></tr>`,
    )
    .join('');
  const { design } = template;
  const html = `<!DOCTYPE html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(subject)}</title><!--[if mso]><style>table,td,div,p,a{font-family:${design.font === 'serif' ? 'Georgia,serif' : 'Arial,sans-serif'} !important}</style><![endif]--></head><body style="margin:0;padding:0;background:${design.background};color:${design.text}">${
    preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${design.background}">${escapeHtml(preheader)}</div>`
      : ''
  }<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${design.background}"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${design.card};border-radius:16px"><tr><td style="height:24px;line-height:24px;font-size:1px">&nbsp;</td></tr>${rows}<tr><td style="height:24px;line-height:24px;font-size:1px">&nbsp;</td></tr></table></td></tr></table></body></html>`;
  const lines: string[] = [];
  for (const b of template.blocks) {
    if (b.type === 'heading' || b.type === 'text')
      lines.push(
        textOf(
          fillVars(trustpilotLinks(b.html, template.trustpilotUrl), vars),
        ).trim(),
      );
    else if (b.type === 'stars')
      lines.push(
        (b.caption
          ? textOf(fillVars(escapeHtml(b.caption), vars)) + ': '
          : '') + template.trustpilotUrl,
      );
    else if (b.type === 'button')
      lines.push(
        `${textOf(fillVars(escapeHtml(b.text), vars))}: ${linkOf(b.href, template.trustpilotUrl)}`,
      );
  }
  const text = lines.filter(Boolean).join('\n\n');
  return { subject, html, text };
}
