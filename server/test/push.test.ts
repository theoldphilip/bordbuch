import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setup } from './helpers.ts';
import { buildReminders, dueReminders } from '../src/reminders.ts';
import { runReminderTick } from '../src/reminderRunner.ts';
import { isPushEndpoint, type PushResult, type PushSender } from '../src/push.ts';
import { toInstant } from '../src/timeline.ts';
import { userSettingsInput } from '../src/schemas.ts';
import type { Cruise, Item } from '../src/model.ts';

const settings = (over: { pace?: object; notifications?: object } = {}) =>
  userSettingsInput.parse({ pace: { enabled: false, ...over.pace }, notifications: { enabled: true, ...over.notifications } });

const day = (p: object): Cruise['days'][number] =>
  ({ id: 'd1', cruiseId: 'c', date: '2027-05-11', kind: 'port', portName: 'Neapel', country: null, timezone: 'Europe/Rome', arrival: '08:00', departure: '18:00', allAboard: '17:30', tender: false, notes: null, infos: [], ...p }) as never;
const cruise = (days: object[]): Cruise =>
  ({ id: 'c', tripId: 't', shipName: 'MS Test', cruiseLine: null, cabin: null, bookingRef: null, notes: null, infos: [], days: days.map(day) }) as never;
const item = (p: object): Item =>
  ({ id: 'i1', tripId: 't', type: 'excursion', title: 'Pompeji', startLocal: '2027-05-11T09:00', startTz: null, endLocal: null, endTz: null, location: null, confirmation: null, provider: null, cost: null, currency: null, notes: null, cruiseDayId: null, details: {}, infos: [], createdAt: '', updatedAt: '', ...p }) as never;

describe('reminders (pure)', () => {
  const base = { tripId: 't', defaultTz: 'Europe/Zurich' };

  test('boarding, excursion, flight and transfer get their lead times', () => {
    const r = buildReminders({
      ...base,
      settings: settings(),
      cruises: [cruise([{}])],
      items: [
        item({ details: { meetingPoint: 'Theater, Deck 5' } }),
        item({ id: 'f', type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T09:40', startTz: 'Europe/Zurich' }),
        item({ id: 'x', type: 'transfer', title: 'Taxi', startLocal: '2027-05-09T12:00', startTz: 'Europe/Rome' }),
        item({ id: 'n', type: 'note', title: 'Notiz', startLocal: '2027-05-09T12:00' }),
        item({ id: 'u', type: 'hotel', title: 'Hotel', startLocal: '2027-05-09T14:00' }),
        item({ id: 'nt', title: 'ohne Uhrzeit', startLocal: '2027-05-09' }),
      ],
    });
    const byKey = (prefix: string) => r.find((x) => x.key.startsWith(prefix))!;
    const board = byKey('board:');
    assert.equal(board.eventAt - board.fireAt, 60 * 60_000);
    assert.equal(board.title, '⚓ Alle an Bord in 1 h');
    assert.match(board.body, /Neapel: Alle an Bord um 17:30/);
    assert.equal(board.eventAt, toInstant('2027-05-11T17:30', 'Europe/Rome'));
    assert.equal(byKey('exc:').eventAt - byKey('exc:').fireAt, 45 * 60_000);
    assert.match(byKey('exc:').body, /Treffpunkt: Theater, Deck 5/);
    assert.equal(byKey('tr:f').fireAt, byKey('tr:f').eventAt - 180 * 60_000, 'flights: 3 h');
    assert.equal(byKey('tr:x').eventAt - byKey('tr:x').fireAt, 90 * 60_000);
    assert.equal(r.length, 5, 'no reminder for notes, hotels or entries without a time; the flight also gets its check-in reminder');
  });

  test('the personal time need lengthens the lead and says so', () => {
    const [board] = buildReminders({ ...base, settings: settings({ pace: { enabled: true, factor: 1.5, extraMinutes: 0 } }), cruises: [cruise([{}])], items: [] });
    assert.equal(board!.eventAt - board!.fireAt, 90 * 60_000);
    assert.equal(board!.title, '⚓ Alle an Bord in 1 h 30 min');
    assert.match(board!.body, /Vorlauf 1 h 30 min \(normal 1 h\)/);
  });

  test('switches turn rules off; sea days and disembarkation never remind', () => {
    const cruises = [cruise([{}, { id: 'd2', kind: 'sea', allAboard: null, departure: null }, { id: 'd3', kind: 'disembarkation', allAboard: null, departure: '09:30' }])];
    assert.equal(buildReminders({ ...base, settings: settings(), cruises, items: [] }).length, 1);
    assert.equal(buildReminders({ ...base, settings: settings({ notifications: { boarding: false } }), cruises, items: [] }).length, 0);
    assert.equal(buildReminders({ ...base, settings: settings({ notifications: { excursion: false, transport: false } }), cruises: [], items: [item({})] }).length, 0);
  });

  test('without all-aboard time the departure minus 30 minutes is used', () => {
    const [b] = buildReminders({ ...base, settings: settings({ notifications: { boardingLead: 30 } }), cruises: [cruise([{ allAboard: null, departure: '18:00' }])], items: [] });
    assert.equal(b!.eventAt, toInstant('2027-05-11T17:30', 'Europe/Rome'));
  });

  test('due window: from the fire time up to 5 minutes later, only while the event is ahead', () => {
    const [r] = buildReminders({ ...base, settings: settings(), cruises: [cruise([{}])], items: [] });
    assert.equal(dueReminders([r!], r!.fireAt - 1).length, 0, 'too early');
    assert.equal(dueReminders([r!], r!.fireAt).length, 1);
    assert.equal(dueReminders([r!], r!.fireAt + 4 * 60_000).length, 1);
    assert.equal(dueReminders([r!], r!.fireAt + 6 * 60_000).length, 0, 'missed by the server: skipped, not sent late');
    assert.equal(dueReminders([{ ...r!, eventAt: r!.fireAt + 1000 }], r!.fireAt + 2000).length, 0, 'event already over');
  });
});

describe('push endpoints', () => {
  test('only the known push services are accepted', () => {
    assert.ok(isPushEndpoint('https://web.push.apple.com/QWxs'));
    assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
    assert.ok(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'));
    assert.ok(!isPushEndpoint('http://web.push.apple.com/x'), 'plain http');
    assert.ok(!isPushEndpoint('https://172.16.10.1/admin'), 'internal address');
    assert.ok(!isPushEndpoint('https://web.push.apple.com.evil.example/x'), 'look-alike host');
    assert.ok(!isPushEndpoint('https://user:pw@web.push.apple.com/x'), 'credentials in the URL');
    assert.ok(!isPushEndpoint('nonsense'));
  });
});

describe('push API and reminder runner', () => {
  const sent: { endpoint: string; title: string; body: string; url: string }[] = [];
  let behave: (endpoint: string) => PushResult = () => ({ ok: true });
  const sender: PushSender = {
    publicKey: 'TEST-PUBLIC-KEY',
    async send(t, m) {
      sent.push({ endpoint: t.endpoint, title: m.title, body: m.body, url: m.url });
      return behave(t.endpoint);
    },
  };

  let ctx: Awaited<ReturnType<typeof setup>>;
  let db: DatabaseSync;
  let admin = '';
  let anna = '';
  let tripId = '';
  const phone = 'https://web.push.apple.com/phone';
  const keys = { p256dh: 'BPublicKeyOfTheBrowser0123456789', auth: 'AuthSecret1234' };

  before(async () => {
    ctx = await setup({ pushSender: sender });
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

  const boardingAt = toInstant('2027-05-11T17:30', 'Europe/Rome');
  const tick = (now: number) => runReminderTick({ db, config: { defaultTz: 'Europe/Zurich' }, sender }, now);

  test('public key is served; subscribing validates the endpoint', async () => {
    assert.deepEqual((await ctx.call('GET', '/api/push/key', admin)).body, { publicKey: 'TEST-PUBLIC-KEY' });
    assert.equal((await ctx.call('GET', '/api/push/key')).status, 401);
    assert.equal((await ctx.call('POST', '/api/push/subscribe', admin, { endpoint: 'https://172.16.10.1/x', keys })).status, 400);
    assert.equal((await ctx.call('POST', '/api/push/subscribe', admin, { endpoint: 'http://web.push.apple.com/x', keys })).status, 400);
    assert.equal((await ctx.call('POST', '/api/push/subscribe', admin, { endpoint: phone, keys: { p256dh: 'x', auth: 'y' } })).status, 400);
    assert.equal((await ctx.call('POST', '/api/push/subscribe', admin, { endpoint: phone, keys, deviceName: 'iPhone' })).status, 201);
    assert.deepEqual((await ctx.call('GET', '/api/push/status', admin)).body.devices.map((d: any) => d.deviceName), ['iPhone']);
    assert.deepEqual((await ctx.call('GET', '/api/push/status', anna)).body.devices, [], 'devices are per user');
  });

  test('test notification reaches the caller\'s devices only; dead devices are removed', async () => {
    assert.equal((await ctx.call('POST', '/api/push/test', anna)).status, 409, 'no device yet');
    const ok = await ctx.call('POST', '/api/push/test', admin);
    assert.deepEqual(ok.body.results, [{ deviceName: 'iPhone', kind: 'web', ok: true, error: null }]);
    assert.equal(sent.at(-1)!.endpoint, phone);
    behave = () => ({ ok: false, gone: true, error: 'HTTP 410' });
    const dead = await ctx.call('POST', '/api/push/test', admin);
    assert.equal(dead.body.results[0].ok, false);
    assert.deepEqual((await ctx.call('GET', '/api/push/status', admin)).body.devices, [], 'subscription dropped after 410');
    behave = () => ({ ok: true });
    await ctx.call('POST', '/api/push/subscribe', admin, { endpoint: phone, keys, deviceName: 'iPhone' });
    sent.length = 0;
  });

  test('nothing is sent while reminders are off', async () => {
    assert.equal(await tick(boardingAt - 60 * 60_000 + 1000), 0);
    assert.equal(sent.length, 0);
  });

  test('a due reminder is sent once, to the user\'s devices, with a link to the trip', async () => {
    await ctx.call('PATCH', '/api/me/settings', admin, { notifications: { enabled: true } });
    const now = boardingAt - 60 * 60_000 + 30_000; // 30 s after the fire time
    assert.equal(await tick(now), 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.title, '⚓ Alle an Bord in 1 h');
    assert.equal(sent[0]!.url, `/trips/${tripId}`);
    assert.equal(await tick(now + 30_000), 0, 'the next tick does not repeat it');
    assert.equal(sent.length, 1);
  });

  test('members without a device get nothing, and every member gets their own lead time', async () => {
    // Anna is no member of the trip and has no device. Make her one and give her a personal time need.
    await ctx.call('PUT', `/api/trips/${tripId}/members/${(await ctx.call('GET', '/api/me', anna)).body.id}`, admin, { role: 'viewer' });
    await ctx.call('POST', '/api/push/subscribe', anna, { endpoint: 'https://web.push.apple.com/annas', keys, deviceName: 'Annas iPhone' });
    await ctx.call('PATCH', '/api/me/settings', anna, { notifications: { enabled: true }, pace: { enabled: true, factor: 2, extraMinutes: 0 } });
    sent.length = 0;

    // Anna's lead is 2 h: she is reminded at the event minus 2 h, long before Philip's one hour.
    assert.equal(await tick(boardingAt - 120 * 60_000 + 20_000), 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.endpoint, 'https://web.push.apple.com/annas');
    assert.equal(sent[0]!.title, '⚓ Alle an Bord in 2 h');
    assert.match(sent[0]!.body, /Vorlauf 2 h \(normal 1 h\)/);
  });

  test('a reminder the server missed by more than 5 minutes is not sent late', async () => {
    await ctx.call('POST', `/api/trips/${tripId}/items`, admin, { type: 'excursion', title: 'Spät', startLocal: '2027-05-11T10:00', startTz: 'Europe/Rome' });
    const fire = toInstant('2027-05-11T10:00', 'Europe/Rome') - 45 * 60_000;
    sent.length = 0;
    assert.equal(await tick(fire + 10 * 60_000), 0);
    assert.equal(sent.length, 0);
    assert.equal(await tick(fire + 60_000), 1, 'within the grace period it is sent');
  });
});
