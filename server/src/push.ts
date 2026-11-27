/**
 * Web Push: VAPID keys, the sender, and the allow-list for subscription endpoints.
 * The sender is an interface so tests (and installations without push) never talk to a push service.
 */
import { generateVAPIDKeys, sendNotification } from 'web-push';
import type { ApnsSender } from './apns.ts';
import type { DB } from './db.ts';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  tag?: string;
}
export interface PushResult {
  ok: boolean;
  /** The push service says the subscription no longer exists (app removed, permission revoked). */
  gone?: boolean;
  error?: string;
}
export interface PushSender {
  /** Public VAPID key the browser needs to subscribe. */
  readonly publicKey: string;
  send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Keys are created once and kept in the database, so subscriptions survive restarts and updates. */
export function loadVapid(db: DB, subject: string): Vapid {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'vapid'").get() as { value: string } | undefined;
  if (row) {
    const stored = JSON.parse(row.value) as { publicKey: string; privateKey: string };
    return { ...stored, subject };
  }
  const keys = generateVAPIDKeys();
  db.prepare("INSERT INTO meta (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  return { ...keys, subject };
}

export function createWebPushSender(vapid: Vapid): PushSender {
  return {
    publicKey: vapid.publicKey,
    async send(target, message) {
      try {
        await sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(message), {
          vapidDetails: vapid,
          // A reminder that arrives much too late is worse than none.
          TTL: 900,
          urgency: 'high',
        });
        return { ok: true };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return { ok: false, gone: status === 404 || status === 410, error: status ? `HTTP ${status}` : (err as Error).message };
      }
    },
  };
}

export interface Senders {
  sender: PushSender;
  /** Native iPhone app (APNs); null when no APNs key is configured. */
  apns: ApnsSender | null;
}

export interface DeliveryResult {
  deviceName: string | null;
  kind: 'web' | 'app';
  ok: boolean;
  error: string | null;
}

/** Does this user have any device that can receive a notification (web push or the iPhone app)? */
export function hasDevices(db: DB, userId: string, apnsEnabled: boolean): boolean {
  if (db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ?').get(userId)) return true;
  return apnsEnabled && !!db.prepare('SELECT 1 FROM apns_devices WHERE user_id = ?').get(userId);
}

/** Users that have at least one device, for the reminder runner. */
export function usersWithDevices(db: DB, apnsEnabled: boolean): string[] {
  const sql = apnsEnabled
    ? 'SELECT user_id FROM push_subscriptions UNION SELECT user_id FROM apns_devices'
    : 'SELECT DISTINCT user_id FROM push_subscriptions';
  return (db.prepare(sql).all() as { user_id: string }[]).map((r) => r.user_id);
}

/**
 * Sends one message to every device of a user: browsers via web push, iPhones with the app via APNs. Devices the push
 * service reports as gone are removed. One failing device never stops the others.
 */
export async function deliverToUser(db: DB, { sender, apns }: Senders, userId: string, message: PushMessage): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId) as Record<string, any>[];
  for (const s of subs) {
    const res = await sender.send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, message);
    if (res.gone) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
    results.push({ deviceName: s.device_name ?? null, kind: 'web', ok: res.ok, error: res.error ?? null });
  }
  if (apns) {
    const devices = db.prepare('SELECT * FROM apns_devices WHERE user_id = ?').all(userId) as Record<string, any>[];
    for (const d of devices) {
      const res = await apns.send(d.token, message);
      if (res.gone) db.prepare('DELETE FROM apns_devices WHERE id = ?').run(d.id);
      results.push({ deviceName: d.device_name ?? null, kind: 'app', ok: res.ok, error: res.error ?? null });
    }
  }
  return results;
}

/**
 * The server posts to the subscription endpoint, so only the known push services are accepted.
 * Otherwise a user could make the server send requests to arbitrary addresses.
 */
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
export function isPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}
