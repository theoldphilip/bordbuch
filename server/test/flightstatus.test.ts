import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setup } from './helpers.ts';
import { buildReminders, checkinHours } from '../src/reminders.ts';
import { userSettingsInput } from '../src/schemas.ts';
import { normalizeFlightNumber, parseFlight, type FlightDataClient, type FlightLive } from '../src/flightdata.ts';
import { nextInterval, runFlightTick, statusNotice, watchWindow } from '../src/flightStatus.ts';
import { toInstant } from '../src/timeline.ts';
import type { ApnsSender } from '../src/apns.ts';
import type { PushMessage, PushSender } from '../src/push.ts';
import type { Item } from '../src/model.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const flight = (details: Record<string, unknown>, extra: Partial<Item> = {}): Item =>
  ({ id: 'f', tripId: 't', type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T09:40', startTz: 'Europe/Zurich', endLocal: '2027-05-09T11:15', endTz: 'Europe/Rome', location: null, confirmation: 'GEHEIM1', provider: 'SWISS', cost: null, currency: null, notes: null, cruiseDayId: null, details, infos: [], createdAt: '', updatedAt: '', ...extra }) as Item;
const settings = (n: object = {}) => userSettingsInput.parse({ pace: { enabled: false }, notifications: { enabled: true, ...n } });
const dep = toInstant('2027-05-09T09:40', 'Europe/Zurich');

describe('online check-in reminder', () => {
  test('24 h before departure by default, with flight number and airline, no booking number', () => {
    const r = buildReminders({ tripId: 't', cruises: [], items: [flight({ flightNumber: 'LX 1726', airline: 'SWISS' })], defaultTz: 'Europe/Zurich', settings: settings() });
    const ci = r.find((x) => x.key.startsWith('ci:'))!;
    assert.equal(ci.eventAt - ci.fireAt, 24 * HOUR);
    assert.equal(ci.title, '🛂 Online-Check-in LX 1726');
    assert.match(ci.body, /bei SWISS ist jetzt in der Regel offen \(24 h vor Abflug\)\. Abflug am 09\.05\. um 09:40/);
    assert.ok(!ci.body.includes('GEHEIM1'), 'keine Buchungsnummer in der Mitteilung');
  });

  test('a flight can say when check-in opens; nonsense falls back to 24 h; the switch turns it off', () => {
    assert.equal(checkinHours('30'), 30);
    assert.equal(checkinHours('48 h'), 48);
    assert.equal(checkinHours(23), 23);
    assert.equal(checkinHours('bald'), 24);
    assert.equal(checkinHours(500), 24);
    const r = buildReminders({ tripId: 't', cruises: [], items: [flight({ checkinHours: '30' })], defaultTz: 'Europe/Zurich', settings: settings() });
    const ci = r.find((x) => x.key.startsWith('ci:'))!;
    assert.equal(ci.eventAt - ci.fireAt, 30 * HOUR);
    assert.equal(buildReminders({ tripId: 't', cruises: [], items: [flight({})], defaultTz: 'Europe/Zurich', settings: settings({ checkin: false }) }).filter((x) => x.key.startsWith('ci:')).length, 0);
    assert.equal(buildReminders({ tripId: 't', cruises: [], items: [flight({}, { type: 'train' })], defaultTz: 'Europe/Zurich', settings: settings() }).filter((x) => x.key.startsWith('ci:')).length, 0, 'nur Flüge');
  });
});

describe('flight data (AeroDataBox answers)', () => {
  test('flight numbers are normalised', () => {
    assert.equal(normalizeFlightNumber('LX 1726'), 'LX1726');
    assert.equal(normalizeFlightNumber('u2 1234'), 'U21234');
    assert.equal(normalizeFlightNumber('Zürich'), null);
  });

  test('nested times, places and delay; the leg from the own airport is chosen', () => {
    const body = [
      { status: 'Expected', departure: { airport: { iata: 'GVA' }, scheduledTime: { local: '2027-05-09 07:00+02:00', utc: '2027-05-09 05:00Z' } }, arrival: { airport: { iata: 'ZRH' } } },
      {
        status: 'Delayed',
        departure: { airport: { iata: 'ZRH' }, scheduledTime: { local: '2027-05-09 09:40+02:00', utc: '2027-05-09 07:40Z' }, revisedTime: { local: '2027-05-09 10:25+02:00', utc: '2027-05-09 08:25Z' }, terminal: '2', checkInDesk: '31-40', gate: 'B12' },
        arrival: { airport: { iata: 'FCO' }, scheduledTime: { local: '2027-05-09 11:15+02:00', utc: '2027-05-09 09:15Z' }, baggageBelt: 5, terminal: '1' },
      },
    ];
    const f = parseFlight(body, 'zrh')!;
    assert.deepEqual(
      [f.status, f.depScheduled, f.depRevised, f.delayMinutes, f.terminal, f.checkinDesk, f.gate, f.baggageBelt, f.arrTerminal, f.depAirport, f.cancelled],
      ['Delayed', '2027-05-09T09:40', '2027-05-09T10:25', 45, '2', '31-40', 'B12', '5', '1', 'ZRH', false],
    );
  });

  test('flat time fields (older answers) and cancellations', () => {
    const f = parseFlight([{ status: 'Canceled', departure: { scheduledTimeLocal: '2027-05-09 09:40+02:00', scheduledTimeUtc: '2027-05-09 07:40Z' }, arrival: {} }], null)!;
    assert.equal(f.depScheduled, '2027-05-09T09:40');
    assert.equal(f.cancelled, true);
    assert.equal(f.delayMinutes, null);
    assert.equal(parseFlight([], null), null);
  });
});

describe('when to ask and what to tell', () => {
  test('rarely far ahead, often close to departure, then for the belt', () => {
    assert.equal(nextInterval(dep, dep - 20 * HOUR, null), 60 * MIN);
    assert.equal(nextInterval(dep, dep - 3 * HOUR, null), 15 * MIN);
    assert.equal(nextInterval(dep, dep - 30 * MIN, null), 5 * MIN);
    assert.equal(nextInterval(dep, dep + 2 * HOUR, null), 20 * MIN);
    const w = watchWindow(flight({}), 'Europe/Zurich');
    assert.equal(w.from, dep - 24 * HOUR);
    assert.equal(w.until, toInstant('2027-05-09T11:15', 'Europe/Rome') + HOUR);
  });

  const live = (p: Partial<FlightLive>): FlightLive => ({ status: 'Expected', cancelled: false, diverted: false, depScheduled: '2027-05-09T09:40', depRevised: '2027-05-09T09:40', arrScheduled: null, arrRevised: null, delayMinutes: 0, terminal: null, checkinDesk: null, gate: null, baggageBelt: null, arrTerminal: null, arrGate: null, depAirport: null, arrAirport: null, ...p });
  const f = flight({ flightNumber: 'LX 1726' });

  test('delays of 15 min or more, changes of 15 min, back on time, cancellation once', () => {
    assert.equal(statusNotice(f, live({ delayMinutes: 10 }), null), null);
    const d = statusNotice(f, live({ delayMinutes: 45, depRevised: '2027-05-09T10:25', gate: 'B12' }), null)!;
    assert.equal(d.title, '⏱️ LX1726 verspätet: +45 min');
    assert.equal(d.body, 'Zürich → Rom: Abflug neu 10:25 statt 09:40 (Ortszeit). Gate B12.');
    const known = { notifiedDelay: 45, notifiedCancelled: false, notifiedDiverted: false };
    assert.equal(statusNotice(f, live({ delayMinutes: 50 }), known), null, '5 min mehr: keine neue Mitteilung');
    assert.match(statusNotice(f, live({ delayMinutes: 65 }), known)!.title, /\+65 min/);
    assert.match(statusNotice(f, live({ delayMinutes: 0 }), known)!.title, /wieder planmäßig/);
    assert.match(statusNotice(f, live({ cancelled: true, status: 'Canceled' }), known)!.title, /annulliert/);
    assert.equal(statusNotice(f, live({ cancelled: true }), { ...known, notifiedCancelled: true }), null);
  });
});

describe('live flight status (runner and API)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let db: DatabaseSync;
  let admin = '';
  let anna = '';
  let tripId = '';
  let itemId = '';
  const sent: { token: string; message: PushMessage }[] = [];
  const apns: ApnsSender = { async send(token, message) { sent.push({ token, message }); return { ok: true }; } };
  const web: PushSender = { publicKey: 'K', async send() { return { ok: true }; } };
  let answer: Partial<FlightLive> | null = {};
  const asked: string[] = [];
  const client: FlightDataClient = {
    async status(fn, date, from) {
      asked.push(`${fn} ${date} ${from}`);
      return answer === null ? null : { status: 'Expected', cancelled: false, diverted: false, depScheduled: '2027-05-09T09:40', depRevised: '2027-05-09T09:40', arrScheduled: null, arrRevised: null, delayMinutes: 0, terminal: null, checkinDesk: null, gate: null, baggageBelt: null, arrTerminal: null, arrGate: null, depAirport: 'ZRH', arrAirport: 'FCO', ...answer };
    },
    async check() {},
  };
  const tick = (now: number, limit = 500) => runFlightTick({ db, defaultTz: 'Europe/Zurich', client, senders: { sender: web, apns }, monthlyLimit: limit }, now);

  before(async () => {
    ctx = await setup({ pushSender: web, apnsSender: apns, flightFactory: (c) => ({ ...client, async check() { if (c.key.includes('falsch')) throw new Error('Der Schlüssel für den Flugdaten-Dienst wurde abgelehnt.'); } }) });
    db = new DatabaseSync(path.join(ctx.dataDir, 'bordbuch.db'));
    admin = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
    const annaId = (await ctx.call('POST', '/api/users', admin, { username: 'anna', displayName: 'Anna', password: 'annapass1' })).body.id;
    anna = (await ctx.call('POST', '/api/auth/login', undefined, { username: 'anna', password: 'annapass1' })).body.token;
    tripId = (await ctx.call('POST', '/api/trips', admin, { title: 'Rom' })).body.trip.id;
    await ctx.call('PUT', `/api/trips/${tripId}/members/${annaId}`, admin, { role: 'viewer' });
    const it = await ctx.call('POST', `/api/trips/${tripId}/items`, admin, { type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T09:40', startTz: 'Europe/Zurich', endLocal: '2027-05-09T11:15', endTz: 'Europe/Rome', details: { flightNumber: 'LX 1726', from: 'ZRH', gate: 'A1' } });
    itemId = it.body.id;
    for (const [t, tok] of [[admin, 'aa'], [anna, 'bb']] as const) {
      await ctx.call('PATCH', '/api/me/settings', t, { notifications: { enabled: true } });
      await ctx.call('POST', '/api/push/apns', t, { token: tok.repeat(32), deviceName: 'iPhone-App' });
    }
  });
  after(async () => {
    db.close();
    await ctx.cleanup();
  });

  test('nothing is asked before the 24 h window', async () => {
    assert.equal(await tick(dep - 25 * HOUR), 0);
    assert.deepEqual(asked, []);
  });

  test('a new gate goes into the entry and to every member, "laut Live-Flugstatus"; next question in an hour', async () => {
    answer = { gate: 'B12', terminal: '2' };
    assert.equal(await tick(dep - 23 * HOUR), 1);
    assert.deepEqual(asked, ['LX1726 2027-05-09 ZRH']);
    const item = (await ctx.call('GET', `/api/trips/${tripId}`, admin)).body.items.find((i: any) => i.id === itemId);
    assert.equal(item.details.gate, 'B12');
    assert.equal(item.details.terminal, '2');
    assert.equal(item.details.flightNumber, 'LX 1726', 'übrige Angaben bleiben');
    const gateMsgs = sent.filter((s) => s.message.tag === `info:${itemId}`);
    assert.equal(gateMsgs.length, 2, 'beide Mitglieder');
    assert.match(gateMsgs[0]!.message.body, /Gate B12 \(vorher A1\).*Laut Live-Flugstatus\./);
    assert.equal(await tick(dep - 23 * HOUR + 30 * MIN), 0, 'erst nach einer Stunde wieder');
    assert.equal(await tick(dep - 22 * HOUR + MIN), 1);
  });

  test('a delay is announced once; the API shows the live data without internal fields', async () => {
    sent.length = 0;
    answer = { gate: 'B12', terminal: '2', delayMinutes: 45, depRevised: '2027-05-09T10:25', status: 'Delayed' };
    await tick(dep - 30 * MIN);
    const delay = sent.filter((s) => s.message.tag === `live:${itemId}`);
    assert.equal(delay.length, 2);
    assert.equal(delay[0]!.message.title, '⏱️ LX1726 verspätet: +45 min');
    await tick(dep - 20 * MIN);
    assert.equal(sent.filter((s) => s.message.tag === `live:${itemId}`).length, 2, 'gleiche Verspätung: keine neue Mitteilung');
    const r = await ctx.call('GET', `/api/trips/${tripId}/flight-status`, anna);
    assert.equal(r.status, 200);
    assert.equal(r.body.enabled, false, 'in diesem Test ohne Schlüssel eingerichtet');
    const s = r.body.flights[itemId];
    assert.equal(s.delayMinutes, 45);
    assert.equal(s.gate, 'B12');
    assert.equal(s.notifiedDelay, undefined);
  });

  test('members who switched live status off get no delay message', async () => {
    sent.length = 0;
    await ctx.call('PATCH', '/api/me/settings', anna, { notifications: { flightStatus: false } });
    answer = { delayMinutes: 90, depRevised: '2027-05-09T11:10' };
    await tick(dep - 10 * MIN);
    assert.deepEqual(sent.filter((s) => s.message.tag === `live:${itemId}`).map((s) => s.token), ['aa'.repeat(32)]);
  });

  test('the monthly limit stops all questions', async () => {
    asked.length = 0;
    assert.equal(await tick(dep + 3 * HOUR, 1), 0);
    assert.deepEqual(asked, []);
  });

  test('settings: admin only, a bad key is not saved, a good one only as …abcd', async () => {
    assert.equal((await ctx.call('GET', '/api/flight-status/config', anna)).status, 403);
    const bad = await ctx.call('PUT', '/api/flight-status/config', admin, { key: 'falsch-0000000' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /abgelehnt/);
    const ok = await ctx.call('PUT', '/api/flight-status/config', admin, { key: 'rapid-key-1234abcd', monthlyLimit: 300 });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.configured, ok.body.keyHint, ok.body.monthlyLimit, ok.body.source], [true, '…abcd', 300, 'settings']);
    assert.ok(!JSON.stringify(ok.body).includes('rapid-key-1234abcd'));
    assert.equal((await ctx.call('GET', `/api/trips/${tripId}/flight-status`, admin)).body.enabled, true);
  });
});
