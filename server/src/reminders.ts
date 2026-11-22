/**
 * Turns a trip into reminders: "Alle an Bord", start of an excursion, departure of a flight or transfer.
 * Lead times come from the user's settings and are extended by the personal time need (pace), so the
 * notification arrives early enough. Pure functions; sending is done by the runner.
 */
import type { Cruise, Item } from './model.ts';
import type { UserSettings } from './schemas.ts';
import { placeInfo } from './place.ts';
import { formatDuration, needOf, toInstant, type Need, type Pace } from './timeline.ts';

export interface Reminder {
  /** Identifies this reminder for this event time, so it is sent once. */
  key: string;
  fireAt: number;
  eventAt: number;
  title: string;
  body: string;
  tripId: string;
  url: string;
}

const MIN = 60_000;
const TRANSPORT = ['flight', 'train', 'bus', 'ferry', 'transfer'] as const;
const hasTime = (l: string | null | undefined): l is string => !!l && /T\d{2}:\d{2}/.test(l);

function minusMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const total = (((h * 60 + m - minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const note = (n: Need): string => (n.personal !== n.normal ? ` Vorlauf ${formatDuration(n.personal)} (normal ${formatDuration(n.normal)}).` : '');

export function buildReminders(input: {
  tripId: string;
  cruises: Cruise[];
  items: Item[];
  defaultTz: string;
  settings: UserSettings;
}): Reminder[] {
  const { tripId, cruises, items, defaultTz, settings } = input;
  const prefs = settings.notifications;
  const pace: Pace = settings.pace;
  const url = `/trips/${tripId}`;
  const out: Reminder[] = [];
  const dayTz = new Map<string, string>();

  if (prefs.boarding) {
    for (const c of cruises) {
      for (const d of c.days) {
        dayTz.set(d.id, d.timezone ?? defaultTz);
        if (d.kind !== 'port' && d.kind !== 'embarkation') continue;
        const time = d.allAboard ?? (d.departure ? minusMinutes(d.departure, 30) : null);
        if (!time) continue;
        const eventAt = toInstant(`${d.date}T${time}`, d.timezone ?? defaultTz);
        const need = needOf(prefs.boardingLead * MIN, pace);
        out.push({
          key: `board:${d.id}:${eventAt}`,
          fireAt: eventAt - need.used,
          eventAt,
          title: `⚓ Alle an Bord in ${formatDuration(need.used)}`,
          body: `${d.portName ?? 'Hafen'}: Alle an Bord um ${time} (Ortszeit).${note(need)}`,
          tripId,
          url,
        });
      }
    }
  }

  for (const item of items) {
    if (!hasTime(item.startLocal)) continue;
    const tz = item.startTz ?? (item.cruiseDayId ? dayTz.get(item.cruiseDayId) : undefined) ?? defaultTz;
    const eventAt = toInstant(item.startLocal, tz);
    const time = item.startLocal.slice(11, 16);

    if (prefs.excursion && (item.type === 'excursion' || item.type === 'activity')) {
      const need = needOf(prefs.excursionLead * MIN, pace);
      const meeting = typeof item.details.meetingPoint === 'string' && item.details.meetingPoint ? ` Treffpunkt: ${item.details.meetingPoint}.` : '';
      out.push({
        key: `exc:${item.id}:${eventAt}`,
        fireAt: eventAt - need.used,
        eventAt,
        title: `🧭 ${item.title} in ${formatDuration(need.used)}`,
        body: `Beginn um ${time}.${meeting}${note(need)}`,
        tripId,
        url,
      });
    } else if (prefs.transport && (TRANSPORT as readonly string[]).includes(item.type)) {
      const isFlight = item.type === 'flight';
      const need = needOf((isFlight ? prefs.flightLead : prefs.transportLead) * MIN, pace);
      out.push({
        key: `tr:${item.id}:${eventAt}`,
        fireAt: eventAt - need.used,
        eventAt,
        title: `${isFlight ? '✈️' : '🚌'} ${item.title} in ${formatDuration(need.used)}`,
        body: `${isFlight ? 'Abflug' : 'Abfahrt'} um ${time} (Ortszeit).${placeInfo(item, 'departure').length ? ` ${placeInfo(item, 'departure').join(', ')}.` : ''}${note(need)}`,
        tripId,
        url,
      });
    }
  }
  return out;
}

/** Reminders that should go out now: their time has come (at most 5 minutes ago) and the event is still ahead. */
export function dueReminders(reminders: Reminder[], now: number): Reminder[] {
  return reminders.filter((r) => r.fireAt <= now && r.fireAt > now - 5 * MIN && r.eventAt > now);
}
