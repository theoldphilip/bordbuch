/**
 * AI review of a whole trip. Read-only: the result is a list of findings, nothing in the trip is changed.
 * It runs in the background (a long answer would run into proxy time-outs) and is stored per trip.
 */
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { describeAiError } from '../ai/anthropic.ts';
import { cleanReview, tripOutline, type ReviewData } from '../ai/review.ts';
import { requireTripRole, requireUser } from '../auth.ts';
import { loadCruises, loadItems, loadTrip } from '../model.ts';
import { buildTimeline } from '../timeline.ts';
import { HttpError, nowIso } from '../util.ts';
import { readSettings } from '../settings.ts';

type Row = Record<string, any>;

export function registerReviewRoutes(app: FastifyInstance, { db, config, extractor }: Ctx) {
  // A restart can interrupt a running review; don't leave it "pending" forever.
  for (const r of db.prepare(`SELECT trip_id, data FROM trip_reviews WHERE data LIKE '%"status":"pending"%'`).all() as Row[]) {
    const d = JSON.parse(r.data) as ReviewData;
    if (d.status === 'pending') db.prepare('UPDATE trip_reviews SET data = ? WHERE trip_id = ?').run(JSON.stringify({ ...d, status: 'failed', error: 'Die Prüfung wurde unterbrochen. Bitte erneut starten.', finishedAt: nowIso() }), r.trip_id);
  }

  const save = (tripId: string, data: ReviewData) =>
    db
      .prepare('INSERT INTO trip_reviews (trip_id, data) VALUES (?, ?) ON CONFLICT(trip_id) DO UPDATE SET data = excluded.data')
      .run(tripId, JSON.stringify(data));

  const read = (tripId: string) => {
    const row = db.prepare('SELECT data FROM trip_reviews WHERE trip_id = ?').get(tripId) as Row | undefined;
    return row ? (JSON.parse(row.data) as ReviewData) : null;
  };

  app.get<{ Params: { tripId: string } }>('/api/trips/:tripId/review', async (req) => {
    const user = requireUser(req);
    requireTripRole(db, req.params.tripId, user.id, 'viewer');
    const review = read(req.params.tripId);
    const trip = loadTrip(db, req.params.tripId);
    return { review, stale: !!review && review.status === 'done' && review.basedOn !== trip.updatedAt };
  });

  app.post<{ Params: { tripId: string } }>('/api/trips/:tripId/review', async (req, reply) => {
    const user = requireUser(req);
    const { tripId } = req.params;
    requireTripRole(db, tripId, user.id, 'editor');
    if (!extractor?.review) throw new HttpError(409, 'Die KI-Prüfung ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt).');
    if (read(tripId)?.status === 'pending') throw new HttpError(409, 'Die Prüfung läuft bereits.');
    const trip = loadTrip(db, tripId);
    const cruises = loadCruises(db, tripId);
    const items = loadItems(db, tripId);
    if (items.length === 0 && cruises.length === 0) throw new HttpError(400, 'Es gibt noch nichts zu prüfen. Lege zuerst Einträge oder die Kreuzfahrt an.');
    const { pace } = readSettings(db, user.id);
    const warnings = buildTimeline(cruises, items, config.defaultTz, pace).warnings;
    const startedAt = nowIso();
    save(tripId, { status: 'pending', startedAt, findings: [], basedOn: trip.updatedAt });
    const input = { outline: tripOutline(cruises, items, warnings), kind: trip.kind, today: new Date().toISOString().slice(0, 10), tripTitle: trip.title };
    const itemIds = new Set(items.map((i) => i.id));
    const dayIds = new Set(cruises.flatMap((c) => c.days.map((d) => d.id)));
    const { review } = extractor;
    void (async () => {
      try {
        const out = cleanReview(await review.call(extractor, input), itemIds, dayIds);
        // The trip may have been deleted while the model was thinking.
        if (db.prepare('SELECT 1 FROM trips WHERE id = ?').get(tripId)) {
          save(tripId, { status: 'done', startedAt, finishedAt: nowIso(), summary: out.summary, findings: out.findings, model: extractor.model, basedOn: trip.updatedAt });
        }
      } catch (err) {
        app.log.warn({ err }, 'Reise-Prüfung fehlgeschlagen');
        if (db.prepare('SELECT 1 FROM trips WHERE id = ?').get(tripId)) save(tripId, { status: 'failed', startedAt, finishedAt: nowIso(), error: describeAiError(err), findings: [], basedOn: trip.updatedAt });
      }
    })();
    return reply.status(202).send({ review: { status: 'pending', startedAt, findings: [], basedOn: trip.updatedAt }, stale: false });
  });
}
