import { PAYMENT_STATUSES, type Info, type PaymentStatus } from '../schemas.ts';
import { isValidTimeZone } from '../util.ts';
import type { AiResult } from './schema.ts';
import type { CruiseDayData, ExtractionContext, ItemData, NormalizedExtraction } from './types.ts';

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** "2027-05-08 09:40:00", "2027-05-08T09:40Z" → "2027-05-08T09:40"; date-only stays as is. */
export function normalizeLocal(v: string | null | undefined): string | null {
  const t = clean(v);
  if (!t) return null;
  const m = t.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return t; // leave as is; validation reports it to the user
  return m[2] ? `${m[1]}T${m[2].padStart(2, '0')}:${m[3]}` : m[1]!;
}

function normalizeTime(v: string | null): string | null {
  const t = clean(v);
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[:.](\d{2})/);
  return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : t;
}

const infos = (list: AiResult['items'][number]['infos']): Info[] =>
  list
    .map((i) => ({ label: i.label.trim().slice(0, 80), value: i.value.trim().slice(0, 500), kind: i.kind, source: i.source }) satisfies Info)
    .filter((i) => i.label && i.value)
    .slice(0, 30);

const money = (v: number | null | undefined): number | null => (v !== null && v !== undefined && Number.isFinite(v) ? v : null);
const currency = (v: string | null | undefined): string | null => clean(v)?.toUpperCase().slice(0, 3) ?? null;

/**
 * The payment state comes as entries of the "details" list (not as own schema fields: they made the structured-output
 * grammar too large, see schema.ts). These keys are taken out of the details and become the payment fields.
 */
export const PAYMENT_DETAIL_KEYS = ['paymentStatus', 'paidAmount', 'dueDate'] as const;

/** "1'250,50", "1.250,50 EUR", "1,250.50", "500" → number; anything else → null. */
export function amount(v: string | undefined): number | null {
  const t = v?.replace(/[^\d.,]/g, '');
  if (!t || !/\d/.test(t)) return null;
  // A separator followed by one or two digits at the end is the decimal mark; every other separator groups thousands.
  const m = t.match(/^(.*)[.,](\d{1,2})$/);
  const n = m ? Number(`${m[1]!.replace(/[.,]/g, '') || '0'}.${m[2]}`) : Number(t.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Payment state read from the document. Only with a price; a deposit amount only with state 'deposit' and never
 * above the price; a due date only as a real date. Missing values count as not stated.
 */
function payment(cost: number | null, d: Record<string, string>) {
  const status = cost !== null && (PAYMENT_STATUSES as readonly string[]).includes(d.paymentStatus ?? '') ? (d.paymentStatus as PaymentStatus) : null;
  const paid = status === 'deposit' ? amount(d.paidAmount) : null;
  const due = normalizeLocal(d.dueDate)?.slice(0, 10) ?? null;
  return {
    paymentStatus: status,
    paidAmount: paid !== null && paid >= 0 && cost !== null && paid <= cost ? paid : null,
    dueDate: cost !== null && status !== 'paid' && due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
  };
}

const tz = (v: string | null): string | null => {
  const t = clean(v);
  return t && isValidTimeZone(t) ? t : null;
};

/** Turns the model output into app data. Unknown ids and invalid time zones are dropped, never trusted. */
export function normalizeExtraction(ai: AiResult, ctx: ExtractionContext, model: string, now = new Date()): NormalizedExtraction {
  const dayIds = new Set(ctx.cruiseDays.map((d) => d.id));
  const items = ai.items.map((i) => {
    const allDetails: Record<string, string> = Object.fromEntries(
      i.details.map((d) => [d.key.trim(), d.value.trim()] as const).filter(([k, v]) => k && v),
    );
    const details = Object.fromEntries(Object.entries(allDetails).filter(([k]) => !(PAYMENT_DETAIL_KEYS as readonly string[]).includes(k)));
    const cost = money(i.cost);
    return {
    type: i.type,
    title: i.title.trim(),
    startLocal: normalizeLocal(i.startLocal) ?? '',
    startTz: tz(i.startTz),
    endLocal: normalizeLocal(i.endLocal),
    endTz: tz(i.endTz),
    location: clean(i.location),
    confirmation: clean(i.confirmation),
    provider: clean(i.provider),
    cost,
    currency: currency(i.currency),
    ...payment(cost, allDetails),
    notes: clean(i.notes),
    cruiseDayId: i.cruiseDayId && dayIds.has(i.cruiseDayId) ? i.cruiseDayId : null,
    infos: infos(i.infos),
    details,
    confidence: i.confidence,
    };
  });

  const cruise = ai.cruise
    ? {
        shipName: ai.cruise.shipName.trim(),
        cruiseLine: clean(ai.cruise.cruiseLine),
        cabin: clean(ai.cruise.cabin),
        bookingRef: clean(ai.cruise.bookingRef),
        cost: money(ai.cruise.cost),
        currency: currency(ai.cruise.currency),
        // The cruise has no details list and no own payment fields (grammar size, see schema.ts): payment state is entered by hand.
        notes: clean(ai.cruise.notes),
        infos: infos(ai.cruise.infos),
        days: ai.cruise.days.map(
          (d): CruiseDayData => ({
            date: normalizeLocal(d.date)?.slice(0, 10) ?? d.date,
            kind: d.kind,
            portName: clean(d.portName),
            country: clean(d.country),
            timezone: tz(d.timezone),
            arrival: normalizeTime(d.arrival),
            departure: normalizeTime(d.departure),
            allAboard: normalizeTime(d.allAboard),
            tender: d.tender,
            notes: clean(d.notes),
            infos: infos(d.infos),
          }),
        ),
      }
    : null;

  return {
    suggestedTripTitle: clean(ai.suggestedTripTitle),
    documentKind: ai.documentKind.trim(),
    summary: ai.summary.trim(),
    items: items as (ItemData & { confidence: 'high' | 'medium' | 'low' })[],
    cruise: cruise && cruise.shipName ? cruise : null,
    warnings: ai.warnings.map((w) => w.trim()).filter(Boolean),
    model,
    analyzedAt: now.toISOString(),
  };
}
