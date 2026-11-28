/**
 * Live flight status: for every flight with a flight number, from 24 h before departure until after landing, the
 * server asks the flight data service at sensible intervals (rarely far ahead, often close to departure). New
 * terminal, desk, gate or belt go into the entry like a manual edit (and are announced to the members); delays of
 * 15 minutes or more, cancellations and diversions are sent as notifications. Planned times in the entry stay as
 * they are; the live data is shown next to them.
 */
import type { DB } from './db.ts';
import { countRequest, normalizeFlightNumber, usage, type FlightDataClient, type FlightLive } from './flightdata.ts';
import { itemFromRow, touchTrip, type Item } from './model.ts';
import { placeChanges } from './place.ts';
import { deliverToUser, type Senders } from './push.ts';
import { announcePlaceChange } from './routes/items.ts';
import { readSettings } from './settings.ts';
import { toInstant } from './timeline.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface StoredFlightStatus extends FlightLive {
  checkedAt: string;
  /** Delay that was last announced, so a notification goes out only when it changes noticeably. */
  notifiedDelay: number;
  notifiedCancelled: boolean;
  notifiedDiverted: boolean;
}

/** When to ask next: hourly far ahead, every 15 min in the last 6 h, every 5 min around departure, then every 20 min for the belt. */
export function nextInterval(depAt: number, now: number, live: FlightLive | null): number {
  const ahead = depAt - now;
  if (live?.cancelled) return 6 * HOUR;
  if (ahead > 6 * HOUR) return 60 * MIN;
  if (ahead > HOUR) return 15 * MIN;
  if (ahead > -30 * MIN) return 5 * MIN;
  return 20 * MIN;
}

/** Window in which a flight is watched: from 24 h before departure until 1 h after (revised) arrival, at most 30 h after departure. */
export function watchWindow(item: Pick<Item, 'startLocal' | 'startTz' | 'endLocal' | 'endTz'>, defaultTz: string): { depAt: number; from: number; until: number } {
  const depAt = toInstant(item.startLocal, item.startTz ?? defaultTz);
  const arrAt = item.endLocal && /T\d{2}:\d{2}/.test(item.endLocal) ? toInstant(item.endLocal, item.endTz ?? item.startTz ?? defaultTz) : depAt + 12 * HOUR;
  return { depAt, from: depAt - 24 * HOUR, until: Math.min(Math.max(arrAt, depAt) + HOUR, depAt + 30 * HOUR) };
}

const hhmm = (local: string | null) => (local ? local.slice(11, 16) : '?');

/** The notification for a status change, or null if nothing worth telling happened. */
export function statusNotice(item: Pick<Item, 'title' | 'details'>, live: FlightLive, prev: Pick<StoredFlightStatus, 'notifiedDelay' | 'notifiedCancelled' | 'notifiedDiverted'> | null): { title: string; body: string } | null {
  const fn = normalizeFlightNumber(item.details.flightNumber) ?? item.title;
  if (live.cancelled && !prev?.notifiedCancelled) return { title: `❌ ${fn} annulliert`, body: `${item.title}: Der Flug ist laut Flugstatus annulliert. Bitte bei der Airline nach dem Ersatz schauen.` };
  if (live.diverted && !prev?.notifiedDiverted) return { title: `↪️ ${fn} umgeleitet`, body: `${item.title}: Der Flug wurde laut Flugstatus umgeleitet.` };
  if (live.cancelled || live.delayMinutes === null) return null;
  const before = prev?.notifiedDelay ?? 0;
  const now = live.delayMinutes;
  if (Math.abs(now - before) < 15 || (now < 15 && before < 15)) return null;
  if (now < 15) return { title: `✅ ${fn} wieder planmäßig`, body: `${item.title}: Abflug ${hhmm(live.depRevised ?? live.depScheduled)} (Ortszeit).` };
  return {
    title: `⏱️ ${fn} verspätet: +${now} min`,
    body: `${item.title}: Abflug neu ${hhmm(live.depRevised)} statt ${hhmm(live.depScheduled)} (Ortszeit).${live.gate ? ` Gate ${live.gate}.` : ''}`,
  };
}

type Row = Record<string, any>;

export function readStatus(db: DB, itemId: string): (StoredFlightStatus & { error: string | null }) | null {
  const row = db.prepare('SELECT data, error FROM flight_status WHERE item_id = ?').get(itemId) as Row | undefined;
  if (!row?.data) return row?.error ? ({ error: row.error } as any) : null;
  try {
    return { ...JSON.parse(row.data), error: row.error ?? null };
  } catch {
    return null;
  }
}

/** One pass: asks for every watched flight that is due. Returns the number of requests made. */
export async function runFlightTick(
  { db, defaultTz, client, senders, monthlyLimit, log }: { db: DB; defaultTz: string; client: FlightDataClient | null; senders: Senders; monthlyLimit: number; log?: (m: string) => void },
  now = Date.now(),
): Promise<number> {
  if (!client) return 0;
  const rows = db.prepare("SELECT * FROM items WHERE type = 'flight'").all() as Row[];
  let requests = 0;
  for (const row of rows) {
    const item = itemFromRow(row);
    const flightNumber = normalizeFlightNumber(item.details.flightNumber);
    if (!flightNumber || !/T\d{2}:\d{2}/.test(item.startLocal)) continue;
    const w = watchWindow(item, defaultTz);
    if (now < w.from || now > w.until) continue;
    const state = db.prepare('SELECT next_check_at FROM flight_status WHERE item_id = ?').get(item.id) as Row | undefined;
    if (state && Number(state.next_check_at) > now) continue;
    if (usage(db, now).count >= monthlyLimit) {
      log?.(`Live-Flugstatus: Monatsgrenze von ${monthlyLimit} Abfragen erreicht, keine weiteren Abfragen bis Monatsende.`);
      return requests;
    }

    const prev = readStatus(db, item.id);
    let live: FlightLive | null = null;
    try {
      requests++;
      countRequest(db, now);
      live = await client.status(flightNumber, item.startLocal.slice(0, 10), typeof item.details.from === 'string' ? item.details.from : null);
    } catch (err) {
      db.prepare(
        `INSERT INTO flight_status (item_id, data, checked_at, next_check_at, error) VALUES (?, NULL, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET next_check_at = excluded.next_check_at, error = excluded.error, checked_at = excluded.checked_at`,
      ).run(item.id, new Date(now).toISOString(), now + 15 * MIN, (err as Error).message.slice(0, 300));
      continue;
    }
    const next = now + nextInterval(w.depAt, now, live);
    if (!live) {
      db.prepare(
        `INSERT INTO flight_status (item_id, data, checked_at, next_check_at, error) VALUES (?, NULL, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET next_check_at = excluded.next_check_at, error = excluded.error, checked_at = excluded.checked_at`,
      ).run(item.id, new Date(now).toISOString(), now + 60 * MIN, 'Der Flugdaten-Dienst kennt diesen Flug (noch) nicht.');
      continue;
    }

    // Statuses go to every member who wants them; nobody "made" this change.
    const notice = statusNotice(item, live, prev);
    const stored: StoredFlightStatus = {
      ...live,
      checkedAt: new Date(now).toISOString(),
      notifiedDelay: notice && !live.cancelled && !live.diverted && live.delayMinutes !== null ? live.delayMinutes : (prev?.notifiedDelay ?? 0),
      notifiedCancelled: live.cancelled || !!prev?.notifiedCancelled,
      notifiedDiverted: live.diverted || !!prev?.notifiedDiverted,
    };
    db.prepare(
      `INSERT INTO flight_status (item_id, data, checked_at, next_check_at, error) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(item_id) DO UPDATE SET data = excluded.data, checked_at = excluded.checked_at, next_check_at = excluded.next_check_at, error = NULL`,
    ).run(item.id, JSON.stringify(stored), stored.checkedAt, next);

    if (notice && w.depAt > now - 30 * MIN) {
      const members = db.prepare('SELECT user_id FROM trip_members WHERE trip_id = ?').all(item.tripId) as Row[];
      for (const { user_id: userId } of members) {
        const prefs = readSettings(db, userId).notifications;
        if (!prefs.enabled || !prefs.flightStatus) continue;
        await deliverToUser(db, senders, userId, { ...notice, url: `/trips/${item.tripId}`, tag: `live:${item.id}` });
      }
    }

    // New place values go into the entry (only values the service reports; nothing is removed).
    const patch: Record<string, string> = {};
    for (const [key, value] of [['terminal', live.terminal], ['checkinDesk', live.checkinDesk], ['gate', live.gate], ['baggageBelt', live.baggageBelt]] as const) {
      if (value && value !== (typeof item.details[key] === 'string' ? item.details[key].trim() : item.details[key])) patch[key] = value;
    }
    if (Object.keys(patch).length) {
      const after = { ...item, details: { ...item.details, ...patch } };
      const changes = placeChanges(item, after);
      db.prepare('UPDATE items SET details = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(after.details), new Date(now).toISOString(), item.id);
      touchTrip(db, item.tripId);
      if (changes.length) await announcePlaceChange({ db, ...senders, defaultTz }, after, changes, null, now);
    }
  }
  return requests;
}
