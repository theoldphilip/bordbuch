/**
 * Live Activity tokens from the iPhone app: push-to-start (one per device) and update tokens (one per running activity).
 * Plus the current content of a trip, so the app can start an activity itself with exactly what the server would send.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { lockStateForTrip } from '../liveActivity.ts';
import { requireTripRole, requireUser } from '../auth.ts';
import { HttpError, nowIso } from '../util.ts';

const token = z.string().trim().regex(/^[0-9a-fA-F]{32,400}$/, 'Ungültiges Token').transform((t) => t.toLowerCase());
const tokenInput = z.object({
  token,
  kind: z.enum(['start', 'update']),
  tripId: z.string().optional(),
  /** previous token of the same kind on this device, removed when the system hands out a new one */
  replaces: token.optional(),
});

/** Push-to-start tokens kept per user (several iPhones). */
const MAX_START_TOKENS = 5;

export function registerLiveActivityRoutes(app: FastifyInstance, { db, config, apns }: Ctx) {
  app.post('/api/live-activity/tokens', async (req, reply) => {
    const user = requireUser(req);
    if (!apns) throw new HttpError(409, 'Push für die iPhone-App ist auf dem Server nicht eingerichtet.');
    const input = tokenInput.parse(req.body);
    if (input.kind === 'update') {
      if (!input.tripId) throw new HttpError(400, 'tripId fehlt');
      requireTripRole(db, input.tripId, user.id, 'viewer');
    }
    if (input.replaces) db.prepare('DELETE FROM live_activities WHERE token = ? AND user_id = ?').run(input.replaces, user.id);
    db.prepare(
      `INSERT INTO live_activities (token, user_id, kind, trip_id, last_state, created_at) VALUES (?, ?, ?, ?, NULL, ?)
       ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, kind = excluded.kind, trip_id = excluded.trip_id`,
    ).run(input.token, user.id, input.kind, input.kind === 'update' ? input.tripId! : null, nowIso());
    if (input.kind === 'start') {
      const old = db.prepare("SELECT token FROM live_activities WHERE user_id = ? AND kind = 'start' ORDER BY created_at DESC").all(user.id) as { token: string }[];
      for (const o of old.slice(MAX_START_TOKENS)) db.prepare('DELETE FROM live_activities WHERE token = ?').run(o.token);
    }
    return reply.status(201).send({ ok: true });
  });

  app.delete('/api/live-activity/tokens', async (req, reply) => {
    const user = requireUser(req);
    const { token: t } = z.object({ token }).parse(req.body);
    db.prepare('DELETE FROM live_activities WHERE token = ? AND user_id = ?').run(t, user.id);
    return reply.status(204).send();
  });

  /** Current lock screen content of a trip (null = nothing in the next 12 hours). */
  app.get<{ Params: { tripId: string } }>('/api/trips/:tripId/live-activity', async (req) => {
    const user = requireUser(req);
    requireTripRole(db, req.params.tripId, user.id, 'viewer');
    return { state: lockStateForTrip(db, req.params.tripId, config.defaultTz) };
  });
}
