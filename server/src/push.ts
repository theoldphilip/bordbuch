/**
 * Web Push: VAPID keys, the sender, and the allow-list for subscription endpoints.
 * The sender is an interface so tests (and installations without push) never talk to a push service.
 */
import { generateVAPIDKeys, sendNotification } from 'web-push';
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
