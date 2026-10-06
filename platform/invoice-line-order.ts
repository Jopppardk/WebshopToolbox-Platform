import type { CheckedLine } from './invoice-check';

const engraving = (line: CheckedLine) => line.kind !== 'shipping' && /^(?:indgravering|gravering)\b/i.test(line.title);
const engravingNumber = (line: CheckedLine) => Number(line.title.match(/\blinje\s+(\d+)\b/i)?.[1] ?? Infinity);

// The shop places each engraving block immediately BEFORE its physical product
// (confirmed against order 2647). Use Shopify requiresShipping (kind=goods), never
// brand/model names. A service or shipping line ends an unattached block.
// Display only: original checked lines and their financial fingerprint stay intact.
export function invoiceDisplayLines(lines: readonly CheckedLine[]): CheckedLine[] {
  const groups: CheckedLine[][] = [], other: CheckedLine[] = [], shipping: CheckedLine[] = [];
  let pending: CheckedLine[] = [];
  for (const line of lines) {
    if (engraving(line)) { pending.push(line); continue; }
    if (line.kind === 'goods') {
      groups.push([line, ...pending.sort((a, b) => engravingNumber(a) - engravingNumber(b))]);
    } else {
      other.push(...pending);
      (line.kind === 'shipping' ? shipping : other).push(line);
    }
    pending = [];
  }
  return [...groups.flat(), ...other, ...pending, ...shipping];
}
