/**
 * Live flight status: admin settings for the flight data service (key tested before saving, never returned) and the
 * current status of the flights of a trip for the apps.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { DEFAULT_HOST, readFlightConfig, usage, writeFlightConfig } from '../flightdata.ts';
import { readStatus } from '../flightStatus.ts';
import { requireAdmin, requireTripRole, requireUser } from '../auth.ts';
import { HttpError } from '../util.ts';

const configInput = z.object({
  key: z.string().trim().min(10, 'Der Schlüssel ist zu kurz.').max(200).regex(/^\S+$/, 'Der Schlüssel darf keine Leerzeichen enthalten.').nullish(),
  host: z.string().trim().max(100).regex(/^[a-z0-9.-]*$/i, 'Ungültiger Host.').nullish(),
  monthlyLimit: z.number().int().min(10).max(100_000).nullish(),
});

export function registerFlightStatusRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, flight } = ctx;

  const view = () => {
    const stored = readFlightConfig(db);
    const eff = flight.effective();
    return {
      configurable: flight.configurable,
      configured: !!eff.key,
      source: stored.key ? 'settings' : eff.key ? 'env' : null,
      keyHint: eff.key ? `…${eff.key.slice(-4)}` : null,
      host: eff.host,
      defaultHost: DEFAULT_HOST,
      monthlyLimit: eff.monthlyLimit,
      usedThisMonth: usage(db).count,
    };
  };

  app.get('/api/flight-status/config', async (req) => {
    requireAdmin(req);
    return view();
  });

  app.put('/api/flight-status/config', async (req) => {
    requireAdmin(req);
    if (!flight.configurable) throw new HttpError(409, 'Der Flugstatus ist in dieser Umgebung fest eingestellt.');
    const input = configInput.parse(req.body ?? {});
    const stored = readFlightConfig(db);
    if (input.host !== undefined) stored.host = input.host || null;
    if (input.monthlyLimit !== undefined) stored.monthlyLimit = input.monthlyLimit ?? null;
    if (input.key === null) stored.key = null;
    if (typeof input.key === 'string') {
      try {
        await flight.factory({ key: input.key, host: stored.host || flight.effective().host }).check();
      } catch (err) {
        throw new HttpError(400, `Schlüssel nicht übernommen. ${(err as Error).message}`);
      }
      stored.key = input.key;
    }
    writeFlightConfig(db, stored);
    flight.reload();
    return view();
  });

  /** Live status of all flights of a trip: {itemId: status}. Empty when the service is not set up. */
  app.get<{ Params: { tripId: string } }>('/api/trips/:tripId/flight-status', async (req) => {
    const user = requireUser(req);
    requireTripRole(db, req.params.tripId, user.id, 'viewer');
    const ids = db.prepare("SELECT id FROM items WHERE trip_id = ? AND type = 'flight'").all(req.params.tripId) as { id: string }[];
    const out: Record<string, unknown> = {};
    for (const { id } of ids) {
      const s = readStatus(db, id);
      if (s) {
        const { notifiedDelay: _a, notifiedCancelled: _b, notifiedDiverted: _c, ...rest } = s as any;
        out[id] = rest;
      }
    }
    return { enabled: !!flight.client(), flights: out };
  });
}
