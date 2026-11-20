import type { DB } from './db.ts';
import type { CruiseDayKind, Info, ItemType } from './schemas.ts';
import type { Role } from './auth.ts';
import { HttpError, nowIso } from './util.ts';

// ---------- API shapes (camelCase, shared with web + iOS clients) ----------
export interface Trip {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface CruiseDay {
  id: string;
  cruiseId: string;
  date: string;
  kind: CruiseDayKind;
  portName: string | null;
  country: string | null;
  timezone: string | null;
  arrival: string | null;
  departure: string | null;
  allAboard: string | null;
  tender: boolean;
  notes: string | null;
  infos: Info[];
}

export interface Cruise {
  id: string;
  tripId: string;
  shipName: string;
  cruiseLine: string | null;
  cabin: string | null;
  bookingRef: string | null;
  notes: string | null;
  infos: Info[];
  days: CruiseDay[];
}

export interface Item {
  id: string;
  tripId: string;
  type: ItemType;
  title: string;
  startLocal: string;
  startTz: string | null;
  endLocal: string | null;
  endTz: string | null;
  location: string | null;
  confirmation: string | null;
  provider: string | null;
  cost: number | null;
  currency: string | null;
  notes: string | null;
  cruiseDayId: string | null;
  details: Record<string, unknown>;
  infos: Info[];
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  tripId: string;
  itemId: string | null;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  /** null = never analysed. 'done' = proposals wait for review. */
  analysisStatus: 'pending' | 'done' | 'failed' | 'applied' | 'dismissed' | null;
  analysisError: string | null;
}

export interface TripDetail {
  trip: Trip;
  role: Role;
  members: Member[];
  cruises: Cruise[];
  items: Item[];
  attachments: Attachment[];
}

// ---------- row mappers ----------
type Row = Record<string, any>;

export function parseInfos(raw: unknown): Info[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? (v as Info[]) : [];
  } catch {
    return [];
  }
}

export const tripFromRow = (r: Row): Trip => ({
  id: r.id,
  title: r.title,
  startDate: r.start_date,
  endDate: r.end_date,
  notes: r.notes,
  color: r.color,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const cruiseDayFromRow = (r: Row): CruiseDay => ({
  id: r.id,
  cruiseId: r.cruise_id,
  date: r.date,
  kind: r.kind,
  portName: r.port_name,
  country: r.country,
  timezone: r.timezone,
  arrival: r.arrival,
  departure: r.departure,
  allAboard: r.all_aboard,
  tender: r.tender === 1,
  notes: r.notes,
  infos: parseInfos(r.infos),
});

export const itemFromRow = (r: Row): Item => ({
  id: r.id,
  tripId: r.trip_id,
  type: r.type,
  title: r.title,
  startLocal: r.start_local,
  startTz: r.start_tz,
  endLocal: r.end_local,
  endTz: r.end_tz,
  location: r.location,
  confirmation: r.confirmation,
  provider: r.provider,
  cost: r.cost,
  currency: r.currency,
  notes: r.notes,
  cruiseDayId: r.cruise_day_id,
  details: JSON.parse(r.details || '{}'),
  infos: parseInfos(r.infos),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const attachmentFromRow = (r: Row): Attachment => ({
  id: r.id,
  tripId: r.trip_id,
  itemId: r.item_id,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  createdAt: r.created_at,
  analysisStatus: r.analysis_status ?? null,
  analysisError: r.analysis_error ?? null,
});

// ---------- loaders ----------
const DAY_KIND_ORDER = "CASE kind WHEN 'embarkation' THEN 0 WHEN 'port' THEN 1 WHEN 'sea' THEN 1 ELSE 2 END";

export function loadCruises(db: DB, tripId: string): Cruise[] {
  const cruises = db.prepare('SELECT * FROM cruises WHERE trip_id = ? ORDER BY created_at').all(tripId) as Row[];
  const dayStmt = db.prepare(
    `SELECT * FROM cruise_days WHERE cruise_id = ? ORDER BY date, ${DAY_KIND_ORDER}, arrival`,
  );
  const result = cruises.map((c) => ({
    id: c.id,
    tripId: c.trip_id,
    shipName: c.ship_name,
    cruiseLine: c.cruise_line,
    cabin: c.cabin,
    bookingRef: c.booking_ref,
    notes: c.notes,
    infos: parseInfos(c.infos),
    days: (dayStmt.all(c.id) as Row[]).map(cruiseDayFromRow),
  }));
  // Chronological order of cruises (back-to-back cruises on one trip).
  return result.sort((a, b) => (a.days[0]?.date ?? '9999').localeCompare(b.days[0]?.date ?? '9999'));
}

export function loadItems(db: DB, tripId: string): Item[] {
  return (db.prepare('SELECT * FROM items WHERE trip_id = ? ORDER BY start_local').all(tripId) as Row[]).map(
    itemFromRow,
  );
}

export function loadMembers(db: DB, tripId: string): Member[] {
  return (
    db
      .prepare(
        `SELECT m.user_id, m.role, u.username, u.display_name
           FROM trip_members m JOIN users u ON u.id = m.user_id
          WHERE m.trip_id = ?
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.display_name`,
      )
      .all(tripId) as Row[]
  ).map((r) => ({ userId: r.user_id, username: r.username, displayName: r.display_name, role: r.role }));
}

export function loadTrip(db: DB, tripId: string): Trip {
  const row = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId) as Row | undefined;
  if (!row) throw new HttpError(404, 'Reise nicht gefunden');
  return tripFromRow(row);
}

export function loadTripDetail(db: DB, tripId: string, role: Role): TripDetail {
  return {
    trip: loadTrip(db, tripId),
    role,
    members: loadMembers(db, tripId),
    cruises: loadCruises(db, tripId),
    items: loadItems(db, tripId),
    attachments: (
      db.prepare('SELECT * FROM attachments WHERE trip_id = ? ORDER BY created_at').all(tripId) as Row[]
    ).map(attachmentFromRow),
  };
}

/** Bump the trip's updated_at so clients can detect changes cheaply. */
export function touchTrip(db: DB, tripId: string): void {
  db.prepare('UPDATE trips SET updated_at = ? WHERE id = ?').run(nowIso(), tripId);
}
