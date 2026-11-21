import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { requireTripRole, requireUser } from '../auth.ts';
import { tx, type DB } from '../db.ts';
import { cruiseDayFromRow, loadCruises, touchTrip } from '../model.ts';
import { cruiseCreateInput, cruiseDayInput, cruiseInput, type CruiseDayInput } from '../schemas.ts';
import { HttpError, newId, nowIso } from '../util.ts';

export function insertDay(db: DB, cruiseId: string, d: CruiseDayInput): string {
  const id = newId();
  db.prepare(
    `INSERT INTO cruise_days (id, cruise_id, date, kind, port_name, country, timezone, arrival, departure, all_aboard, tender, notes, infos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, cruiseId, d.date, d.kind, d.portName, d.country, d.timezone, d.arrival, d.departure, d.allAboard, d.tender ? 1 : 0, d.notes, JSON.stringify(d.infos));
  return id;
}

function cruiseTrip(db: DB, cruiseId: string): string {
  const row = db.prepare('SELECT trip_id FROM cruises WHERE id = ?').get(cruiseId) as { trip_id: string } | undefined;
  if (!row) throw new HttpError(404, 'Kreuzfahrt nicht gefunden');
  return row.trip_id;
}

function dayRow(db: DB, dayId: string) {
  const row = db
    .prepare('SELECT d.*, c.trip_id FROM cruise_days d JOIN cruises c ON c.id = d.cruise_id WHERE d.id = ?')
    .get(dayId) as Record<string, any> | undefined;
  if (!row) throw new HttpError(404, 'Reisetag nicht gefunden');
  return row;
}

const findCruise = (db: DB, tripId: string, cruiseId: string) => loadCruises(db, tripId).find((c) => c.id === cruiseId)!;

export function registerCruiseRoutes(app: FastifyInstance, { db }: Ctx) {
  app.post<{ Params: { tripId: string } }>('/api/trips/:tripId/cruises', async (req, reply) => {
    const user = requireUser(req);
    const { tripId } = req.params;
    requireTripRole(db, tripId, user.id, 'editor');
    const input = cruiseCreateInput.parse(req.body);
    const id = newId();
    const now = nowIso();
    tx(db, () => {
      db.prepare(
        `INSERT INTO cruises (id, trip_id, ship_name, cruise_line, cabin, booking_ref, notes, infos, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, tripId, input.shipName, input.cruiseLine, input.cabin, input.bookingRef, input.notes, JSON.stringify(input.infos), now, now);
      for (const d of input.days) insertDay(db, id, d);
      db.prepare("UPDATE trips SET kind = 'cruise' WHERE id = ?").run(tripId);
      touchTrip(db, tripId);
    });
    return reply.status(201).send(findCruise(db, tripId, id));
  });

  app.patch<{ Params: { cruiseId: string } }>('/api/cruises/:cruiseId', async (req) => {
    const user = requireUser(req);
    const tripId = cruiseTrip(db, req.params.cruiseId);
    requireTripRole(db, tripId, user.id, 'editor');
    const current = findCruise(db, tripId, req.params.cruiseId);
    const input = cruiseInput.parse({ ...current, ...(req.body as object) });
    tx(db, () => {
      db.prepare(
        'UPDATE cruises SET ship_name = ?, cruise_line = ?, cabin = ?, booking_ref = ?, notes = ?, infos = ?, updated_at = ? WHERE id = ?',
      ).run(input.shipName, input.cruiseLine, input.cabin, input.bookingRef, input.notes, JSON.stringify(input.infos), nowIso(), req.params.cruiseId);
      touchTrip(db, tripId);
    });
    return findCruise(db, tripId, req.params.cruiseId);
  });

  app.delete<{ Params: { cruiseId: string } }>('/api/cruises/:cruiseId', async (req, reply) => {
    const user = requireUser(req);
    const tripId = cruiseTrip(db, req.params.cruiseId);
    requireTripRole(db, tripId, user.id, 'editor');
    tx(db, () => {
      db.prepare('DELETE FROM cruises WHERE id = ?').run(req.params.cruiseId);
      touchTrip(db, tripId);
    });
    return reply.status(204).send();
  });

  app.post<{ Params: { cruiseId: string } }>('/api/cruises/:cruiseId/days', async (req, reply) => {
    const user = requireUser(req);
    const tripId = cruiseTrip(db, req.params.cruiseId);
    requireTripRole(db, tripId, user.id, 'editor');
    const input = cruiseDayInput.parse(req.body);
    const id = tx(db, () => {
      const dayId = insertDay(db, req.params.cruiseId, input);
      touchTrip(db, tripId);
      return dayId;
    });
    return reply.status(201).send(cruiseDayFromRow(dayRow(db, id)));
  });

  app.patch<{ Params: { dayId: string } }>('/api/cruise-days/:dayId', async (req) => {
    const user = requireUser(req);
    const row = dayRow(db, req.params.dayId);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    const d = cruiseDayInput.parse({ ...cruiseDayFromRow(row), ...(req.body as object) });
    tx(db, () => {
      db.prepare(
        `UPDATE cruise_days SET date = ?, kind = ?, port_name = ?, country = ?, timezone = ?, arrival = ?, departure = ?,
                all_aboard = ?, tender = ?, notes = ?, infos = ? WHERE id = ?`,
      ).run(d.date, d.kind, d.portName, d.country, d.timezone, d.arrival, d.departure, d.allAboard, d.tender ? 1 : 0, d.notes, JSON.stringify(d.infos), req.params.dayId);
      touchTrip(db, row.trip_id);
    });
    return cruiseDayFromRow(dayRow(db, req.params.dayId));
  });

  app.delete<{ Params: { dayId: string } }>('/api/cruise-days/:dayId', async (req, reply) => {
    const user = requireUser(req);
    const row = dayRow(db, req.params.dayId);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    tx(db, () => {
      db.prepare('DELETE FROM cruise_days WHERE id = ?').run(req.params.dayId);
      touchTrip(db, row.trip_id);
    });
    return reply.status(204).send();
  });
}
