/**
 * Builds the phase-structured timeline of a trip (Anreise → Kreuzfahrt → Abreise)
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
  /** True when the situation is fine with the normal time and only too tight with the user's personal time need. */
  personal?: boolean;
  /** Which appearance of a multi-day item the warning belongs to (default 'start'). */
  role?: 'start' | 'end';
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

export function formatDuration(ms: number): string {
  const totalMin = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const HOUR = 3_600_000;
const MIN = 60_000;

/** The user's personal time need (see paceInput). */
export interface Pace {
  enabled: boolean;
  factor: number;
  extraMinutes: number;
}

export interface Need {
  normal: number;
  personal: number;
  /** What the checks compare against: the personal time when the pace is enabled, else the normal time. */
  used: number;
}

/** Recommended time without and with the personal pace (rounded up to 5 minutes). */
export function needOf(normal: number, pace?: Pace): Need {
  if (!pace?.enabled) return { normal, personal: normal, used: normal };
  const step = 5 * MIN;
  const personal = Math.max(normal, Math.ceil((normal * pace.factor + pace.extraMinutes * MIN) / step) * step);
  return { normal, personal, used: personal };
}

const needText = (n: Need): string =>
  n.personal === n.normal ? formatDuration(n.normal) : `${formatDuration(n.normal)} normal, ${formatDuration(n.personal)} persönlich`;
const personalOnly = (gap: number, n: Need): boolean => n.personal !== n.normal && gap >= n.normal;
const personalNote = (gap: number, n: Need): string => (personalOnly(gap, n) ? ' Normal reicht das, mit deinem persönlichen Zeitbedarf nicht.' : '');

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

export function buildTimeline(cruises: Cruise[], items: Item[], defaultTz: string, pace?: Pace): Timeline {
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
      } else if (entries.length || s === 0 || s === maxSlot) {
        // Anreise and Abreise are always shown, so they can be planned from an empty state.
        const kind: PhaseKind = s === 0 ? 'pre' : s === maxSlot ? 'post' : 'between';
        const title = kind === 'pre' ? 'Anreise' : kind === 'post' ? 'Abreise' : 'Zwischenprogramm';
        phases.push(phaseFromDays(kind, title, groupByDate(entries)));
      }
    }
  }

  return { phases, warnings: computeWarnings(windows, items, dayById, itemTz, dayTz, pace) };
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
  pace?: Pace,
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
          const need = needOf(t.type === 'flight' ? 4 * HOUR : 2 * HOUR, pace);
          if (gap < need.used) {
            warnings.push({
              level: 'warning',
              code: 'embark_tight',
              personal: personalOnly(gap, need),
              message: `Nur ${formatDuration(gap)} zwischen Ankunft von „${t.title}“ und „Alle an Bord“ (${boardTime}). Empfohlen sind mindestens ${needText(need)}.${personalNote(gap, need)}`,
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
          const need = needOf(t.type === 'flight' ? 3 * HOUR : 1 * HOUR, pace);
          if (gap < need.used) {
            warnings.push({
              level: 'warning',
              code: 'disembark_tight',
              personal: personalOnly(gap, need),
              message: `${gap < 0 ? 'Kein' : `Nur ${formatDuration(gap)}`} Puffer zwischen Ausschiffung (ca. ${dis.departure ?? addMinutes(dis.arrival!, 60)}) und „${t.title}“. Empfohlen sind mindestens ${needText(need)}.${personalNote(gap, need)}`,
              itemId: t.id,
              cruiseId: w.cruise.id,
              cruiseDayId: dis.id,
            });
          }
        }
      }
    }

    // --- Hotel vor der Einschiffung: Check-out gegenüber „Alle an Bord“ ---
    const preHotel = items
      .filter((i) => i.type === 'hotel' && hasTime(i.endLocal) && i.endLocal.slice(0, 10) === embark.date)
      .sort((a, b) => b.endLocal!.localeCompare(a.endLocal!))[0];
    if (preHotel && boardTime) {
      const checkout = toInstant(preHotel.endLocal!, itemTz(preHotel, 'end'));
      const boardBy = toInstant(`${embark.date}T${boardTime}`, dayTz(embark));
      const gap = boardBy - checkout;
      const outTime = preHotel.endLocal!.slice(11, 16);
      const base = { itemId: preHotel.id, role: 'end' as const, cruiseId: w.cruise.id, cruiseDayId: embark.id };
      if (gap < 0) {
        warnings.push({
          ...base,
          level: 'error',
          code: 'hotel_checkout_late',
          message: `Check-out im „${preHotel.title}“ (${outTime}) liegt nach „Alle an Bord“ (${boardTime}). Der Check-out-Zeitpunkt passt nicht zur Einschiffung.`,
        });
      } else if (gap < needOf(2 * HOUR, pace).used) {
        const need = needOf(2 * HOUR, pace);
        warnings.push({
          ...base,
          level: 'warning',
          code: 'hotel_embark_tight',
          personal: personalOnly(gap, need),
          message: `Nur ${formatDuration(gap)} zwischen Check-out (${outTime}) und „Alle an Bord“ (${boardTime}). Mit Transfer zum Hafen und Check-in am Terminal wird das knapp; besser sind mindestens ${needText(need)}.${personalNote(gap, need)}`,
        });
      } else if (embark.arrival) {
        const opens = toInstant(`${embark.date}T${embark.arrival}`, dayTz(embark));
        if (opens - checkout > 3 * HOUR) {
          warnings.push({
            ...base,
            level: 'info',
            code: 'hotel_wait_boarding',
            message: `Check-out um ${outTime}, aber der Check-in am Schiff öffnet erst um ${embark.arrival} (ca. ${formatDuration(opens - checkout)} Wartezeit). Gepäck im Hotel lassen oder den Transfer später legen.`,
          });
        }
      }
    }

    // --- Hotel nach der Ausschiffung: Check-in gegenüber Ankunft an Land ---
    const postHotel = items
      .filter((i) => i.type === 'hotel' && hasTime(i.startLocal) && i.startLocal.slice(0, 10) === dis.date)
      .sort((a, b) => a.startLocal.localeCompare(b.startLocal))[0];
    if (postHotel && offShip !== null) {
      const checkin = toInstant(postHotel.startLocal, itemTz(postHotel, 'start'));
      const gap = checkin - offShip;
      if (gap > 3 * HOUR) {
        warnings.push({
          level: 'info',
          code: 'hotel_checkin_wait',
          message: `Von Bord ca. ${dis.departure ?? addMinutes(dis.arrival ?? '09:00', 60)}, Check-in im „${postHotel.title}“ aber erst ab ${postHotel.startLocal.slice(11, 16)} (ca. ${formatDuration(gap)} Wartezeit). Früheren Check-in oder Gepäckaufbewahrung anfragen.`,
          itemId: postHotel.id,
          cruiseId: w.cruise.id,
          cruiseDayId: dis.id,
        });
      }
    }
  });

  // --- Hotel: doppelt bezahlte Nächte, späte und frühe Ankunft ---
  for (const h of items.filter((i) => i.type === 'hotel')) {
    const hStart = toInstant(h.startLocal, itemTz(h, 'start'));
    const hEnd = h.endLocal ? toInstant(h.endLocal, itemTz(h, 'end')) : null;

    if (hEnd !== null) {
      for (const w of windows) {
        const overlap = Math.min(hEnd, w.end) - Math.max(hStart, w.start);
        if (overlap > 12 * HOUR) {
          warnings.push({
            level: 'warning',
            code: 'hotel_overlaps_cruise',
            message: `„${h.title}“ überschneidet sich mit der Kreuzfahrt auf der ${w.cruise.shipName} um ${formatDuration(overlap)}, du bezahlst also mindestens eine Nacht, die du auf dem Schiff verbringst.`,
            itemId: h.id,
            cruiseId: w.cruise.id,
          });
        }
      }
    }

    if (!hasTime(h.startLocal)) continue;
    const hDate = h.startLocal.slice(0, 10);
    const arrival = transports
      .filter((t) => (t.endLocal ?? t.startLocal).slice(0, 10) === hDate && hasTime(t.endLocal ?? t.startLocal))
      .map((t) => ({ t, at: toInstant(t.endLocal ?? t.startLocal, itemTz(t, t.endLocal ? 'end' : 'start')) }))
      .filter(({ t, at }) => toInstant(t.startLocal, itemTz(t, 'start')) >= hStart - 24 * HOUR && (hEnd === null || at <= hEnd))
      .sort((a, b) => b.at - a.at)[0];
    if (!arrival) continue;
    const hhmm = (arrival.t.endLocal ?? arrival.t.startLocal).slice(11, 16);
    if (hhmm >= '22:00') {
      warnings.push({
        level: 'info',
        code: 'hotel_late_arrival',
        message: `Ankunft („${arrival.t.title}“) erst um ${hhmm}. Späte Anreise dem „${h.title}“ vorab melden, damit die Rezeption besetzt ist.`,
        itemId: h.id,
      });
    } else if (arrival.at < hStart && hStart - arrival.at > 4 * HOUR) {
      warnings.push({
        level: 'info',
        code: 'hotel_early_arrival',
        message: `Ankunft um ${hhmm}, Check-in im „${h.title}“ aber erst ab ${h.startLocal.slice(11, 16)} (ca. ${formatDuration(hStart - arrival.at)} Wartezeit). Gepäck deponieren oder früheren Check-in anfragen.`,
        itemId: h.id,
      });
    }
  }

  // --- Parkplatz: reicht die Buchung bis zur Rückkehr? ---
  for (const p of items.filter((i) => i.type === 'parking' && i.endLocal)) {
    const pStart = toInstant(p.startLocal, itemTz(p, 'start'));
    const rawEnd = toInstant(p.endLocal!, itemTz(p, 'end'));
    const pEnd = hasTime(p.endLocal) ? rawEnd : rawEnd + 24 * HOUR - MIN;
    const returns = transports
      .map((t) => ({ t, at: toInstant(t.endLocal ?? t.startLocal, itemTz(t, t.endLocal ? 'end' : 'start')) }))
      .filter(({ t }) => toInstant(t.startLocal, itemTz(t, 'start')) > pStart)
      .sort((a, b) => b.at - a.at);
    const last = returns[0];
    if (last && pEnd < last.at) {
      warnings.push({
        level: 'warning',
        code: 'parking_short',
        message: `Parkplatz „${p.title}“ ist nur bis ${p.endLocal!.replace('T', ' ')} gebucht, die Rückreise („${last.t.title}“) endet aber erst ${(last.t.endLocal ?? last.t.startLocal).replace('T', ' ')}.`,
        itemId: p.id,
      });
    }
  }

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
    const need = needOf(((privateTour ? 60 : 30) + (day.tender ? 30 : 0)) * MIN, pace);
    if (end > boardBy) {
      warnings.push({
        level: 'error',
        code: 'excursion_late',
        message: `„${item.title}“ endet nach „Alle an Bord“ (${boardTime}) in ${day.portName ?? 'diesem Hafen'}.${privateTour ? ' Bei privaten Ausflügen wartet das Schiff nicht!' : ''}`,
        itemId: item.id,
        cruiseDayId: day.id,
      });
    } else if (boardBy - end < need.used) {
      const reasons = [privateTour ? 'privat gebucht' : null, day.tender ? 'Tenderhafen' : null].filter(Boolean);
      warnings.push({
        level: 'warning',
        code: 'excursion_tight',
        personal: personalOnly(boardBy - end, need),
        message: `Nur ${formatDuration(boardBy - end)} zwischen Ende von „${item.title}“ und „Alle an Bord“ (${boardTime}). Empfohlen: ${needText(need)}${reasons.length ? ` (${reasons.join(', ')})` : ''}.${personalNote(boardBy - end, need)}`,
        itemId: item.id,
        cruiseDayId: day.id,
      });
    }
  }

  // --- Stationen (Städtetrip / Rundreise): Überschneidung, Verbindung, Unterkunft ---
  warnings.push(...stopWarnings(items, windows, itemTz));

  const rank = { error: 0, warning: 1, info: 2 } as const;
  return warnings.sort((a, b) => rank[a.level] - rank[b.level]);
}

const dayAfter = (date: string, n: number): string => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n)).toISOString().slice(0, 10);
const shortDate = (d: string): string => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

/**
 * Checks for stations (item type "stop": a place with arrival and departure): do they overlap, is there a way
 * from one to the next, is every night in between covered by an accommodation (a cruise counts as one).
 */
function stopWarnings(
  items: Item[],
  windows: CruiseWindow[],
  itemTz: (item: Item, which: 'start' | 'end') => string,
): TimelineWarning[] {
  const warnings: TimelineWarning[] = [];
  const stops = items
    .filter((i) => i.type === 'stop' && /^\d{4}-\d{2}-\d{2}/.test(i.startLocal))
    .sort((a, b) => toInstant(a.startLocal, itemTz(a, 'start')) - toInstant(b.startLocal, itemTz(b, 'start')));
  if (stops.length === 0) return warnings;
  const endOf = (s: Item) => s.endLocal ?? s.startLocal;

  // Two stations at the same time
  for (let n = 1; n < stops.length; n++) {
    const a = stops[n - 1]!;
    const b = stops[n]!;
    if (!a.endLocal) continue;
    const aEnd = toInstant(a.endLocal, itemTz(a, 'end'));
    const bStart = toInstant(b.startLocal, itemTz(b, 'start'));
    if (bStart < aEnd - 12 * HOUR) {
      warnings.push({
        level: 'warning',
        code: 'stop_overlap',
        message: `„${a.title}“ (bis ${a.endLocal.replace('T', ' ')}) und „${b.title}“ (ab ${b.startLocal.replace('T', ' ')}) überschneiden sich.`,
        itemId: b.id,
      });
    }
  }

  // A way from one station to the next
  const movers = items.filter((i) => TRANSPORT_TYPES.includes(i.type) || i.type === 'car_rental');
  for (let n = 1; n < stops.length; n++) {
    const a = stops[n - 1]!;
    const b = stops[n]!;
    const from = endOf(a).slice(0, 10);
    const to = b.startLocal.slice(0, 10);
    if (to < from) continue;
    const connected = movers.some((m) => {
      const ms = m.startLocal.slice(0, 10);
      const me = (m.endLocal ?? m.startLocal).slice(0, 10);
      return m.type === 'car_rental' ? ms <= from && me >= to : ms >= from && ms <= to;
    });
    if (!connected) {
      warnings.push({
        level: 'info',
        code: 'stop_no_transport',
        message: `Zwischen „${a.title}“ und „${b.title}“ ist keine Verbindung eingetragen (Flug, Zug, Bus, Fähre, Transfer oder Mietwagen).`,
        itemId: b.id,
      });
    }
  }

  // Every night of a stay needs somewhere to sleep
  const hotels = items.filter((i) => i.type === 'hotel');
  const covered = (night: string): boolean =>
    hotels.some((h) => {
      const hs = h.startLocal.slice(0, 10);
      const he = h.endLocal?.slice(0, 10) ?? dayAfter(hs, 1);
      return hs <= night && night < he;
    }) ||
    windows.some((w) => w.embark.date <= night && night < w.disembark.date);
  for (const s of stops) {
    if (!s.endLocal) continue;
    const start = s.startLocal.slice(0, 10);
    const end = s.endLocal.slice(0, 10);
    if (end <= start) continue;
    const missing: string[] = [];
    for (let d = start; d < end && missing.length < 60; d = dayAfter(d, 1)) if (!covered(d)) missing.push(d);
    if (missing.length === 0) continue;
    // Runs of consecutive nights as "12.–14."
    const runs: string[] = [];
    for (let i = 0; i < missing.length; ) {
      let j = i;
      while (j + 1 < missing.length && dayAfter(missing[j]!, 1) === missing[j + 1]) j++;
      runs.push(i === j ? shortDate(missing[i]!) : `${shortDate(missing[i]!)}–${shortDate(missing[j]!)}`);
      i = j + 1;
    }
    warnings.push({
      level: 'warning',
      code: 'stop_no_lodging',
      message: `Für „${s.title}“ ist ${missing.length === 1 ? 'für eine Nacht' : `für ${missing.length} Nächte`} keine Unterkunft eingetragen (${runs.join(', ')}).`,
      itemId: s.id,
    });
  }
  return warnings;
}
