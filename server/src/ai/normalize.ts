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

const tz = (v: string | null): string | null => {
  const t = clean(v);
  return t && isValidTimeZone(t) ? t : null;
};

/** Turns the model output into app data. Unknown ids and invalid time zones are dropped, never trusted. */
export function normalizeExtraction(ai: AiResult, ctx: ExtractionContext, model: string, now = new Date()): NormalizedExtraction {
  const dayIds = new Set(ctx.cruiseDays.map((d) => d.id));
  const items = ai.items.map((i) => ({
    type: i.type,
    title: i.title.trim(),
    startLocal: normalizeLocal(i.startLocal) ?? '',
    startTz: tz(i.startTz),
    endLocal: normalizeLocal(i.endLocal),
    endTz: tz(i.endTz),
    location: clean(i.location),
    confirmation: clean(i.confirmation),
    provider: clean(i.provider),
    cost: i.cost !== null && Number.isFinite(i.cost) ? i.cost : null,
    currency: clean(i.currency)?.toUpperCase().slice(0, 3) ?? null,
    notes: clean(i.notes),
    cruiseDayId: i.cruiseDayId && dayIds.has(i.cruiseDayId) ? i.cruiseDayId : null,
    details: Object.fromEntries(i.details.map((d) => [d.key.trim(), d.value.trim()] as const).filter(([k, v]) => k && v)),
    confidence: i.confidence,
  }));

  const cruise = ai.cruise
    ? {
        shipName: ai.cruise.shipName.trim(),
        cruiseLine: clean(ai.cruise.cruiseLine),
        cabin: clean(ai.cruise.cabin),
        bookingRef: clean(ai.cruise.bookingRef),
        notes: clean(ai.cruise.notes),
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
          }),
        ),
      }
    : null;

  return {
    documentKind: ai.documentKind.trim(),
    summary: ai.summary.trim(),
    items: items as (ItemData & { confidence: 'high' | 'medium' | 'low' })[],
    cruise: cruise && cruise.shipName ? cruise : null,
    warnings: ai.warnings.map((w) => w.trim()).filter(Boolean),
    model,
    analyzedAt: now.toISOString(),
  };
}
