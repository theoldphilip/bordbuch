import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.ts';
import { isDeviceToken } from '../apns.ts';
import { requireUser } from '../auth.ts';
import { deliverToUser, hasDevices, isPushEndpoint } from '../push.ts';
import { HttpError, newId, nowIso } from '../util.ts';

const subscribeInput = z.object({
  endpoint: z.string().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
  deviceName: z.string().trim().max(80).nullish(),
});

const apnsInput = z.object({
  token: z.string().trim().refine(isDeviceToken, 'Ungültiges Geräte-Token'),
  deviceName: z.string().trim().max(80).nullish(),
});

export function registerPushRoutes(app: FastifyInstance, { db, sender, apns }: Ctx) {
  app.get('/api/push/key', async () => ({ publicKey: sender.publicKey }));

  app.get('/api/push/status', async (req) => {
    const user = requireUser(req);
    const web = db
      .prepare('SELECT device_name, created_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at')
      .all(user.id) as { device_name: string | null; created_at: string }[];
    const native = db
      .prepare('SELECT device_name, created_at FROM apns_devices WHERE user_id = ? ORDER BY created_at')
      .all(user.id) as { device_name: string | null; created_at: string }[];
    return {
      devices: [
        ...web.map((d) => ({ deviceName: d.device_name, createdAt: d.created_at, kind: 'web' as const })),
        ...native.map((d) => ({ deviceName: d.device_name, createdAt: d.created_at, kind: 'app' as const })),
      ],
    };
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

  // ----- native iPhone app (APNs) -----
  /** Whether the server can send to the iPhone app (an APNs key is configured). */
  app.get('/api/push/apns', async (req) => {
    requireUser(req);
    return { enabled: !!apns };
  });

  app.post('/api/push/apns', async (req, reply) => {
    const user = requireUser(req);
    if (!apns) throw new HttpError(409, 'Benachrichtigungen für die iPhone-App sind auf dem Server nicht eingerichtet.');
    const input = apnsInput.parse(req.body);
    const token = input.token.toLowerCase();
    // A device token belongs to exactly one user: registering again (other account on the same iPhone) moves it.
    db.prepare('DELETE FROM apns_devices WHERE token = ?').run(token);
    db.prepare('INSERT INTO apns_devices (id, user_id, token, device_name, created_at) VALUES (?, ?, ?, ?, ?)').run(
      newId(), user.id, token, input.deviceName ?? null, nowIso(),
    );
    return reply.status(201).send({ ok: true });
  });

  app.delete('/api/push/apns', async (req, reply) => {
    const user = requireUser(req);
    const { token } = z.object({ token: z.string().trim() }).parse(req.body);
    db.prepare('DELETE FROM apns_devices WHERE token = ? AND user_id = ?').run(token.toLowerCase(), user.id);
    return reply.status(204).send();
  });

  /** Sends a test notification to all devices of the caller (browsers and iPhone app). */
  app.post('/api/push/test', async (req) => {
    const user = requireUser(req);
    if (!hasDevices(db, user.id, !!apns)) throw new HttpError(409, 'Auf diesem Konto ist noch kein Gerät für Benachrichtigungen angemeldet.');
    const results = await deliverToUser(db, { sender, apns }, user.id, { title: '🔔 Reisebuch', body: 'Test: So sehen Erinnerungen aus.', url: '/', tag: 'test' });
    return { results };
  });
}
