import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { requireTripRole, requireUser } from '../auth.ts';
import { tx, type DB } from '../db.ts';
import { unlinkAttachmentFiles } from '../files.ts';
import { itemFromRow, touchTrip } from '../model.ts';
import { itemInput, type ItemInput } from '../schemas.ts';
import { HttpError, newId, nowIso } from '../util.ts';

function checkCruiseDay(db: DB, tripId: string, cruiseDayId: string | null) {
  if (!cruiseDayId) return;
  const ok = db
    .prepare('SELECT 1 FROM cruise_days d JOIN cruises c ON c.id = d.cruise_id WHERE d.id = ? AND c.trip_id = ?')
    .get(cruiseDayId, tripId);
  if (!ok) throw new HttpError(400, 'Der gewählte Kreuzfahrt-Tag gehört nicht zu dieser Reise');
}

function itemRow(db: DB, id: string) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!row) throw new HttpError(404, 'Eintrag nicht gefunden');
  return row;
}

const columns = (i: ItemInput) =>
  [
    i.type,
    i.title,
    i.startLocal,
    i.startTz,
    i.endLocal,
    i.endTz,
    i.location,
    i.confirmation,
    i.provider,
    i.cost,
    i.currency,
    i.notes,
    JSON.stringify(i.details),
    i.cruiseDayId,
  ] as const;

export function registerItemRoutes(app: FastifyInstance, { db, uploadDir }: Ctx) {
  app.post<{ Params: { tripId: string } }>('/api/trips/:tripId/items', async (req, reply) => {
    const user = requireUser(req);
    const { tripId } = req.params;
    requireTripRole(db, tripId, user.id, 'editor');
    const input = itemInput.parse(req.body);
    checkCruiseDay(db, tripId, input.cruiseDayId);
    const id = newId();
    const now = nowIso();
    tx(db, () => {
      db.prepare(
        `INSERT INTO items (type, title, start_local, start_tz, end_local, end_tz, location, confirmation, provider,
                            cost, currency, notes, details, cruise_day_id, id, trip_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(...columns(input), id, tripId, now, now);
      touchTrip(db, tripId);
    });
    return reply.status(201).send(itemFromRow(itemRow(db, id)));
  });

  app.patch<{ Params: { itemId: string } }>('/api/items/:itemId', async (req) => {
    const user = requireUser(req);
    const row = itemRow(db, req.params.itemId);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    const input = itemInput.parse({ ...itemFromRow(row), ...(req.body as object) });
    checkCruiseDay(db, row.trip_id, input.cruiseDayId);
    tx(db, () => {
      db.prepare(
        `UPDATE items SET type = ?, title = ?, start_local = ?, start_tz = ?, end_local = ?, end_tz = ?, location = ?,
                confirmation = ?, provider = ?, cost = ?, currency = ?, notes = ?, details = ?, cruise_day_id = ?,
                updated_at = ? WHERE id = ?`,
      ).run(...columns(input), nowIso(), req.params.itemId);
      touchTrip(db, row.trip_id);
    });
    return itemFromRow(itemRow(db, req.params.itemId));
  });

  app.delete<{ Params: { itemId: string } }>('/api/items/:itemId', async (req, reply) => {
    const user = requireUser(req);
    const row = itemRow(db, req.params.itemId);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    unlinkAttachmentFiles(db, uploadDir, 'item_id = ?', req.params.itemId);
    tx(db, () => {
      db.prepare('DELETE FROM items WHERE id = ?').run(req.params.itemId);
      touchTrip(db, row.trip_id);
    });
    return reply.status(204).send();
  });
}
