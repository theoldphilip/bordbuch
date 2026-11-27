import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { apnsConfigFromEnv, apnsPayload, createApnsSender, isDeviceToken, keyPem, providerToken, type ApnsSender } from '../src/apns.ts';
import type { PushMessage, PushResult, PushSender } from '../src/push.ts';
import { runReminderTick } from '../src/reminderRunner.ts';
import { toInstant } from '../src/timeline.ts';
import { setup } from './helpers.ts';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const token64 = 'ab'.repeat(32);

describe('APNs (pure)', () => {
  test('the key is accepted as PEM, as PEM with \\n from a .env line, and as base64 of the file', () => {
    assert.equal(keyPem(pem), pem);
    assert.equal(keyPem(pem.replace(/\n/g, '\\n')), pem);
    assert.equal(keyPem(Buffer.from(pem).toString('base64')), pem);
  });

  test('provider token: ES256 with kid and team, verifiable with the public key', () => {
    const jwt = providerToken({ key: pem, keyId: 'ABC123DEFG', teamId: 'TEAM123456' }, 1_800_000_000);
    const [h, c, s] = jwt.split('.') as [string, string, string];
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'ABC123DEFG' });
    assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url').toString()), { iss: 'TEAM123456', iat: 1_800_000_000 });
    const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    assert.ok(ok, 'signature must verify (raw r||s, not DER)');
  });

  test('configuration from the environment: all three values needed, topic and server have defaults', () => {
    assert.equal(apnsConfigFromEnv({ APNS_KEY: pem, APNS_KEY_ID: 'K' }), null);
    const c = apnsConfigFromEnv({ APNS_KEY: pem, APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T' })!;
    assert.deepEqual([c.topic, c.sandbox], ['de.theoldphilip.Reisebuch', false]);
    assert.equal(apnsConfigFromEnv({ APNS_KEY: pem, APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_SANDBOX: '1' })!.sandbox, true);
  });

  test('payload and device tokens', () => {
    assert.deepEqual(JSON.parse(apnsPayload({ title: 'T', body: 'B', url: '/trips/1', tag: 'x' })), {
      aps: { alert: { title: 'T', body: 'B' }, sound: 'default', 'thread-id': 'x' }, url: '/trips/1',
    });
    assert.ok(isDeviceToken(token64));
    assert.ok(!isDeviceToken('xyz'));
    assert.ok(!isDeviceToken('ab'.repeat(10)));
  });
});

describe('APNs sender over HTTP/2 (local stand-in for Apple)', () => {
  test('path, headers, JWT and body as Apple expects; 410 and BadDeviceToken mean gone', async () => {
    const seen: { headers: http2.IncomingHttpHeaders; body: string }[] = [];
    let answer = { status: 200, body: '' };
    const server = http2.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ headers: req.headers, body });
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(answer.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const sender = createApnsSender({ key: Buffer.from(pem).toString('base64'), keyId: 'KEY1234567', teamId: 'TEAM123456', topic: 'de.theoldphilip.Reisebuch', sandbox: false, host: `http://127.0.0.1:${port}` });
    try {
      const ok = await sender.send(token64, { title: '⚓ Alle an Bord in 1 h', body: 'Neapel', url: '/trips/t1', tag: 'r:1' });
      assert.deepEqual(ok, { ok: true });
      const h = seen[0]!.headers;
      assert.equal(h[':method'], 'POST');
      assert.equal(h[':path'], `/3/device/${token64}`);
      assert.equal(h['apns-topic'], 'de.theoldphilip.Reisebuch');
      assert.equal(h['apns-push-type'], 'alert');
      assert.equal(h['apns-priority'], '10');
      assert.equal(h['apns-collapse-id'], 'r:1');
      assert.ok(Number(h['apns-expiration']) > Date.now() / 1000);
      const [jh, jc, js] = String(h.authorization).replace(/^bearer /, '').split('.') as [string, string, string];
      assert.ok(crypto.verify('sha256', Buffer.from(`${jh}.${jc}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(js, 'base64url')));
      assert.equal(JSON.parse(seen[0]!.body).aps.alert.title, '⚓ Alle an Bord in 1 h');

      answer = { status: 410, body: JSON.stringify({ reason: 'Unregistered' }) };
      assert.deepEqual(await sender.send(token64, { title: 'x', body: 'y', url: '/' }), { ok: false, gone: true, error: 'HTTP 410 Unregistered' });
      answer = { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) };
      assert.equal((await sender.send(token64, { title: 'x', body: 'y', url: '/' })).gone, true);
      answer = { status: 429, body: JSON.stringify({ reason: 'TooManyRequests' }) };
      const busy = await sender.send(token64, { title: 'x', body: 'y', url: '/' });
      assert.deepEqual([busy.ok, busy.gone], [false, false], 'a temporary error keeps the device');
      assert.equal(seen.length, 4, 'one connection, four requests');
    } finally {
      sender.close?.();
      await new Promise((r) => server.close(r));
    }
  });

  test('a broken key is reported at start, not with the first reminder', () => {
    assert.throws(() => createApnsSender({ key: 'kein schlüssel', keyId: 'K', teamId: 'T', topic: 't', sandbox: false }));
  });
});

describe('APNs (API and delivery)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let db: DatabaseSync;
  let admin = '';
  let anna = '';
  let tripId = '';
  const appSent: { token: string; message: PushMessage }[] = [];
  const webSent: PushMessage[] = [];
  let appBehave: () => PushResult = () => ({ ok: true });
  const apns: ApnsSender = { async send(token, message) { appSent.push({ token, message }); return appBehave(); } };
  const web: PushSender = { publicKey: 'K', async send(_t, m) { webSent.push(m); return { ok: true }; } };

  before(async () => {
    ctx = await setup({ pushSender: web, apnsSender: apns });
    db = new DatabaseSync(path.join(ctx.dataDir, 'bordbuch.db'));
    admin = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
    await ctx.call('POST', '/api/users', admin, { username: 'anna', displayName: 'Anna', password: 'annapass1' });
    anna = (await ctx.call('POST', '/api/auth/login', undefined, { username: 'anna', password: 'annapass1' })).body.token;
    tripId = (await ctx.call('POST', '/api/trips', admin, { title: 'Mittelmeer' })).body.trip.id;
    await ctx.call('POST', `/api/trips/${tripId}/cruises`, admin, {
      shipName: 'MS Aurora',
      days: [{ date: '2027-05-11', kind: 'port', portName: 'Neapel', timezone: 'Europe/Rome', arrival: '08:00', departure: '18:00', allAboard: '17:30' }],
    });
  });
  after(async () => {
    db.close();
    await ctx.cleanup();
  });

  test('the app learns whether native push is set up', async () => {
    assert.deepEqual((await ctx.call('GET', '/api/push/apns', admin)).body, { enabled: true });
    assert.equal((await ctx.call('GET', '/api/push/apns')).status, 401);
  });

  test('registering validates the token; a token belongs to one user and moves on re-registration', async () => {
    assert.equal((await ctx.call('POST', '/api/push/apns', admin, { token: 'kein-token' })).status, 400);
    assert.equal((await ctx.call('POST', '/api/push/apns', admin, { token: token64.toUpperCase(), deviceName: 'iPhone-App' })).status, 201);
    assert.deepEqual((await ctx.call('GET', '/api/push/status', admin)).body.devices.map((d: any) => [d.deviceName, d.kind]), [['iPhone-App', 'app']]);
    await ctx.call('POST', '/api/push/apns', anna, { token: token64 });
    assert.deepEqual((await ctx.call('GET', '/api/push/status', admin)).body.devices, [], 'moved to the other account');
    assert.equal((await ctx.call('DELETE', '/api/push/apns', admin, { token: token64 })).status, 204);
    assert.equal((await ctx.call('GET', '/api/push/status', anna)).body.devices.length, 1, 'only the owner can remove it');
    await ctx.call('DELETE', '/api/push/apns', anna, { token: token64 });
    await ctx.call('POST', '/api/push/apns', admin, { token: token64, deviceName: 'iPhone-App' });
  });

  test('test notification goes to the app; a dead token is removed', async () => {
    const res = await ctx.call('POST', '/api/push/test', admin);
    assert.deepEqual(res.body.results, [{ deviceName: 'iPhone-App', kind: 'app', ok: true, error: null }]);
    assert.equal(appSent.at(-1)!.token, token64, 'stored lower case');
    appBehave = () => ({ ok: false, gone: true, error: 'HTTP 410 Unregistered' });
    await ctx.call('POST', '/api/push/test', admin);
    assert.deepEqual((await ctx.call('GET', '/api/push/status', admin)).body.devices, []);
    appBehave = () => ({ ok: true });
    await ctx.call('POST', '/api/push/apns', admin, { token: token64, deviceName: 'iPhone-App' });
    appSent.length = 0;
  });

  test('reminders reach a user who only has the iPhone app', async () => {
    await ctx.call('PATCH', '/api/me/settings', admin, { notifications: { enabled: true } });
    const now = toInstant('2027-05-11T17:30', 'Europe/Rome') - 60 * 60_000 + 30_000;
    const sent = await runReminderTick({ db, config: { defaultTz: 'Europe/Zurich' }, sender: web, apns }, now);
    assert.equal(sent, 1);
    assert.equal(appSent.length, 1);
    assert.equal(appSent[0]!.message.title, '⚓ Alle an Bord in 1 h');
    assert.equal(appSent[0]!.message.url, `/trips/${tripId}`);
    assert.equal(webSent.length, 0, 'no browser registered');
    assert.equal(await runReminderTick({ db, config: { defaultTz: 'Europe/Zurich' }, sender: web, apns: null }, now + 30_000), 0, 'without APNs nobody is due');
  });

  test('without an APNs key the app cannot register', async () => {
    const plain = await setup({ apnsSender: null });
    try {
      const t = (await plain.call('POST', '/api/setup', undefined, { username: 'anna', displayName: 'A', password: 'geheim123' })).body.token;
      assert.deepEqual((await plain.call('GET', '/api/push/apns', t)).body, { enabled: false });
      assert.equal((await plain.call('POST', '/api/push/apns', t, { token: token64 })).status, 409);
    } finally {
      await plain.cleanup();
    }
  });
});
