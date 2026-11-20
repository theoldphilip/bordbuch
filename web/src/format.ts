import type { CruiseDayKind, Item, ItemType } from './types.ts';

const locale = 'de-CH';

const parseDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`);

export function fmtDate(d: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '';
  return parseDate(d).toLocaleDateString(locale, opts);
}

export const fmtDayHeader = (d: string) =>
  parseDate(d).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' });

export function fmtRange(start: string | null, end: string | null) {
  if (!start) return 'Noch keine Daten';
  if (!end || end === start) return fmtDate(start);
  const s = parseDate(start);
  const e = parseDate(end);
  if (s.getFullYear() === e.getFullYear()) {
    return `${fmtDate(start, { day: 'numeric', month: 'short' })} – ${fmtDate(end)}`;
  }
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((parseDate(date).getTime() - today.getTime()) / 86_400_000);
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, n: number) {
  const d = parseDate(date);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtMoney(amount: number, currency: string | null) {
  try {
    return amount.toLocaleString(locale, { style: 'currency', currency: currency ?? 'CHF' });
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ''}`;
  }
}

/** Short zone label, e.g. "MESZ" or "GMT-4", for a given zone on a given date. */
export function tzLabel(tz: string, date: string) {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' }).formatToParts(parseDate(date));
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

export const ITEM_TYPES: { type: ItemType; label: string; icon: string }[] = [
  { type: 'flight', label: 'Flug', icon: '✈️' },
  { type: 'train', label: 'Zug', icon: '🚆' },
  { type: 'transfer', label: 'Transfer', icon: '🚐' },
  { type: 'hotel', label: 'Übernachtung', icon: '🏨' },
  { type: 'parking', label: 'Parkplatz', icon: '🅿️' },
  { type: 'car_rental', label: 'Mietwagen', icon: '🚗' },
  { type: 'bus', label: 'Bus', icon: '🚌' },
  { type: 'ferry', label: 'Fähre', icon: '⛴️' },
  { type: 'excursion', label: 'Landausflug', icon: '🧭' },
  { type: 'activity', label: 'Aktivität', icon: '🎟️' },
  { type: 'restaurant', label: 'Restaurant', icon: '🍽️' },
  { type: 'note', label: 'Notiz', icon: '📝' },
];
export const itemTypeInfo = (t: ItemType) => ITEM_TYPES.find((x) => x.type === t)!;

export const startLabel: Partial<Record<ItemType, string>> = {
  flight: 'Abflug',
  train: 'Abfahrt',
  bus: 'Abfahrt',
  ferry: 'Abfahrt',
  transfer: 'Abholung',
  car_rental: 'Abholung',
  parking: 'Einfahrt',
  hotel: 'Check-in',
};
export const endLabel: Partial<Record<ItemType, string>> = {
  flight: 'Ankunft',
  train: 'Ankunft',
  bus: 'Ankunft',
  ferry: 'Ankunft',
  transfer: 'Ankunft',
  car_rental: 'Rückgabe',
  parking: 'Ausfahrt',
  hotel: 'Check-out',
};

export const DAY_KINDS: { kind: CruiseDayKind; label: string; icon: string }[] = [
  { kind: 'embarkation', label: 'Einschiffung', icon: '🛳️' },
  { kind: 'port', label: 'Hafentag', icon: '⚓' },
  { kind: 'sea', label: 'Seetag', icon: '🌊' },
  { kind: 'disembarkation', label: 'Ausschiffung', icon: '🧳' },
];
export const dayKindInfo = (k: CruiseDayKind) => DAY_KINDS.find((x) => x.kind === k)!;

/** One-line summary of type-specific details for list views. */
export function itemSubtitle(item: Item): string {
  const d = item.details ?? {};
  const parts: string[] = [];
  if (d.from || d.to) parts.push(`${d.from ?? '?'} → ${d.to ?? '?'}`);
  if (d.flightNumber) parts.push(d.flightNumber);
  if (d.trainNumber) parts.push(d.trainNumber);
  if (item.type === 'excursion') parts.push(d.bookedVia === 'private' ? 'privat gebucht' : 'über Reederei');
  if (d.mode) parts.push(d.mode);
  if (d.plate) parts.push(d.plate);
  if (d.meetingPoint) parts.push(`Treffpunkt: ${d.meetingPoint}`);
  if (item.location && !(d.from || d.to)) parts.push(item.location);
  if (item.provider) parts.push(item.provider);
  return parts.join(' · ');
}

export const ROLE_LABELS = { owner: 'Besitzer', editor: 'Bearbeiten', viewer: 'Nur ansehen' } as const;

export const COMMON_TIMEZONES = [
  'Europe/Zurich',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Athens',
  'Europe/Istanbul',
  'Europe/Oslo',
  'Atlantic/Reykjavik',
  'Atlantic/Canary',
  'Asia/Dubai',
  'Asia/Singapore',
  'America/New_York',
  'America/Los_Angeles',
  'America/Puerto_Rico',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Australia/Sydney',
];
