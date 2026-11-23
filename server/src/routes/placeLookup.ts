import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { describeAiError } from '../ai/anthropic.ts';
import type { PlaceFinding } from '../ai/placeLookup.ts';
import { requireTripRole, requireUser } from '../auth.ts';
import { itemFromRow } from '../model.ts';
import { PLACE_FIELDS } from '../place.ts';
import { HttpError } from '../util.ts';

/** Shown to the client: what was found, next to what is entered now. Nothing is saved by the lookup itself. */
export interface PlaceLookupState {
  status: 'pending' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  summary?: string;
  searches?: number;
  queries?: string[];
  findings: (PlaceFinding & { label: string; current: string | null })[];
}

/** Details the model may see: what identifies the flight or train and the place fields. No booking number, no seat. */
const LOOKUP_DETAILS = ['airline', 'flightNumber', 'trainNumber', 'from', 'to'];

/** "2027-05-09 07:42 (Europe/Zurich)": the current time where the entry starts, so the model knows if it is today. */
function nowIn(tz: string): string {
  try {
    const s = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
    return `${s} (${tz})`;
  } catch {
    return new Date().toISOString();
  }
}

export function registerPlaceLookupRoutes(app: FastifyInstance, { db, extractor, config }: Ctx) {
  // Kept in memory: a lookup is only interesting for minutes; after a restart it is simply started again.
  const jobs = new Map<string, PlaceLookupState>();

  const loadItem = (itemId: string) => {
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Record<string, any> | undefined;
    if (!row) throw new HttpError(404, 'Eintrag nicht gefunden');
    return itemFromRow(row);
  };

  app.get<{ Params: { itemId: string } }>('/api/items/:itemId/place-lookup', async (req) => {
    const user = requireUser(req);
    const item = loadItem(req.params.itemId);
    requireTripRole(db, item.tripId, user.id, 'viewer');
    return { lookup: jobs.get(item.id) ?? null };
  });

  app.post<{ Params: { itemId: string } }>('/api/items/:itemId/place-lookup', async (req, reply) => {
    const user = requireUser(req);
    const item = loadItem(req.params.itemId);
    requireTripRole(db, item.tripId, user.id, 'editor');
    const lookup = extractor?.lookupPlace?.bind(extractor);
    if (!lookup) throw new HttpError(409, 'Die Abfrage ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt).');
    const fields = PLACE_FIELDS[item.type];
    if (!fields?.length) throw new HttpError(400, 'Für diese Art von Eintrag gibt es keine Angaben wie Gate, Schalter oder Gleis.');
    if (jobs.get(item.id)?.status === 'pending') throw new HttpError(409, 'Die Abfrage läuft bereits.');

    const state: PlaceLookupState = { status: 'pending', startedAt: new Date().toISOString(), findings: [] };
    jobs.set(item.id, state);
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const details = Object.fromEntries(
      [...LOOKUP_DETAILS, ...fields.map((f) => f.key)].map((k) => [k, text(item.details[k])] as const).filter((e): e is [string, string] => !!e[1]),
    );
    lookup({
      now: nowIn(item.startTz ?? config.defaultTz),
      item: { type: item.type, title: item.title, startLocal: item.startLocal, startTz: item.startTz, endLocal: item.endLocal, provider: item.provider, location: item.location, details },
      fields,
    })
      .then((out) => {
        // Compare with what is entered now (somebody may have typed the gate in the meantime).
        const current = (() => {
          try {
            return loadItem(item.id).details;
          } catch {
            return item.details;
          }
        })();
        jobs.set(item.id, {
          ...state, status: 'done', finishedAt: new Date().toISOString(), summary: out.summary, searches: out.searches, queries: out.queries,
          findings: out.findings.map((f) => ({ ...f, label: fields.find((x) => x.key === f.key)!.label, current: text(current[f.key]) })),
        });
      })
      .catch((err) => {
        jobs.set(item.id, { ...state, status: 'failed', finishedAt: new Date().toISOString(), error: describeAiError(err) });
      });
    return reply.status(202).send({ lookup: state });
  });
}
