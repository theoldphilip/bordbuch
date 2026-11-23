/**
 * Cost overview of a trip: sums per currency (never converted), split by kind of entry, what is paid and what is
 * still open, open payments by due date, amounts without currency and bookable entries without a price.
 * Pure functions, computed on the server so web and iOS show the same numbers.
 */
import type { Cruise, Item } from './model.ts';
import type { ItemType, PaymentStatus } from './schemas.ts';

/** Kind of a cost line: an entry type, or 'cruise' for the price of the cruise itself. */
export type CostKind = ItemType | 'cruise';

export interface CostEntry {
  /** item or cruise id */
  id: string;
  source: 'item' | 'cruise';
  kind: CostKind;
  title: string;
  /** JJJJ-MM-TT, for sorting and display; null if unknown (cruise without days). */
  date: string | null;
  cost: number;
  currency: string | null;
  paymentStatus: PaymentStatus | null;
  /** Paid so far: cost if paid, the deposit (at most cost) if deposit, else 0. */
  paid: number;
  /** cost - paid */
  open: number;
  dueDate: string | null;
}

export interface CostGroup {
  kind: CostKind;
  count: number;
  total: number;
  paid: number;
  open: number;
  entryIds: string[];
}

export interface CurrencyTotal {
  currency: string;
  total: number;
  paid: number;
  open: number;
  /** Entries in this currency without any payment state. Their amount counts as open. */
  unstated: number;
  groups: CostGroup[];
}

export interface MissingPrice {
  kind: CostKind;
  count: number;
  entryIds: string[];
}

export interface TripCosts {
  currencies: CurrencyTotal[];
  /** Entries with an amount but no currency: shown apart, never added to a sum. */
  withoutCurrency: CostEntry[];
  /** Bookable entries (and cruises) without a price. */
  missingPrice: MissingPrice[];
  /** Open or partly paid amounts with a due date, earliest first. */
  due: CostEntry[];
  entries: CostEntry[];
}

/** Types that are usually booked and paid. Activities, restaurants, notes and stations are left out of "no price". */
export const PRICED_TYPES: readonly CostKind[] = [
  'cruise', 'flight', 'train', 'bus', 'ferry', 'transfer', 'car_rental', 'parking', 'hotel', 'excursion',
];

/** Display order of the groups. */
const KIND_ORDER: readonly CostKind[] = [
  'cruise', 'flight', 'train', 'bus', 'ferry', 'transfer', 'car_rental', 'parking', 'hotel', 'excursion', 'activity', 'restaurant', 'stop', 'note',
];

/** Rounds to cents so sums of floats do not show 0.30000000000000004. */
const round = (n: number) => Math.round(n * 100) / 100;

export function paidOf(cost: number, status: PaymentStatus | null, paidAmount: number | null): number {
  if (status === 'paid') return cost;
  if (status === 'deposit') return Math.min(Math.max(paidAmount ?? 0, 0), cost);
  return 0;
}

/** A deposit amount only means something with status 'deposit'; otherwise it is dropped before saving. */
export function normalizePayment<T extends { paymentStatus: PaymentStatus | null; paidAmount: number | null }>(v: T): T {
  return v.paymentStatus === 'deposit' ? v : { ...v, paidAmount: null };
}

function entry(
  source: 'item' | 'cruise',
  e: { id: string; cost: number; currency: string | null; paymentStatus: PaymentStatus | null; paidAmount: number | null; dueDate: string | null },
  kind: CostKind,
  title: string,
  date: string | null,
): CostEntry {
  const paid = round(paidOf(e.cost, e.paymentStatus, e.paidAmount));
  return {
    id: e.id, source, kind, title, date, cost: e.cost, currency: e.currency, paymentStatus: e.paymentStatus,
    paid, open: round(e.cost - paid), dueDate: e.dueDate,
  };
}

const kindIndex = (k: CostKind) => {
  const i = KIND_ORDER.indexOf(k);
  return i < 0 ? KIND_ORDER.length : i;
};

export function computeCosts(items: Item[], cruises: Cruise[]): TripCosts {
  const entries: CostEntry[] = [];
  const missing = new Map<CostKind, string[]>();
  const noteMissing = (kind: CostKind, id: string) => {
    if (!PRICED_TYPES.includes(kind)) return;
    missing.set(kind, [...(missing.get(kind) ?? []), id]);
  };

  for (const c of cruises) {
    const date = c.days[0]?.date ?? null;
    if (c.cost == null) noteMissing('cruise', c.id);
    else entries.push(entry('cruise', { ...c, cost: c.cost }, 'cruise', c.shipName, date));
  }
  for (const i of items) {
    if (i.cost == null) noteMissing(i.type, i.id);
    else entries.push(entry('item', { ...i, cost: i.cost }, i.type, i.title, i.startLocal.slice(0, 10)));
  }
  entries.sort((a, b) => kindIndex(a.kind) - kindIndex(b.kind) || (a.date ?? '9999').localeCompare(b.date ?? '9999'));

  const byCurrency = new Map<string, CostEntry[]>();
  const withoutCurrency: CostEntry[] = [];
  for (const e of entries) {
    if (!e.currency) withoutCurrency.push(e);
    else byCurrency.set(e.currency, [...(byCurrency.get(e.currency) ?? []), e]);
  }

  const currencies: CurrencyTotal[] = [...byCurrency.entries()]
    .map(([currency, list]) => {
      const groups = new Map<CostKind, CostGroup>();
      for (const e of list) {
        const g = groups.get(e.kind) ?? { kind: e.kind, count: 0, total: 0, paid: 0, open: 0, entryIds: [] };
        g.count++;
        g.total = round(g.total + e.cost);
        g.paid = round(g.paid + e.paid);
        g.open = round(g.open + e.open);
        g.entryIds.push(e.id);
        groups.set(e.kind, g);
      }
      return {
        currency,
        total: round(list.reduce((s, e) => s + e.cost, 0)),
        paid: round(list.reduce((s, e) => s + e.paid, 0)),
        open: round(list.reduce((s, e) => s + e.open, 0)),
        unstated: list.filter((e) => e.paymentStatus === null).length,
        groups: [...groups.values()].sort((a, b) => kindIndex(a.kind) - kindIndex(b.kind)),
      };
    })
    // Largest amount first: that is usually the currency the trip was booked in.
    .sort((a, b) => b.total - a.total || a.currency.localeCompare(b.currency));

  const missingPrice = [...missing.entries()]
    .map(([kind, entryIds]) => ({ kind, count: entryIds.length, entryIds }))
    .sort((a, b) => kindIndex(a.kind) - kindIndex(b.kind));

  const due = entries
    .filter((e) => e.dueDate && e.open > 0)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));

  return { currencies, withoutCurrency, missingPrice, due, entries };
}
