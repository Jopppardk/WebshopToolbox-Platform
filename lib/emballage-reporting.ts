import {packagingAudienceTotals} from '@/lib/packaging';
import { danishDate } from '@/lib/history-policy';
import type { PackagingRow, ManualPackaging } from '@/lib/packaging';
import type { EISchema } from '@/lib/emballage-api';
export type Audience = 'household' | 'commercial' | 'unknown';
export type EIConfig = {
  startDate: string;
  responsibility: string;
  mappings: Record<string, { household: string; commercial: string }>;
};
export const emptyEIConfig: EIConfig = {
  startDate: '',
  responsibility: '',
  mappings: {},
};
export function validateEIConfig(v: EIConfig): EIConfig {
  if (
    !v ||
    !/^\d{4}-(01|04|07|10)-01$/.test(v.startDate) ||
    v.startDate < '2000-01-01' ||
    v.startDate > '2100-01-01'
  )
    throw Error('Startdatoen skal være første dag i et kvartal.');
  if (!v.responsibility || v.responsibility.length > 120) throw Error('Vælg producentansvar.');
  return {
    startDate: v.startDate,
    responsibility: v.responsibility,
    mappings: {},
  };
}
export function recentQuarters(now = new Date()) {
  const date = danishDate(now),
    year = Number(date.slice(0, 4)),
    quarter = Math.floor((Number(date.slice(5, 7)) - 1) / 3);
  return Array.from({ length: 5 }, (_, i) => {
    const start = new Date(Date.UTC(year, quarter * 3 - i * 3 - 3, 1)),
      end = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0),
      );
    return {
      id: `${start.getUTCFullYear()}-Q${Math.floor(start.getUTCMonth() / 3) + 1}`,
      label: `${Math.floor(start.getUTCMonth() / 3) + 1}. kvartal ${start.getUTCFullYear()}`,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  });
}
export const audienceRule = 'company-name-v1';
export function orderAudience(order: {
  billingAddress?: {company: string|null}|null;
  shippingAddress?: {company: string|null}|null;
}): Audience {
  if (order.billingAddress?.company?.trim() || order.shippingAddress?.company?.trim()) return 'commercial';
  return 'household';
}
export function quarterTotals(
  rows: PackagingRow[],
  manual: ManualPackaging[],
  start: string,
  end: string,
) {
  const selectedRows=rows.filter(r=>!r.test&&r.date>=start&&r.date<=end),selectedManual=manual.filter(r=>r.date>=start&&r.date<=end);
  return {...packagingAudienceTotals(selectedRows,selectedManual),sources:[...selectedRows,...selectedManual]};
}
export function mappedAnswers(
  schema: EISchema,
  mapping: { household: string; commercial: string } | undefined,
  totals: { householdGrams: number; commercialGrams: number },
  validateAmounts = true,
) {
  if (
    !mapping ||
    !mapping.household ||
    mapping.household === mapping.commercial
  )
    throw Error(
      'Vælg felter til husholdning og erhverv under integrationens indstillinger.',
    );
  const answers: Record<string, number> = {};
  for (const [audience, grams] of [
    ['household', totals.householdGrams],
    ['commercial', totals.commercialGrams],
  ] as const) {
    const name = mapping[audience],
      field = schema.fields.find((f) => f.name === name);
    if (
      !field ||
      field.type !== 'number' ||
      field.unit?.trim().toLowerCase() !== 'kg'
    )
      throw Error(
        'Formularen har ændret sig. Vælg de to kg-felter igen i indstillingerne.',
      );
    const value = grams / 1000,
      c = field.constraints || {};
    if (
      validateAmounts &&
      ((c.integer && !Number.isInteger(value)) ||
        (typeof c.min === 'number' && value < c.min) ||
        (typeof c.max === 'number' && value > c.max))
    )
      throw Error(
        'Mængderne overholder ikke formularens grænser. Ingen automatisk afrunding foretages.',
      );
    answers[name] = value;
  }
  if (schema.fields.some((f) => f.required && !(f.name in answers)))
    throw Error(
      'Formularen kræver yderligere oplysninger. Denne formular skal indberettes i portalen.',
    );
  return answers;
}
