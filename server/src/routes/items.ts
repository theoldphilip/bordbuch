import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { requireTripRole, requireUser } from '../auth.ts';
import { tx, type DB } from '../db.ts';
import { normalizePayment } from '../costs.ts';
import { unlinkAttachmentFiles } from '../files.ts';
import { itemFromRow, touchTrip } from '../model.ts';
import { describeChanges, placeChanges, type PlaceChange } from '../place.ts';
import type { PushSender } from '../push.ts';
import { itemInput, type ItemInput } from '../schemas.ts';
import { readSettings } from '../settings.ts';
import { toInstant } from '../timeline.ts';
import { HttpError, newId, nowIso } from '../util.ts';

export function checkCruiseDay(db: DB, tripId: string, cruiseDayId: string | null) {
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

const columns = (raw: ItemInput) => {
  const i = normalizePayment(raw);
  return [
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
    i.paymentStatus,
    i.paidAmount,
    i.dueDate,
    i.notes,
    JSON.stringify(i.details),
    i.cruiseDayId,
    JSON.stringify(i.infos),
  ] as const;
};

const bulkDeleteInput = z.object({ ids: z.array(z.string()).min(1).max(500) });

/**
 * Somebody entered or changed gate, desk, belt or platform of an entry that is about to happen (or just happened):
 * tell the other members of the trip, so nobody waits at the wrong gate. Only for members who switched
 * these messages on; the person who made the change is not notified about their own edit.
 */
async function announcePlaceChange(
  { db, sender, defaultTz }: { db: DB; sender: PushSender; defaultTz: string },
  item: ReturnType<typeof itemFromRow>,
  changes: PlaceChange[],
  by: { id: string; displayName: string },
): Promise<number> {
  const now = Date.now();
  const start = toInstant(item.startLocal, item.startTz ?? defaultTz);
  const end = toInstant(item.endLocal ?? item.startLocal, item.endTz ?? item.startTz ?? defaultTz);
  if (start > now + 36 * 3_600_000 || end < now - 8 * 3_600_000) return 0;
  const members = db.prepare('SELECT user_id FROM trip_members WHERE trip_id = ? AND user_id <> ?').all(item.tripId, by.id) as { user_id: string }[];
  let sent = 0;
  for (const { user_id: userId } of members) {
    const prefs = readSettings(db, userId).notifications;
    if (!prefs.enabled || !prefs.infoChange) continue;
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId) as Record<string, any>[];
    for (const s of subs) {
      const res = await sender.send(
        { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
        { title: `${item.type === 'flight' ? '✈️' : item.type === 'train' ? '🚆' : '📍'} ${item.title}`, body: `${describeChanges(changes)}. Eingetragen von ${by.displayName}.`, url: `/trips/${item.tripId}`, tag: `info:${item.id}` },
      );
      if (res.gone) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      else sent++;
    }
  }
  return sent;
}

export function registerItemRoutes(app: FastifyInstance, { db, uploadDir, sender, config }: Ctx) {
  /** Deletes several entries at once (e.g. a whole phase). All or nothing. */
  app.post<{ Params: { tripId: string } }>('/api/trips/:tripId/items/delete', async (req, reply) => {
    const user = requireUser(req);
    const { tripId } = req.params;
    requireTripRole(db, tripId, user.id, 'editor');
    const { ids } = bulkDeleteInput.parse(req.body);
    const unique = [...new Set(ids)];
    for (const id of unique) {
      if (!db.prepare('SELECT 1 FROM items WHERE id = ? AND trip_id = ?').get(id, tripId)) throw new HttpError(400, 'Ein Eintrag gehört nicht zu dieser Reise');
    }
    for (const id of unique) unlinkAttachmentFiles(db, uploadDir, 'item_id = ?', id);
    tx(db, () => {
      for (const id of unique) db.prepare('DELETE FROM items WHERE id = ?').run(id);
      touchTrip(db, tripId);
    });
    return reply.status(204).send();
  });

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
                            cost, currency, payment_status, paid_amount, due_date, notes, details, cruise_day_id, infos,
                            id, trip_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(...columns(input), id, tripId, now, now);
      touchTrip(db, tripId);
    });
    return reply.status(201).send(itemFromRow(itemRow(db, id)));
  });

  app.patch<{ Params: { itemId: string } }>('/api/items/:itemId', async (req) => {
    const user = requireUser(req);
    const row = itemRow(db, req.params.itemId);
    requireTripRole(db, row.trip_id, user.id, 'editor');
    const before = itemFromRow(row);
    const input = itemInput.parse({ ...before, ...(req.body as object) });
    checkCruiseDay(db, row.trip_id, input.cruiseDayId);
    tx(db, () => {
      db.prepare(
        `UPDATE items SET type = ?, title = ?, start_local = ?, start_tz = ?, end_local = ?, end_tz = ?, location = ?,
                confirmation = ?, provider = ?, cost = ?, currency = ?, payment_status = ?, paid_amount = ?, due_date = ?,
                notes = ?, details = ?, cruise_day_id = ?, infos = ?,
                updated_at = ? WHERE id = ?`,
      ).run(...columns(input), nowIso(), req.params.itemId);
      touchTrip(db, row.trip_id);
    });
    const after = itemFromRow(itemRow(db, req.params.itemId));
    const changes = placeChanges(before, after);
    if (changes.length) {
      // Announced in the background: a slow or failing push service must not slow down saving.
      announcePlaceChange({ db, sender, defaultTz: config.defaultTz }, after, changes, user).catch((err) => app.log.warn({ err }, 'Push bei Änderung fehlgeschlagen'));
    }
    return after;
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
