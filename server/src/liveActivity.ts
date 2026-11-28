/**
 * Live Activity on the iPhone lock screen and in the Dynamic Island: on a travel day the current or next step with a
 * countdown, the place (terminal, gate, platform), the live flight status and what comes after. The server computes
 * the content (the same for every member), starts the activity a few hours before the first step via push-to-start,
 * updates it when something changes (next step, new gate, delay) and ends it when the day is over.
 *
 * Contract with the app (docs/API.md "Sperrbildschirm"): attributes {tripId, tripTitle}, content-state LockState.
 */
import type { DB } from './db.ts';
import { readStatus } from './flightStatus.ts';
import { loadCruises, loadItems, loadTrip, type Cruise, type Item } from './model.ts';
import { placeInfo } from './place.ts';
import type { ApnsSender } from './apns.ts';
import { readSettings } from './settings.ts';
import { toInstant } from './timeline.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** The activity shows steps that start within this time (or are under way). */
export const HORIZON = 12 * HOUR;
/** The server starts the activity this long before the first step. */
export const START_BEFORE = 3 * HOUR;

/** Content of the activity. Every key is always present (null when unknown), so the app can decode it strictly. */
export interface LockState {
  icon: string;
  title: string;
  /** Planned local time "HH:MM" of the step */
  time: string;
  /** What the countdown counts to: "Abflug", "Ankunft", "Beginn", "Alle an Bord" … */
  targetLabel: string;
  /** Countdown target, Unix seconds (revised departure if the flight is late) */
  target: number;
  /** "Terminal 2 · Gate B12" or null */
  place: string | null;
  /** "+45 min, neu 10:25", "annulliert" or null */
  live: string | null;
  /** true when the step needs attention (delay of 15 min or more, cancellation) */
  alert: boolean;
  /** "🏨 Hotel Artemide · 14:00" or null */
  next: string | null;
}

interface Step {
  itemId: string | null;
  icon: string;
  title: string;
  time: string;
  at: number;
  /** End of the step if it has one that matters (flight: arrival); the countdown then runs to it while under way. */
  end: number | null;
  startLabel: string;
  endLabel: string;
  place: string | null;
  live: string | null;
  alert: boolean;
}

const ICON: Record<string, string> = {
  flight: '✈️', train: '🚆', bus: '🚌', ferry: '⛴️', transfer: '🚕', car_rental: '🚗', parking: '🅿️', hotel: '🏨',
  excursion: '🧭', activity: '🎟️', restaurant: '🍽️',
};
const START_LABEL: Record<string, string> = { flight: 'Abflug', train: 'Abfahrt', bus: 'Abfahrt', ferry: 'Abfahrt', transfer: 'Abholung', car_rental: 'Abholung', parking: 'Einfahrt', hotel: 'Check-in' };
const hasTime = (l: string | null | undefined): l is string => !!l && /T\d{2}:\d{2}/.test(l);
const hhmm = (local: string) => local.slice(11, 16);

/** All steps of a trip with a time, in order. Hotels count with check-in and check-out. */
export function tripSteps(db: DB, tripId: string, defaultTz: string): Step[] {
  const cruises: Cruise[] = loadCruises(db, tripId);
  const items: Item[] = loadItems(db, tripId);
  const dayTz = new Map<string, string>();
  const steps: Step[] = [];
  for (const c of cruises) {
    for (const d of c.days) {
      const tz = d.timezone ?? defaultTz;
      dayTz.set(d.id, tz);
      const base = { itemId: null, place: null, live: null, alert: false, end: null };
      if (d.kind === 'embarkation' && (d.arrival || d.allAboard)) {
        const t = d.arrival ?? d.allAboard!;
        steps.push({ ...base, icon: '🚢', title: `Einschiffung ${c.shipName}`, time: t, at: toInstant(`${d.date}T${t}`, tz), startLabel: d.arrival ? 'Check-in' : 'Alle an Bord', endLabel: '', place: [d.portName, c.cabin ? `Kabine ${c.cabin}` : null].filter(Boolean).join(' · ') || null });
      }
      if (d.kind === 'port' && d.allAboard) {
        steps.push({ ...base, icon: '⚓', title: d.portName ?? 'Hafen', time: d.allAboard, at: toInstant(`${d.date}T${d.allAboard}`, tz), startLabel: 'Alle an Bord', endLabel: '' });
      }
      if (d.kind === 'disembarkation' && d.departure) {
        steps.push({ ...base, icon: '🧳', title: `Ausschiffung ${c.shipName}`, time: d.departure, at: toInstant(`${d.date}T${d.departure}`, tz), startLabel: 'Von Bord bis', endLabel: '' });
      }
    }
  }
  for (const item of items) {
    if (!hasTime(item.startLocal) || !ICON[item.type]) continue;
    const tz = item.startTz ?? (item.cruiseDayId ? dayTz.get(item.cruiseDayId) : undefined) ?? defaultTz;
    let at = toInstant(item.startLocal, tz);
    const isFlight = item.type === 'flight';
    let live: string | null = null;
    let alert = false;
    let end = isFlight && hasTime(item.endLocal) ? toInstant(item.endLocal, item.endTz ?? tz) : null;
    if (isFlight) {
      const s = readStatus(db, item.id);
      if (s?.checkedAt) {
        if (s.cancelled) {
          live = 'annulliert';
          alert = true;
        } else if (s.depRevised && s.delayMinutes !== null && s.delayMinutes >= 5) {
          at = toInstant(s.depRevised, tz);
          live = `+${s.delayMinutes} min, neu ${hhmm(s.depRevised)}`;
          alert = s.delayMinutes >= 15;
        }
        if (s.arrRevised && end !== null) end = toInstant(s.arrRevised, item.endTz ?? tz);
      }
    }
    const placeLine = placeInfo(item, 'departure').join(' · ') || null;
    steps.push({ itemId: item.id, icon: ICON[item.type]!, title: item.title, time: hhmm(item.startLocal), at, end, startLabel: START_LABEL[item.type] ?? 'Beginn', endLabel: 'Ankunft', place: placeLine, live, alert });
    if (item.type === 'hotel' && hasTime(item.endLocal)) {
      steps.push({ itemId: item.id, icon: '🏨', title: item.title, time: hhmm(item.endLocal), at: toInstant(item.endLocal, item.endTz ?? tz), end: null, startLabel: 'Check-out', endLabel: '', place: null, live: null, alert: false });
    }
  }
  return steps.sort((a, b) => a.at - b.at);
}

/** What the lock screen shows now: a step under way (flight in the air) or the next one within the horizon; null = nothing today. */
export function lockState(steps: Step[], now: number): LockState | null {
  const current = steps.find((s) => s.end !== null && s.at <= now && now < s.end) ?? steps.find((s) => s.at > now && s.at - now <= HORIZON);
  if (!current) return null;
  const underway = current.at <= now;
  const after = steps.find((s) => s !== current && s.at > Math.max(now, current.at));
  return {
    icon: current.icon,
    title: current.title,
    time: current.time,
    targetLabel: underway ? current.endLabel : current.startLabel,
    target: Math.floor((underway ? current.end! : current.at) / 1000),
    place: underway ? null : current.place,
    live: current.live,
    alert: current.alert,
    next: after && after.at - now <= HORIZON ? `${after.icon} ${after.title} · ${after.time}` : null,
  };
}

export function lockStateForTrip(db: DB, tripId: string, defaultTz: string, now = Date.now()): LockState | null {
  return lockState(tripSteps(db, tripId, defaultTz), now);
}

/** The first step of the coming travel period, to know when to start the activity. */
export function firstUpcoming(steps: Step[], now: number): Step | undefined {
  return steps.find((s) => s.at > now);
}

type Row = Record<string, any>;

/**
 * One pass: update running activities whose content changed, end those with nothing left, and start one (push-to-start)
 * for users whose next travel day begins within 3 hours. Returns how many pushes were sent.
 */
export async function runLiveActivityTick({ db, apns, defaultTz }: { db: DB; apns: ApnsSender | null; defaultTz: string }, now = Date.now()): Promise<number> {
  if (!apns?.sendLiveActivity) return 0;
  const send = apns.sendLiveActivity.bind(apns);
  let sent = 0;
  const ts = Math.floor(now / 1000);

  for (const row of db.prepare("SELECT * FROM live_activities WHERE kind = 'update'").all() as Row[]) {
    const state = row.trip_id ? lockStateForTrip(db, row.trip_id, defaultTz, now) : null;
    if (!state) {
      await send(row.token, { aps: { timestamp: ts, event: 'end', 'dismissal-date': ts + 15 * 60 } }, 5);
      db.prepare('DELETE FROM live_activities WHERE token = ?').run(row.token);
      sent++;
      continue;
    }
    const json = JSON.stringify(state);
    if (json === row.last_state) continue;
    const prev = row.last_state ? (JSON.parse(row.last_state) as LockState) : null;
    // Priority 10 (budgeted by Apple) only for what matters at once: other step, new place, delay/cancellation.
    const important = !prev || prev.title !== state.title || prev.place !== state.place || prev.alert !== state.alert || Math.abs(prev.target - state.target) > 300;
    const res = await send(row.token, { aps: { timestamp: ts, event: 'update', 'content-state': state, 'stale-date': state.target + 2 * 3600 } }, important ? 10 : 5);
    if (res.gone) db.prepare('DELETE FROM live_activities WHERE token = ?').run(row.token);
    else db.prepare('UPDATE live_activities SET last_state = ? WHERE token = ?').run(json, row.token);
    sent++;
  }

  for (const row of db.prepare("SELECT * FROM live_activities WHERE kind = 'start'").all() as Row[]) {
    const prefs = readSettings(db, row.user_id).notifications;
    if (!prefs.enabled || !prefs.lockScreen) continue;
    const running = new Set((db.prepare("SELECT trip_id FROM live_activities WHERE kind = 'update' AND user_id = ?").all(row.user_id) as Row[]).map((r) => r.trip_id));
    const trips = db.prepare('SELECT trip_id FROM trip_members WHERE user_id = ?').all(row.user_id) as Row[];
    for (const { trip_id: tripId } of trips) {
      if (running.has(tripId)) continue;
      const steps = tripSteps(db, tripId, defaultTz);
      const first = firstUpcoming(steps, now);
      if (!first || first.at - now > START_BEFORE) continue;
      const state = lockState(steps, now);
      if (!state) continue;
      // One start per trip and day; the log entry is the lock (same table as reminders).
      const key = `la-start:${tripId}:${new Date(first.at).toISOString().slice(0, 10)}`;
      const fresh = db.prepare('INSERT OR IGNORE INTO push_log (user_id, key, sent_at) VALUES (?, ?, ?)').run(row.user_id, key, new Date(now).toISOString());
      if (Number(fresh.changes) === 0) continue;
      const trip = loadTrip(db, tripId);
      const res = await send(
        row.token,
        {
          aps: {
            timestamp: ts,
            event: 'start',
            'content-state': state,
            'attributes-type': 'ReisebuchActivityAttributes',
            attributes: { tripId, tripTitle: trip.title },
            alert: { title: `${state.icon} ${trip.title}`, body: `${state.title}: ${state.targetLabel} ${state.time}` },
            'stale-date': state.target + 2 * 3600,
          },
        },
        10,
      );
      if (res.gone) db.prepare('DELETE FROM live_activities WHERE token = ?').run(row.token);
      sent++;
      break; // one activity per user at a time
    }
  }
  return sent;
}
