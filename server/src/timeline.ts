/**
 * Builds the phase-structured timeline of a trip (Vorprogramm → Kreuzfahrt → Nachprogramm)
 * and checks for tight connections. Pure functions, no DB access, so the logic is testable
 * and every client (web, iOS) gets identical results from GET /api/trips/:id/timeline.
 */
import type { Cruise, CruiseDay, Item } from './model.ts';
import { SPAN_TYPES, TRANSPORT_TYPES } from './schemas.ts';

export interface TimelineEntry {
  itemId: string;
  /** 'end' = second appearance of a multi-day item (hotel check-out, car return). */
  role: 'start' | 'end';
  /** Local time HH:MM, or null for date-only entries. */
  time: string | null;
  timezone: string;
  item: Item;
}

export interface TimelineDay {
  date: string;
  cruiseDay: CruiseDay | null;
  entries: TimelineEntry[];
}

export type PhaseKind = 'trip' | 'pre' | 'cruise' | 'between' | 'post';

export interface TimelinePhase {
  kind: PhaseKind;
  title: string;
  cruiseId: string | null;
  startDate: string | null;
  endDate: string | null;
  days: TimelineDay[];
}

export interface TimelineWarning {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  itemId?: string;
  cruiseId?: string;
  cruiseDayId?: string;
}

export interface Timeline {
  phases: TimelinePhase[];
  warnings: TimelineWarning[];
}

// ---------------------------------------------------------------------------
// Time zone helpers (Intl only, no dependencies)
// ---------------------------------------------------------------------------
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = dtf(tz).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a local "YYYY-MM-DD[THH:MM]" in an IANA zone to a UTC timestamp (ms). */
export function toInstant(local: string, tz: string): number {
  const [datePart, timePart = '00:00'] = local.split('T') as [string, string?];
  const [y, m, d] = datePart.split('-').map(Number) as [number, number, number];
  const [h, mi] = timePart.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

const hasTime = (local: string | null): local is string => !!local && local.length > 10;
const timeOf = (local: string): string | null => (local.length > 10 ? local.slice(11, 16) : null);

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const totalMin = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const HOUR = 3_600_000;
const MIN = 60_000;

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
interface CruiseWindow {
  cruise: Cruise;
  embark: CruiseDay;
  disembark: CruiseDay;
  start: number;
  end: number;
}

interface PlacedEntry {
  entry: TimelineEntry;
  instant: number;
  date: string;
  cruiseDay: CruiseDay | null;
}

export function buildTimeline(cruises: Cruise[], items: Item[], defaultTz: string): Timeline {
  const dayById = new Map<string, CruiseDay>();
  for (const c of cruises) for (const d of c.days) dayById.set(d.id, d);

  const dayTz = (d: CruiseDay) => d.timezone ?? defaultTz;
  const itemTz = (item: Item, which: 'start' | 'end'): string =>
    (which === 'end' ? (item.endTz ?? item.startTz) : item.startTz) ??
    (item.cruiseDayId ? dayById.get(item.cruiseDayId)?.timezone : null) ??
    defaultTz;

  const windows: CruiseWindow[] = cruises
    .filter((c) => c.days.length > 0)
    .map((cruise) => {
      const embark = cruise.days.find((d) => d.kind === 'embarkation') ?? cruise.days[0]!;
      const disembark = [...cruise.days].reverse().find((d) => d.kind === 'disembarkation') ?? cruise.days.at(-1)!;
      const startTime = [embark.arrival, embark.allAboard, embark.departure].filter(Boolean).sort()[0] ?? '12:00';
      const endTime = disembark.departure ?? disembark.arrival ?? '09:00';
      return {
        cruise,
        embark,
        disembark,
        start: toInstant(`${embark.date}T${startTime}`, dayTz(embark)),
        end: toInstant(`${disembark.date}T${endTime}`, dayTz(disembark)),
      };
    })
    .sort((a, b) => a.start - b.start);

  // 1) Turn items into entries.
  const placed: PlacedEntry[] = [];
  for (const item of items) {
    const linkedDay = item.cruiseDayId ? (dayById.get(item.cruiseDayId) ?? null) : null;
    const startTz = itemTz(item, 'start');
    placed.push({
      entry: { itemId: item.id, role: 'start', time: timeOf(item.startLocal), timezone: startTz, item },
      instant: toInstant(item.startLocal, startTz),
      date: item.startLocal.slice(0, 10),
      cruiseDay: linkedDay,
    });
    if (SPAN_TYPES.includes(item.type) && item.endLocal && item.endLocal.slice(0, 10) !== item.startLocal.slice(0, 10)) {
      const endTz = itemTz(item, 'end');
      placed.push({
        entry: { itemId: item.id, role: 'end', time: timeOf(item.endLocal), timezone: endTz, item },
        instant: toInstant(item.endLocal, endTz),
        date: item.endLocal.slice(0, 10),
        cruiseDay: null,
      });
    }
  }

  // 2) Assign each entry to a phase slot: 0 = pre, 2i+1 = cruise i, 2i+2 = after cruise i.
  const travelTypes: readonly string[] = [...TRANSPORT_TYPES, ...SPAN_TYPES];
  const slotOf = (p: PlacedEntry): number => {
    if (p.cruiseDay) {
      const i = windows.findIndex((w) => w.cruise.id === p.cruiseDay!.cruiseId);
      if (i >= 0) return 2 * i + 1;
    }
    // Travel on embarkation/disembarkation day belongs to the land programme around the cruise.
    if (travelTypes.includes(p.entry.item.type)) {
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i]!;
        if (p.date === w.embark.date && p.instant >= w.start) return 2 * i;
        if (p.date === w.disembark.date && p.instant <= w.end) return 2 * i + 2;
      }
    }
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!;
      if (p.instant >= w.start && p.instant <= w.end) return 2 * i + 1;
    }
    const endedBefore = windows.filter((w) => w.end < p.instant).length;
    return endedBefore === 0 ? 0 : 2 * endedBefore;
  };

  const slots = new Map<number, PlacedEntry[]>();
  for (const p of placed) {
    const s = slotOf(p);
    if (!slots.has(s)) slots.set(s, []);
    slots.get(s)!.push(p);
  }

  const byInstant = (a: PlacedEntry, b: PlacedEntry) =>
    a.instant - b.instant || (a.entry.role === 'end' ? -1 : 0) - (b.entry.role === 'end' ? -1 : 0);

  const groupByDate = (entries: PlacedEntry[]): TimelineDay[] => {
    const days = new Map<string, TimelineDay>();
    for (const p of [...entries].sort(byInstant)) {
      if (!days.has(p.date)) days.set(p.date, { date: p.date, cruiseDay: null, entries: [] });
      days.get(p.date)!.entries.push(p.entry);
    }
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  };

  const phaseFromDays = (
    kind: PhaseKind,
    title: string,
    days: TimelineDay[],
    cruiseId: string | null = null,
  ): TimelinePhase => ({
    kind,
    title,
    cruiseId,
    startDate: days[0]?.date ?? null,
    endDate: days.at(-1)?.date ?? null,
    days,
  });

  const phases: TimelinePhase[] = [];
  if (windows.length === 0) {
    const days = groupByDate(placed);
    if (days.length) phases.push(phaseFromDays('trip', 'Reiseverlauf', days));
  } else {
    const maxSlot = 2 * windows.length;
    for (let s = 0; s <= maxSlot; s++) {
      const entries = slots.get(s) ?? [];
      if (s % 2 === 1) {
        const w = windows[(s - 1) / 2]!;
        // Every cruise day is shown, even sea days without entries.
        const days: TimelineDay[] = w.cruise.days.map((d) => ({ date: d.date, cruiseDay: d, entries: [] }));
        const extra: PlacedEntry[] = [];
        for (const p of [...entries].sort(byInstant)) {
          const target =
            (p.cruiseDay && days.find((d) => d.cruiseDay?.id === p.cruiseDay!.id)) ||
            days.find((d) => d.date === p.date);
          if (target) target.entries.push(p.entry);
          else extra.push(p);
        }
        const merged = [...days, ...groupByDate(extra)].sort((a, b) => a.date.localeCompare(b.date));
        phases.push(phaseFromDays('cruise', `Kreuzfahrt · ${w.cruise.shipName}`, merged, w.cruise.id));
      } else if (entries.length) {
        const kind: PhaseKind = s === 0 ? 'pre' : s === maxSlot ? 'post' : 'between';
        const title = kind === 'pre' ? 'Vorprogramm' : kind === 'post' ? 'Nachprogramm' : 'Zwischenprogramm';
        phases.push(phaseFromDays(kind, title, groupByDate(entries)));
      }
    }
  }

  return { phases, warnings: computeWarnings(windows, items, dayById, itemTz, dayTz) };
}

// ---------------------------------------------------------------------------
// Buffer checks
// ---------------------------------------------------------------------------
function computeWarnings(
  windows: CruiseWindow[],
  items: Item[],
  dayById: Map<string, CruiseDay>,
  itemTz: (item: Item, which: 'start' | 'end') => string,
  dayTz: (d: CruiseDay) => string,
): TimelineWarning[] {
  const warnings: TimelineWarning[] = [];
  const transports = items.filter((i) => TRANSPORT_TYPES.includes(i.type) && !i.cruiseDayId);

  windows.forEach((w, idx) => {
    const prev = windows[idx - 1];
    const next = windows[idx + 1];
    const ship = w.cruise.shipName;

    // --- Anreise → Einschiffung ---
    const embark = w.embark;
    const boardTime = embark.allAboard ?? (embark.departure ? addMinutes(embark.departure, -30) : null);
    if (boardTime) {
      const boardBy = toInstant(`${embark.date}T${boardTime}`, dayTz(embark));
      const arrivals = transports
        .filter((t) => hasTime(t.endLocal ?? t.startLocal))
        .map((t) => ({ t, at: toInstant(t.endLocal ?? t.startLocal, itemTz(t, t.endLocal ? 'end' : 'start')) }))
        .filter(
          ({ t, at }) =>
            toInstant(t.startLocal, itemTz(t, 'start')) < boardBy &&
            at > boardBy - 4 * 24 * HOUR &&
            (!prev || at > prev.end),
        )
        .sort((a, b) => b.at - a.at);
      const last = arrivals[0];
      if (last) {
        const { t, at } = last;
        if (at > boardBy) {
          warnings.push({
            level: 'error',
            code: 'embark_missed',
            message: `„${t.title}“ kommt erst nach „Alle an Bord“ (${boardTime}) in ${embark.portName ?? 'den Abfahrtshafen'} an – das Schiff ${ship} wäre weg.`,
            itemId: t.id,
            cruiseId: w.cruise.id,
            cruiseDayId: embark.id,
          });
        } else {
          const gap = boardBy - at;
          const min = t.type === 'flight' ? 4 * HOUR : 2 * HOUR;
          if (gap < min) {
            warnings.push({
              level: 'warning',
              code: 'embark_tight',
              message: `Nur ${formatDuration(gap)} zwischen Ankunft von „${t.title}“ und „Alle an Bord“ (${boardTime}). Empfohlen sind mindestens ${formatDuration(min)}.`,
              itemId: t.id,
              cruiseId: w.cruise.id,
              cruiseDayId: embark.id,
            });
          }
        }
        const arrivalDate = (t.endLocal ?? t.startLocal).slice(0, 10);
        if (t.type === 'flight' && arrivalDate === embark.date && at <= boardBy) {
          warnings.push({
            level: 'info',
            code: 'embark_same_day',
            message: `Anreise per Flug am Einschiffungstag. Bei Verspätung oder Annullierung gibt es keinen Puffer – eine Anreise am Vortag mit Hotel ist sicherer.`,
            itemId: t.id,
            cruiseId: w.cruise.id,
          });
        }
      }
    }

    // --- Ausschiffung → Abreise ---
    const dis = w.disembark;
    const shipArrives = dis.arrival ? toInstant(`${dis.date}T${dis.arrival}`, dayTz(dis)) : null;
    const offShip = dis.departure
      ? toInstant(`${dis.date}T${dis.departure}`, dayTz(dis))
      : shipArrives !== null
        ? shipArrives + HOUR
        : null;
    if (shipArrives !== null && offShip !== null) {
      const departures = transports
        .filter((t) => hasTime(t.startLocal))
        .map((t) => ({ t, at: toInstant(t.startLocal, itemTz(t, 'start')) }))
        .filter(({ at }) => at >= shipArrives - 6 * HOUR && at <= shipArrives + 3 * 24 * HOUR && (!next || at < next.start))
        .sort((a, b) => a.at - b.at);
      const first = departures[0];
      if (first) {
        const { t, at } = first;
        if (at < shipArrives) {
          warnings.push({
            level: 'error',
            code: 'disembark_conflict',
            message: `„${t.title}“ startet, bevor die ${ship} in ${dis.portName ?? 'den Zielhafen'} ankommt (${dis.arrival}).`,
            itemId: t.id,
            cruiseId: w.cruise.id,
            cruiseDayId: dis.id,
          });
        } else {
          const gap = at - offShip;
          const min = t.type === 'flight' ? 3 * HOUR : 1 * HOUR;
          if (gap < min) {
            warnings.push({
              level: 'warning',
              code: 'disembark_tight',
              message: `${gap < 0 ? 'Kein' : `Nur ${formatDuration(gap)}`} Puffer zwischen Ausschiffung (ca. ${dis.departure ?? addMinutes(dis.arrival!, 60)}) und „${t.title}“. Empfohlen sind mindestens ${formatDuration(min)}.`,
              itemId: t.id,
              cruiseId: w.cruise.id,
              cruiseDayId: dis.id,
            });
          }
        }
      }
    }
  });

  // --- Landausflüge & Aktivitäten an Hafentagen ---
  for (const item of items) {
    if (item.type === 'note') continue;
    const day = item.cruiseDayId ? dayById.get(item.cruiseDayId) : undefined;

    if (!day) {
      if (item.type === 'excursion') {
        const w = windows.find((win) => {
          const at = toInstant(item.startLocal, itemTz(item, 'start'));
          return at >= win.start && at <= win.end;
        });
        if (w) {
          warnings.push({
            level: 'info',
            code: 'excursion_unlinked',
            message: `Ausflug „${item.title}“ ist keinem Hafentag zugeordnet – dann kann die „Alle an Bord“-Zeit nicht geprüft werden.`,
            itemId: item.id,
            cruiseId: w.cruise.id,
          });
        }
      }
      continue;
    }

    const tz = dayTz(day);
    if (day.kind === 'sea' && item.type === 'excursion') {
      warnings.push({
        level: 'warning',
        code: 'excursion_sea_day',
        message: `Ausflug „${item.title}“ ist einem Seetag zugeordnet.`,
        itemId: item.id,
        cruiseDayId: day.id,
      });
      continue;
    }

    if (day.arrival && hasTime(item.startLocal) && item.startLocal.slice(0, 10) === day.date) {
      const start = toInstant(item.startLocal, itemTz(item, 'start'));
      if (start < toInstant(`${day.date}T${day.arrival}`, tz)) {
        warnings.push({
          level: 'warning',
          code: 'excursion_before_arrival',
          message: `„${item.title}“ beginnt vor der Ankunft des Schiffs in ${day.portName ?? 'diesem Hafen'} (${day.arrival}).`,
          itemId: item.id,
          cruiseDayId: day.id,
        });
      }
    }

    const boardTime = day.allAboard ?? (day.departure ? addMinutes(day.departure, -30) : null);
    if (!boardTime || day.kind === 'disembarkation') continue;
    const boardBy = toInstant(`${day.date}T${boardTime}`, tz);

    if (!hasTime(item.endLocal)) {
      if (item.type === 'excursion' || item.type === 'activity') {
        warnings.push({
          level: 'info',
          code: 'excursion_no_end',
          message: `„${item.title}“ hat keine Endzeit. Rückkehr spätestens um ${boardTime} (Alle an Bord) einplanen.`,
          itemId: item.id,
          cruiseDayId: day.id,
        });
      }
      continue;
    }

    const end = toInstant(item.endLocal, itemTz(item, 'end'));
    const privateTour = item.details?.bookedVia === 'private';
    const needed = ((privateTour ? 60 : 30) + (day.tender ? 30 : 0)) * MIN;
    if (end > boardBy) {
      warnings.push({
        level: 'error',
        code: 'excursion_late',
        message: `„${item.title}“ endet nach „Alle an Bord“ (${boardTime}) in ${day.portName ?? 'diesem Hafen'}.${privateTour ? ' Bei privaten Ausflügen wartet das Schiff nicht!' : ''}`,
        itemId: item.id,
        cruiseDayId: day.id,
      });
    } else if (boardBy - end < needed) {
      const reasons = [privateTour ? 'privat gebucht' : null, day.tender ? 'Tenderhafen' : null].filter(Boolean);
      warnings.push({
        level: 'warning',
        code: 'excursion_tight',
        message: `Nur ${formatDuration(boardBy - end)} zwischen Ende von „${item.title}“ und „Alle an Bord“ (${boardTime}). Empfohlen: ${formatDuration(needed)}${reasons.length ? ` (${reasons.join(', ')})` : ''}.`,
        itemId: item.id,
        cruiseDayId: day.id,
      });
    }
  }

  const rank = { error: 0, warning: 1, info: 2 } as const;
  return warnings.sort((a, b) => rank[a.level] - rank[b.level]);
}
