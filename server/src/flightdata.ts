/**
 * Live flight status from AeroDataBox (via RapidAPI): revised times, terminal, check-in desk, gate, baggage belt and
 * status of one flight on one date. Plain HTTPS, no SDK. Parsing is defensive because the service has used two shapes
 * for times (nested {utc, local} and flat ...Utc/...Local fields).
 */
import type { DB } from './db.ts';

export type FetchFn = typeof fetch;

export interface FlightLive {
  /** Status as reported, e.g. Expected, CheckIn, Boarding, GateClosed, Departed, EnRoute, Delayed, Landed, Arrived, Canceled, Diverted */
  status: string;
  cancelled: boolean;
  diverted: boolean;
  /** Local times "YYYY-MM-DDTHH:MM" at the airport, as reported (null = not reported) */
  depScheduled: string | null;
  depRevised: string | null;
  arrScheduled: string | null;
  arrRevised: string | null;
  /** Minutes of departure delay (revised minus scheduled), null when unknown */
  delayMinutes: number | null;
  terminal: string | null;
  checkinDesk: string | null;
  gate: string | null;
  baggageBelt: string | null;
  arrTerminal: string | null;
  arrGate: string | null;
  depAirport: string | null;
  arrAirport: string | null;
}

export class FlightDataError extends Error {}

export interface FlightDataConfig {
  key: string;
  host: string;
}

export const DEFAULT_HOST = 'aerodatabox.p.rapidapi.com';
const META_KEY = 'flightdata_config';

/** "LX 1726" → "LX1726"; null when it does not look like a flight number. */
export function normalizeFlightNumber(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const n = v.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{2,3}\d{1,5}[A-Z]?$/.test(n) ? n : null;
}

/** "2027-05-08 09:40+02:00" or "2027-05-08T09:40" → "2027-05-08T09:40" */
function localTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : null;
}
function utcMs(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v.replace(' ', 'T').replace(/Z$/, 'Z'));
  return Number.isFinite(t) ? t : null;
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 20) : typeof v === 'number' ? String(v) : null);

/** Time of a movement in either shape: {scheduledTime: {local, utc}} or {scheduledTimeLocal, scheduledTimeUtc}. */
function time(m: any, kind: 'scheduled' | 'revised' | 'predicted'): { local: string | null; utc: number | null } {
  const nested = m?.[`${kind}Time`];
  return {
    local: localTime(nested?.local ?? m?.[`${kind}TimeLocal`]),
    utc: utcMs(nested?.utc ?? m?.[`${kind}TimeUtc`]),
  };
}

/** Picks the flight that departs from `from` (IATA) if several legs come back, and turns it into FlightLive. */
export function parseFlight(body: unknown, from: string | null): FlightLive | null {
  const list = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
  if (list.length === 0) return null;
  const want = from?.trim().toUpperCase();
  const f: any = (want && list.find((x: any) => String(x?.departure?.airport?.iata ?? '').toUpperCase() === want)) ?? list[0];
  const dep = f?.departure ?? {};
  const arr = f?.arrival ?? {};
  const depS = time(dep, 'scheduled');
  const depR = time(dep, 'revised');
  const depP = time(dep, 'predicted');
  const arrS = time(arr, 'scheduled');
  const arrR = time(arr, 'revised');
  const arrP = time(arr, 'predicted');
  const revisedDep = depR.utc !== null ? depR : depP;
  const status = String(f?.status ?? 'Unknown');
  return {
    status,
    cancelled: /cancel/i.test(status),
    diverted: /divert/i.test(status),
    depScheduled: depS.local,
    depRevised: revisedDep.local,
    arrScheduled: arrS.local,
    arrRevised: (arrR.local ?? arrP.local) || null,
    delayMinutes: depS.utc !== null && revisedDep.utc !== null ? Math.round((revisedDep.utc - depS.utc) / 60_000) : null,
    terminal: str(dep.terminal),
    checkinDesk: str(dep.checkInDesk),
    gate: str(dep.gate),
    baggageBelt: str(arr.baggageBelt),
    arrTerminal: str(arr.terminal),
    arrGate: str(arr.gate),
    depAirport: str(dep.airport?.iata),
    arrAirport: str(arr.airport?.iata),
  };
}

export interface FlightDataClient {
  /** Status of one flight on one local departure date (YYYY-MM-DD). null = the service knows no such flight. */
  status(flightNumber: string, date: string, from: string | null): Promise<FlightLive | null>;
  check(): Promise<void>;
}

export function createAeroDataBox(config: FlightDataConfig, fetchFn: FetchFn = fetch): FlightDataClient {
  const headers = { 'X-RapidAPI-Key': config.key, 'X-RapidAPI-Host': config.host };
  const get = async (path: string) => {
    let res: Response;
    try {
      res = await fetchFn(`https://${config.host}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new FlightDataError(`Keine Verbindung zum Flugdaten-Dienst (${(err as Error).message}).`);
    }
    if (res.status === 204 || res.status === 404) return null;
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new FlightDataError('Der Schlüssel für den Flugdaten-Dienst wurde abgelehnt (oder das Abo fehlt).');
    if (res.status === 429) throw new FlightDataError('Kontingent des Flugdaten-Dienstes erschöpft oder zu viele Anfragen.');
    if (!res.ok) throw new FlightDataError(`Flugdaten-Dienst: Fehler ${res.status}.`);
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new FlightDataError('Flugdaten-Dienst: unerwartete Antwort.');
    }
  };
  return {
    async status(flightNumber, date, from) {
      const body = await get(`/flights/number/${encodeURIComponent(flightNumber)}/${date}?withAircraftImage=false&withLocation=false&dateLocalRole=Departure`);
      return body ? parseFlight(body, from) : null;
    },
    async check() {
      // A real, cheap lookup: one known airport. Any 2xx means key and subscription work.
      await get('/airports/iata/ZRH');
    },
  };
}

// ---------- configuration (admin settings first, then environment) ----------

export function readFlightConfig(db: DB): { key: string | null; host: string | null; monthlyLimit: number | null } {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY) as { value: string } | undefined;
  try {
    const v = row ? JSON.parse(row.value) : {};
    return { key: v.key ?? null, host: v.host ?? null, monthlyLimit: typeof v.monthlyLimit === 'number' ? v.monthlyLimit : null };
  } catch {
    return { key: null, host: null, monthlyLimit: null };
  }
}

export function writeFlightConfig(db: DB, v: { key: string | null; host: string | null; monthlyLimit: number | null }): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(META_KEY, JSON.stringify(v));
}

/** Requests used this calendar month (UTC), kept in meta so the limit survives restarts. */
export function usage(db: DB, now = Date.now()): { month: string; count: number } {
  const month = new Date(now).toISOString().slice(0, 7);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'flightdata_usage'").get() as { value: string } | undefined;
  try {
    const v = row ? JSON.parse(row.value) : null;
    return v?.month === month ? { month, count: Number(v.count) || 0 } : { month, count: 0 };
  } catch {
    return { month, count: 0 };
  }
}

export function countRequest(db: DB, now = Date.now()): number {
  const u = usage(db, now);
  const next = { month: u.month, count: u.count + 1 };
  db.prepare("INSERT INTO meta (key, value) VALUES ('flightdata_usage', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  return next.count;
}
