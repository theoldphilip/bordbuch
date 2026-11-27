/**
 * Apple Push Notification service (APNs) for the native iPhone app. Token-based authentication: a .p8 key from the Apple
 * Developer account signs a short JWT (ES256), the request goes over HTTP/2 to Apple. No extra package, only node:http2 and
 * node:crypto. Without a configured key there is no sender and the app simply gets no native push.
 */
import crypto from 'node:crypto';
import http2 from 'node:http2';
import type { PushMessage, PushResult } from './push.ts';

export interface ApnsConfig {
  /** Content of the .p8 file (PEM), or the same as base64 in one line. */
  key: string;
  keyId: string;
  teamId: string;
  /** Bundle ID of the app. */
  topic: string;
  /** true = development server (apps run from Xcode); ad-hoc and App Store builds use production. */
  sandbox: boolean;
  /** Only for tests: another server instead of Apple's. */
  host?: string;
}

export interface ApnsSender {
  send(deviceToken: string, message: PushMessage): Promise<PushResult>;
  close?(): void;
}

/** Reads the APNs settings from the environment; null when anything is missing (feature off). */
export function apnsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const key = env.APNS_KEY?.trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  if (!key || !keyId || !teamId) return null;
  return { key, keyId, teamId, topic: env.APNS_TOPIC?.trim() || 'de.theoldphilip.Reisebuch', sandbox: env.APNS_SANDBOX === '1' };
}

/** The .p8 key as PEM, whether it was given as PEM text or as base64 of the file. */
export function keyPem(key: string): string {
  if (key.includes('BEGIN PRIVATE KEY')) return key.replace(/\\n/g, '\n');
  return Buffer.from(key.replace(/\s+/g, ''), 'base64').toString('utf8');
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** Provider token for APNs: header {alg: ES256, kid}, claims {iss: team, iat}, signed with the .p8 key. */
export function providerToken(config: Pick<ApnsConfig, 'key' | 'keyId' | 'teamId'>, nowSec = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const claims = b64url(JSON.stringify({ iss: config.teamId, iat: nowSec }));
  const signature = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key: keyPem(config.key), dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64url(signature)}`;
}

/** The JSON Apple delivers to the app. `url` opens the trip, like the web push. */
export function apnsPayload(message: PushMessage): string {
  return JSON.stringify({
    aps: { alert: { title: message.title, body: message.body }, sound: 'default', ...(message.tag ? { 'thread-id': message.tag.slice(0, 64) } : {}) },
    url: message.url,
  });
}

/** Device tokens are hex strings (today 64 characters; Apple may make them longer). */
export const isDeviceToken = (t: string) => /^[0-9a-f]{64,200}$/i.test(t);

/** Answers from Apple that mean: this token is dead, forget the device. */
const GONE_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

export function createApnsSender(config: ApnsConfig): ApnsSender {
  // Check the key once at start, so a broken .env shows up in the log right away and not with the first reminder.
  keyPem(config.key);
  crypto.createPrivateKey(keyPem(config.key));
  const host = config.host ?? (config.sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
  let session: http2.ClientHttp2Session | null = null;
  let token = '';
  let tokenAt = 0;

  const connection = () => {
    if (!session || session.closed || session.destroyed) {
      session = http2.connect(host);
      session.on('error', () => {
        session?.destroy();
        session = null;
      });
      session.unref();
    }
    return session;
  };
  const bearer = () => {
    // Apple wants a new token at most every 20 minutes and accepts one for an hour.
    const now = Math.floor(Date.now() / 1000);
    if (!token || now - tokenAt > 40 * 60) {
      token = providerToken(config, now);
      tokenAt = now;
    }
    return token;
  };

  return {
    send(deviceToken, message) {
      return new Promise<PushResult>((resolve) => {
        let req: http2.ClientHttp2Stream;
        try {
          req = connection().request({
            ':method': 'POST',
            ':path': `/3/device/${deviceToken}`,
            authorization: `bearer ${bearer()}`,
            'apns-topic': config.topic,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            // A reminder that arrives much too late is worse than none (same 15 minutes as web push).
            'apns-expiration': String(Math.floor(Date.now() / 1000) + 900),
            ...(message.tag ? { 'apns-collapse-id': message.tag.slice(0, 64) } : {}),
          });
        } catch (err) {
          resolve({ ok: false, error: (err as Error).message });
          return;
        }
        let status = 0;
        let body = '';
        req.setTimeout(10_000, () => {
          req.close();
          resolve({ ok: false, error: 'Zeitüberschreitung bei Apple' });
        });
        req.on('response', (headers) => (status = Number(headers[':status'])));
        req.on('data', (chunk) => (body += chunk));
        req.on('error', (err) => resolve({ ok: false, error: err.message }));
        req.on('end', () => {
          if (status === 200) return resolve({ ok: true });
          let reason = '';
          try {
            reason = JSON.parse(body).reason ?? '';
          } catch {
            /* no JSON */
          }
          resolve({ ok: false, gone: status === 410 || GONE_REASONS.has(reason), error: `HTTP ${status}${reason ? ` ${reason}` : ''}` });
        });
        req.end(apnsPayload(message));
      });
    },
    close() {
      session?.close();
    },
  };
}
