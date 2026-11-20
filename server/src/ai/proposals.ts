/**
 * Turns an extraction into reviewable proposals: for every extracted item it looks for an
 * existing entry that is the same booking (so the document updates it instead of duplicating it),
 * and for a cruise it looks for an existing cruise to merge into. Pure functions, no DB access.
 */
import type { Cruise, Item } from '../model.ts';
import { cruiseDayInput, itemInput } from '../schemas.ts';
import type { CruiseData, ItemData, NormalizedExtraction } from './types.ts';

const normId = (s: string | null | undefined): string => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const dayNumber = (local: string): number => {
  const [y, m, d] = local.slice(0, 10).split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
const dayDiff = (a: string, b: string): number => Math.abs(dayNumber(a) - dayNumber(b));
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s);

export interface ItemMatch {
  item: Item;
  reason: string;
}

export function matchItem(existing: Item[], p: ItemData): ItemMatch | null {
  if (!validDate(p.startLocal)) return null;
  const sameType = existing.filter((i) => i.type === p.type);

  if (p.type === 'flight') {
    const fn = normId(p.details.flightNumber);
    if (fn.length >= 3) {
      const hit = sameType.find((i) => normId(String(i.details.flightNumber ?? '')) === fn && dayDiff(i.startLocal, p.startLocal) === 0);
      if (hit) return { item: hit, reason: 'gleiche Flugnummer und gleiches Datum' };
    }
  }

  const conf = normId(p.confirmation);
  if (conf.length >= 4) {
    // Same booking reference. A round trip shares one reference, so the date must fit as well.
    const hit = sameType.find((i) => normId(i.confirmation) === conf && dayDiff(i.startLocal, p.startLocal) <= 1);
    if (hit) return { item: hit, reason: 'gleiche Buchungsnummer und passendes Datum' };
  }

  if (p.type === 'flight') {
    const from = normId(p.details.from);
    const to = normId(p.details.to);
    if (from && to) {
      const hit = sameType.find((i) => normId(String(i.details.from ?? '')) === from && normId(String(i.details.to ?? '')) === to && dayDiff(i.startLocal, p.startLocal) === 0);
      if (hit) return { item: hit, reason: 'gleiche Strecke und gleiches Datum' };
    }
    return null;
  }

  const hit = sameType.find((i) => dayDiff(i.startLocal, p.startLocal) === 0 && titleSimilarity(i.title, p.title) >= 0.6);
  return hit ? { item: hit, reason: 'ähnlicher Titel am gleichen Tag' } : null;
}

const FIELD_LABELS: [keyof ItemData, string][] = [
  ['startLocal', 'Beginn'],
  ['endLocal', 'Ende'],
  ['startTz', 'Zeitzone Beginn'],
  ['endTz', 'Zeitzone Ende'],
  ['location', 'Ort'],
  ['confirmation', 'Buchungsnummer'],
  ['provider', 'Anbieter'],
  ['cost', 'Kosten'],
  ['currency', 'Währung'],
  ['cruiseDayId', 'Kreuzfahrt-Tag'],
];

const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '–' : String(v).replace(/^(\d{4}-\d{2}-\d{2})T/, '$1 '));

/** What an update would change on the existing item (only fields the document provides). */
export function diffItem(existing: Item, p: ItemData): string[] {
  const changes: string[] = [];
  for (const [key, label] of FIELD_LABELS) {
    const next = p[key];
    if (next === null || next === undefined || next === '') continue;
    const prev = existing[key as keyof Item];
    if (prev !== next) changes.push(`${label}: ${show(prev)} → ${show(next)}`);
  }
  for (const [k, v] of Object.entries(p.details)) {
    const prev = existing.details[k];
    if (prev !== v) changes.push(`${k}: ${show(prev)} → ${show(v)}`);
  }
  if (p.notes && !existing.notes) changes.push('Notizen ergänzt');
  return changes;
}

/** Existing item + document data. Existing title and notes are kept, new facts fill or replace the rest. */
export function mergeItem(existing: Item, p: ItemData) {
  return {
    type: existing.type,
    title: existing.title,
    startLocal: p.startLocal || existing.startLocal,
    startTz: p.startTz ?? existing.startTz,
    endLocal: p.endLocal ?? existing.endLocal,
    endTz: p.endTz ?? existing.endTz,
    location: p.location ?? existing.location,
    confirmation: p.confirmation ?? existing.confirmation,
    provider: p.provider ?? existing.provider,
    cost: p.cost ?? existing.cost,
    currency: p.currency ?? existing.currency,
    notes: existing.notes ?? p.notes,
    cruiseDayId: p.cruiseDayId ?? existing.cruiseDayId,
    details: { ...existing.details, ...p.details },
  };
}

export interface CruiseMatch {
  cruise: Cruise;
  reason: string;
}

export function matchCruise(cruises: Cruise[], p: CruiseData): CruiseMatch | null {
  const ref = normId(p.bookingRef);
  if (ref.length >= 4) {
    const hit = cruises.find((c) => normId(c.bookingRef) === ref);
    if (hit) return { cruise: hit, reason: 'gleiche Buchungsnummer' };
  }
  const ship = normId(p.shipName);
  const hit = ship ? cruises.find((c) => normId(c.shipName) === ship) : undefined;
  return hit ? { cruise: hit, reason: 'gleicher Schiffsname' } : null;
}

/** An existing day counts as the same when date and kind match, or the date is unique. */
export function findDay(cruise: Cruise, d: { date: string; kind: string }) {
  return (
    cruise.days.find((x) => x.date === d.date && x.kind === d.kind) ??
    (cruise.days.filter((x) => x.date === d.date).length === 1 ? cruise.days.find((x) => x.date === d.date) : undefined)
  );
}

// ---------------------------------------------------------------------------
// View model returned to clients
// ---------------------------------------------------------------------------
export interface ItemProposal {
  index: number;
  data: ItemData;
  confidence: 'high' | 'medium' | 'low';
  match: { itemId: string; title: string; reason: string; changes: string[] } | null;
  problems: string[];
}

export interface CruiseProposal {
  data: CruiseData;
  match: { cruiseId: string; shipName: string; reason: string } | null;
  newDays: number;
  updatedDays: number;
  problems: string[];
}

export interface AnalysisView {
  suggestedTripTitle: string | null;
  documentKind: string;
  summary: string;
  warnings: string[];
  model: string;
  analyzedAt: string;
  items: ItemProposal[];
  cruise: CruiseProposal | null;
}

const FIELD_NAMES: Record<string, string> = {
  type: 'Art', title: 'Titel', startLocal: 'Beginn', endLocal: 'Ende', startTz: 'Zeitzone Beginn', endTz: 'Zeitzone Ende',
  location: 'Ort', confirmation: 'Buchungsnummer', provider: 'Anbieter', cost: 'Kosten', currency: 'Währung', cruiseDayId: 'Kreuzfahrt-Tag',
};
const issues = (path: (string | number)[], message: string) => `${FIELD_NAMES[String(path[0])] ?? String(path[0] ?? 'Eintrag')}: ${message}`;

export function buildProposals(ex: NormalizedExtraction, trip: { items: Item[]; cruises: Cruise[] }): AnalysisView {
  const items = ex.items.map((raw, index): ItemProposal => {
    const { confidence, ...data } = raw;
    const found = matchItem(trip.items, data);
    const parsed = itemInput.safeParse(data);
    return {
      index,
      data,
      confidence,
      match: found ? { itemId: found.item.id, title: found.item.title, reason: found.reason, changes: diffItem(found.item, data) } : null,
      problems: parsed.success ? [] : parsed.error.issues.map((i) => issues(i.path as (string | number)[], i.message)),
    };
  });

  let cruise: CruiseProposal | null = null;
  if (ex.cruise) {
    const found = matchCruise(trip.cruises, ex.cruise);
    const problems = ex.cruise.days.flatMap((d, n) => {
      const r = cruiseDayInput.safeParse(d);
      return r.success ? [] : r.error.issues.map((i) => `Tag ${n + 1} (${d.date}): ${i.message}`);
    });
    let updatedDays = 0;
    if (found) for (const d of ex.cruise.days) if (findDay(found.cruise, d)) updatedDays++;
    cruise = {
      data: ex.cruise,
      match: found ? { cruiseId: found.cruise.id, shipName: found.cruise.shipName, reason: found.reason } : null,
      newDays: ex.cruise.days.length - updatedDays,
      updatedDays,
      problems,
    };
  }

  return {
    suggestedTripTitle: ex.suggestedTripTitle ?? null,
    documentKind: ex.documentKind,
    summary: ex.summary,
    warnings: ex.warnings,
    model: ex.model,
    analyzedAt: ex.analyzedAt,
    items,
    cruise,
  };
}
