import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setup } from './helpers.ts';
import { runLiveActivityTick, tripSteps, lockState } from '../src/liveActivity.ts';
import { toInstant } from '../src/timeline.ts';
import type { ApnsSender } from '../src/apns.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const dep = toInstant('2027-05-09T09:40', 'Europe/Zurich');
const arr = toInstant('2027-05-09T11:15', 'Europe/Rome');

describe('lock screen (Live Activity)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let db: DatabaseSync;
  let admin = '';
  let tripId = '';
  let flightId = '';
  const sent: { token: string; payload: any; priority: number }[] = [];
  const apns: ApnsSender = {
    async send() { return { ok: true }; },
    async sendLiveActivity(token, payload, priority) { sent.push({ token, payload, priority }); return { ok: true }; },
  };
  const start = 'ab'.repeat(40);
  const upd = 'cd'.repeat(40);
  const tick = (now: number) => runLiveActivityTick({ db, apns, defaultTz: 'Europe/Zurich' }, now);

  before(async () => {
    ctx = await setup({ apnsSender: apns });
    db = new DatabaseSync(path.join(ctx.dataDir, 'bordbuch.db'));
    admin = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
    tripId = (await ctx.call('POST', '/api/trips', admin, { title: 'Rom', kind: 'city' })).body.trip.id;
    flightId = (await ctx.call('POST', `/api/trips/${tripId}/items`, admin, { type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T09:40', startTz: 'Europe/Zurich', endLocal: '2027-05-09T11:15', endTz: 'Europe/Rome', details: { flightNumber: 'LX 1726', terminal: '2', gate: 'B12' } })).body.id;
    await ctx.call('POST', `/api/trips/${tripId}/items`, admin, { type: 'hotel', title: 'Hotel Artemide', startLocal: '2027-05-09T14:00', startTz: 'Europe/Rome', endLocal: '2027-05-11T10:00', endTz: 'Europe/Rome' });
    await ctx.call('PATCH', '/api/me/settings', admin, { notifications: { enabled: true } });
  });
  after(async () => {
    db.close();
    await ctx.cleanup();
  });

  test('content: next step with countdown, place and what comes after; under way the countdown runs to the arrival', () => {
    const steps = tripSteps(db as any, tripId, 'Europe/Zurich');
    const before = lockState(steps, dep - 2 * HOUR)!;
    assert.deepEqual(before, { icon: '✈️', title: 'Zürich → Rom', time: '09:40', targetLabel: 'Abflug', target: dep / 1000, place: 'Terminal 2 · Gate B12', live: null, alert: false, next: '🏨 Hotel Artemide · 14:00' });
    const flying = lockState(steps, dep + 30 * MIN)!;
    assert.deepEqual([flying.targetLabel, flying.target, flying.place], ['Ankunft', arr / 1000, null]);
    const hotel = lockState(steps, arr + 10 * MIN)!;
    assert.deepEqual([hotel.title, hotel.targetLabel, hotel.next], ['Hotel Artemide', 'Check-in', null], 'Check-out liegt über 12 h später');
    assert.equal(lockState(steps, dep - 13 * HOUR), null, 'nichts in den nächsten 12 h');
  });

  test('a delay from the live flight status moves the countdown and marks it', () => {
    db.prepare('INSERT INTO flight_status (item_id, data, checked_at, next_check_at) VALUES (?, ?, ?, 0)').run(flightId, JSON.stringify({ checkedAt: 'x', cancelled: false, delayMinutes: 45, depRevised: '2027-05-09T10:25', arrRevised: null }), 'x');
    const s = lockState(tripSteps(db as any, tripId, 'Europe/Zurich'), dep - HOUR)!;
    assert.equal(s.target, toInstant('2027-05-09T10:25', 'Europe/Zurich') / 1000);
    assert.deepEqual([s.live, s.alert], ['+45 min, neu 10:25', true]);
    db.prepare('DELETE FROM flight_status WHERE item_id = ?').run(flightId);
  });

  test('tokens: checked, update tokens need a trip the user belongs to', async () => {
    assert.equal((await ctx.call('POST', '/api/live-activity/tokens', admin, { token: 'kein token', kind: 'start' })).status, 400);
    assert.equal((await ctx.call('POST', '/api/live-activity/tokens', admin, { token: upd, kind: 'update' })).status, 400);
    assert.equal((await ctx.call('POST', '/api/live-activity/tokens', admin, { token: start.toUpperCase(), kind: 'start' })).status, 201);
    assert.equal((db.prepare('SELECT token FROM live_activities').get() as any).token, start, 'klein gespeichert');
  });

  test('push-to-start 3 h before the first step, once; nothing earlier', async () => {
    assert.equal(await tick(dep - 4 * HOUR), 0);
    await tick(dep - 2 * HOUR);
    assert.equal(sent.length, 1);
    const aps = sent[0]!.payload.aps;
    assert.equal(sent[0]!.token, start);
    assert.equal(aps.event, 'start');
    assert.equal(aps['attributes-type'], 'ReisebuchActivityAttributes');
    assert.deepEqual(aps.attributes, { tripId, tripTitle: 'Rom' });
    assert.equal(aps['content-state'].title, 'Zürich → Rom');
    assert.equal(aps.alert.title, '✈️ Rom');
    await tick(dep - 2 * HOUR + MIN);
    assert.equal(sent.length, 1, 'kein zweiter Start am selben Tag');
  });

  test('updates only on change, priority 10 for a new gate; at the end the activity is closed', async () => {
    sent.length = 0;
    assert.equal((await ctx.call('POST', '/api/live-activity/tokens', admin, { token: upd, kind: 'update', tripId })).status, 201);
    await tick(dep - 90 * MIN);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.payload.aps.event, 'update');
    await tick(dep - 89 * MIN);
    assert.equal(sent.length, 1, 'gleicher Inhalt: nichts senden');
    await ctx.call('PATCH', `/api/items/${flightId}`, admin, { details: { flightNumber: 'LX 1726', terminal: '2', gate: 'B14' } });
    await tick(dep - 88 * MIN);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]!.payload.aps['content-state'].place, 'Terminal 2 · Gate B14');
    assert.equal(sent[1]!.priority, 10);
    // Long after the hotel check-in there is nothing within 12 h: end.
    await tick(toInstant('2027-05-09T23:00', 'Europe/Rome'));
    assert.equal(sent.at(-1)!.payload.aps.event, 'end');
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM live_activities WHERE kind = 'update'").get() as any).n, 0);
  });

  test('switched off: no start', async () => {
    sent.length = 0;
    await ctx.call('PATCH', '/api/me/settings', admin, { notifications: { lockScreen: false } });
    db.prepare('DELETE FROM push_log').run();
    await tick(dep - 2 * HOUR);
    assert.equal(sent.length, 0);
  });

  test('the app can ask for the current content', async () => {
    const r = await ctx.call('GET', `/api/trips/${tripId}/live-activity`, admin);
    assert.equal(r.status, 200);
    assert.ok('state' in r.body);
  });
});
