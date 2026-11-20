import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { requireTripRole, requireUser } from '../auth.ts';
import { tx } from '../db.ts';
import { unlinkAttachmentFiles } from '../files.ts';
import { loadCruises, loadItems, loadMembers, loadTrip, loadTripDetail, touchTrip, tripFromRow } from '../model.ts';
import { memberInput, tripInput } from '../schemas.ts';
import { buildTimeline } from '../timeline.ts';
import { HttpError, newId, nowIso } from '../util.ts';
import { readSettings } from '../settings.ts';

type P = { Params: { tripId: string } };
type PM = { Params: { tripId: string; userId: string } };

export function registerTripRoutes(app: FastifyInstance, { db, config, uploadDir }: Ctx) {
  /** All trips the user is a member of, with dates derived from contents when not set. */
  app.get('/api/trips', async (req) => {
    const user = requireUser(req);
    const rows = db
      .prepare(
        `WITH spans AS (
           SELECT trip_id, substr(start_local, 1, 10) AS s, substr(coalesce(end_local, start_local), 1, 10) AS e FROM items
           UNION ALL
           SELECT c.trip_id, d.date, d.date FROM cruise_days d JOIN cruises c ON c.id = d.cruise_id
         )
         SELECT t.*, m.role,
                (SELECT min(s) FROM spans WHERE spans.trip_id = t.id) AS auto_start,
                (SELECT max(e) FROM spans WHERE spans.trip_id = t.id) AS auto_end,
                (SELECT json_group_array(ship_name) FROM cruises WHERE trip_id = t.id) AS ships,
                (SELECT count(*) FROM trip_members WHERE trip_id = t.id) AS member_count
           FROM trips t JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?`,
      )
      .all(user.id) as Record<string, any>[];
    return rows
      .map((r) => ({
        ...tripFromRow(r),
        role: r.role,
        effectiveStartDate: r.start_date ?? r.auto_start ?? null,
        effectiveEndDate: r.end_date ?? r.auto_end ?? null,
        ships: JSON.parse(r.ships) as string[],
        memberCount: r.member_count,
      }))
      .sort((a, b) => (a.effectiveStartDate ?? '9999').localeCompare(b.effectiveStartDate ?? '9999'));
  });

  app.post('/api/trips', async (req, reply) => {
    const user = requireUser(req);
    const input = tripInput.parse(req.body);
    const id = newId();
    const now = nowIso();
    tx(db, () => {
      db.prepare(
        `INSERT INTO trips (id, title, start_date, end_date, notes, color, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.title, input.startDate, input.endDate, input.notes, input.color, user.id, now, now);
      db.prepare(`INSERT INTO trip_members (trip_id, user_id, role) VALUES (?, ?, 'owner')`).run(id, user.id);
    });
    return reply.status(201).send(loadTripDetail(db, id, 'owner'));
  });

  app.get<P>('/api/trips/:tripId', async (req) => {
    const user = requireUser(req);
    const role = requireTripRole(db, req.params.tripId, user.id, 'viewer');
    return loadTripDetail(db, req.params.tripId, role);
  });

  app.patch<P>('/api/trips/:tripId', async (req) => {
    const user = requireUser(req);
    const role = requireTripRole(db, req.params.tripId, user.id, 'editor');
    const current = loadTrip(db, req.params.tripId);
    const input = tripInput.parse({ ...current, ...(req.body as object) });
    db.prepare(
      'UPDATE trips SET title = ?, start_date = ?, end_date = ?, notes = ?, color = ?, updated_at = ? WHERE id = ?',
    ).run(input.title, input.startDate, input.endDate, input.notes, input.color, nowIso(), req.params.tripId);
    return loadTripDetail(db, req.params.tripId, role);
  });

  app.delete<P>('/api/trips/:tripId', async (req, reply) => {
    const user = requireUser(req);
    requireTripRole(db, req.params.tripId, user.id, 'owner');
    unlinkAttachmentFiles(db, uploadDir, 'trip_id = ?', req.params.tripId);
    db.prepare('DELETE FROM trips WHERE id = ?').run(req.params.tripId);
    return reply.status(204).send();
  });

  /** Phase-structured timeline (Anreise, Kreuzfahrt, Abreise) plus buffer warnings. */
  app.get<P>('/api/trips/:tripId/timeline', async (req) => {
    const user = requireUser(req);
    requireTripRole(db, req.params.tripId, user.id, 'viewer');
    const trip = loadTrip(db, req.params.tripId);
    const { pace } = readSettings(db, user.id);
    return {
      tripId: trip.id,
      updatedAt: trip.updatedAt,
      defaultTimezone: config.defaultTz,
      /** The caller's personal time need, when enabled. All recommended times in the warnings already include it. */
      pace: pace.enabled ? pace : null,
      ...buildTimeline(loadCruises(db, trip.id), loadItems(db, trip.id), config.defaultTz, pace),
    };
  });

  // ----- sharing -----
  const ownerCount = (tripId: string) =>
    (db.prepare(`SELECT count(*) AS n FROM trip_members WHERE trip_id = ? AND role = 'owner'`).get(tripId) as {
      n: number;
    }).n;

  app.put<PM>('/api/trips/:tripId/members/:userId', async (req) => {
    const user = requireUser(req);
    const { tripId, userId } = req.params;
    requireTripRole(db, tripId, user.id, 'owner');
    const { role } = memberInput.parse(req.body);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new HttpError(404, 'Benutzer nicht gefunden');
    tx(db, () => {
      db.prepare(
        `INSERT INTO trip_members (trip_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT (trip_id, user_id) DO UPDATE SET role = excluded.role`,
      ).run(tripId, userId, role);
      if (ownerCount(tripId) === 0) throw new HttpError(409, 'Eine Reise braucht mindestens einen Besitzer');
      touchTrip(db, tripId);
    });
    return loadMembers(db, tripId);
  });

  app.delete<PM>('/api/trips/:tripId/members/:userId', async (req) => {
    const user = requireUser(req);
    const { tripId, userId } = req.params;
    // Owners can remove anyone; everyone can leave a trip themselves.
    requireTripRole(db, tripId, user.id, userId === user.id ? 'viewer' : 'owner');
    tx(db, () => {
      db.prepare('DELETE FROM trip_members WHERE trip_id = ? AND user_id = ?').run(tripId, userId);
      if (ownerCount(tripId) === 0) throw new HttpError(409, 'Eine Reise braucht mindestens einen Besitzer');
      touchTrip(db, tripId);
    });
    return loadMembers(db, tripId);
  });
}
