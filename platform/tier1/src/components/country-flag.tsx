// Small inline flags (no external images, so the page's content policy is kept). Common European
// countries are drawn; any other country shows its two-letter code. The country name is the tooltip.
const names = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['da'], { type: 'region' }) : null;
export const countryName = (code: string) => { try { return names?.of(code) || code; } catch { return code; } };

// Nordic crosses: field, cross, optional inner cross.
const nordic: Record<string, [string, string, string?]> = { DK: ['#C8102E', '#FFFFFF'], SE: ['#006AA7', '#FECC02'], FI: ['#FFFFFF', '#003580'], NO: ['#BA0C2F', '#FFFFFF', '#00205B'], IS: ['#02529C', '#FFFFFF', '#DC1E35'] };
const horizontal: Record<string, string[]> = { DE: ['#000000', '#DD0000', '#FFCE00'], NL: ['#AE1C28', '#FFFFFF', '#21468B'], AT: ['#ED2939', '#FFFFFF', '#ED2939'], LU: ['#EF3340', '#FFFFFF', '#00A3E0'], HU: ['#CE2939', '#FFFFFF', '#477050'], EE: ['#0072CE', '#000000', '#FFFFFF'], LT: ['#FDB913', '#006A44', '#C1272D'], BG: ['#FFFFFF', '#00966E', '#D62612'], PL: ['#FFFFFF', '#DC143C'], UA: ['#0057B7', '#FFD700'] };
const vertical: Record<string, string[]> = { FR: ['#0055A4', '#FFFFFF', '#EF4135'], IT: ['#009246', '#FFFFFF', '#CE2B37'], IE: ['#169B62', '#FFFFFF', '#FF883E'], BE: ['#000000', '#FDDA24', '#EF3340'], RO: ['#002B7F', '#FCD116', '#CE1126'] };

function Shape({ code }: { code: string }) {
  if (nordic[code]) {
    const [field, cross, inner] = nordic[code];
    return <><rect width="20" height="14" fill={field} /><rect x="5" width="4" height="14" fill={cross} /><rect y="5" width="20" height="4" fill={cross} />{inner && <><rect x="6" width="2" height="14" fill={inner} /><rect y="6" width="20" height="2" fill={inner} /></>}</>;
  }
  const bands = horizontal[code] || vertical[code];
  if (!bands) return null;
  const size = (horizontal[code] ? 14 : 20) / bands.length;
  return <>{bands.map((color, i) => horizontal[code] ? <rect key={i} y={i * size} width="20" height={size} fill={color} /> : <rect key={i} x={i * size} width={size} height="14" fill={color} />)}</>;
}

export function CountryFlag({ code, className = '' }: { code: string | null | undefined; className?: string }) {
  if (!code) return null;
  const name = countryName(code), drawn = !!(nordic[code] || horizontal[code] || vertical[code]);
  return drawn
    ? <svg role="img" aria-label={name} viewBox="0 0 20 14" className={'inline-block h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px] align-[-2px] ring-1 ring-black/10 ' + className}><title>{name}</title><Shape code={code} /></svg>
    : <span title={name} aria-label={name} className={'inline-grid h-3.5 min-w-5 place-items-center rounded-[2px] bg-muted px-0.5 align-[-2px] text-[9px] font-semibold leading-none text-muted-foreground ring-1 ring-black/10 ' + className}>{code}</span>;
}
