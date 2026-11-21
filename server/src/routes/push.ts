import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { requireUser } from '../auth.ts';
import { isPushEndpoint } from '../push.ts';
import { HttpError, newId, nowIso } from '../util.ts';

const subscribeInput = z.object({
  endpoint: z.string().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
  deviceName: z.string().trim().max(80).nullish(),
});

export function registerPushRoutes(app: FastifyInstance, { db, sender }: Ctx) {
  app.get('/api/push/key', async () => ({ publicKey: sender.publicKey }));

  app.get('/api/push/status', async (req) => {
    const user = requireUser(req);
    const devices = db
      .prepare('SELECT device_name, created_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at')
      .all(user.id) as { device_name: string | null; created_at: string }[];
    return { devices: devices.map((d) => ({ deviceName: d.device_name, createdAt: d.created_at })) };
  });

  app.post('/api/push/subscribe', async (req, reply) => {
    const user = requireUser(req);
    const input = subscribeInput.parse(req.body);
    if (!isPushEndpoint(input.endpoint)) throw new HttpError(400, 'Unbekannter Push-Dienst. Erlaubt sind Apple, Google, Mozilla und Microsoft.');
    // The same endpoint (device) belongs to exactly one user: re-subscribing moves it.
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(input.endpoint);
    db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, device_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      newId(), user.id, input.endpoint, input.keys.p256dh, input.keys.auth, input.deviceName ?? null, nowIso(),
    );
    return reply.status(201).send({ ok: true });
  });

  app.delete('/api/push/subscribe', async (req, reply) => {
    const user = requireUser(req);
    const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body);
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, user.id);
    return reply.status(204).send();
  });

  /** Sends a test notification to all devices of the caller. */
  app.post('/api/push/test', async (req) => {
    const user = requireUser(req);
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(user.id) as Record<string, any>[];
    if (subs.length === 0) throw new HttpError(409, 'Auf diesem Konto ist noch kein Gerät für Benachrichtigungen angemeldet.');
    const results = [];
    for (const s of subs) {
      const res = await sender.send(
        { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
        { title: '🔔 Reisebuch', body: 'Test: So sehen Erinnerungen aus.', url: '/', tag: 'test' },
      );
      if (res.gone) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      results.push({ deviceName: s.device_name as string | null, ok: res.ok, error: res.error ?? null });
    }
    return { results };
  });
}
