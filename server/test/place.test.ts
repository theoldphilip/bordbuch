import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';
import { describeChanges, placeChanges, placeInfo } from '../src/place.ts';
import { buildReminders } from '../src/reminders.ts';
import { userSettingsInput } from '../src/schemas.ts';
import type { PushSender } from '../src/push.ts';
import type { Item } from '../src/model.ts';

const flight = (details: Record<string, unknown>, extra: Partial<Item> = {}): Item =>
  ({ id: 'f', tripId: 't', type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T09:40', startTz: 'Europe/Zurich', endLocal: '2027-05-09T11:15', endTz: 'Europe/Rome', location: null, confirmation: null, provider: null, cost: null, currency: null, notes: null, cruiseDayId: null, details, infos: [], createdAt: '', updatedAt: '', ...extra }) as Item;

describe('terminal, gate, desk, belt', () => {
  test('known fields only, departure and arrival separated; trains have a platform', () => {
    const f = flight({ terminal: '2', checkinDesk: '31–40', gate: 'B12', baggageBelt: '4', seat: '12A' });
    assert.deepEqual(placeInfo(f), ['Terminal 2', 'Schalter 31–40', 'Gate B12', 'Kofferband 4']);
    assert.deepEqual(placeInfo(f, 'departure'), ['Terminal 2', 'Schalter 31–40', 'Gate B12']);
    assert.deepEqual(placeInfo(f, 'arrival'), ['Kofferband 4']);
    assert.deepEqual(placeInfo(flight({ gate: '  ' })), [], 'blank is unknown');
    assert.deepEqual(placeInfo({ type: 'train', details: { platform: '7' } }), ['Gleis 7']);
    assert.deepEqual(placeInfo({ type: 'hotel', details: { gate: 'x' } }), [], 'other types have none');
  });

  test('changes: new or different values are announced, removed ones are not', () => {
    const ch = placeChanges(flight({ gate: 'B14', baggageBelt: '3' }), flight({ gate: 'B12', baggageBelt: '3', checkinDesk: '31–40' }));
    assert.equal(describeChanges(ch), 'Schalter 31–40 (neu), Gate B12 (vorher B14)');
    assert.deepEqual(placeChanges(flight({ gate: 'B14' }), flight({})), []);
    assert.deepEqual(placeChanges(flight({ gate: 'B14' }), flight({ gate: 'B14' })), []);
  });

  test('the departure reminder names what is known, not the baggage belt', () => {
    const settings = userSettingsInput.parse({ pace: { enabled: false }, notifications: { enabled: true } });
    const r = buildReminders({ tripId: 't', cruises: [], items: [flight({ terminal: '2', gate: 'B12', baggageBelt: '4' })], defaultTz: 'Europe/Zurich', settings });
    assert.match(r[0]!.body, /Abflug um 09:40 \(Ortszeit\)\. Terminal 2, Gate B12\./);
    assert.ok(!r[0]!.body.includes('Kofferband'));
    const plain = buildReminders({ tripId: 't', cruises: [], items: [flight({})], defaultTz: 'Europe/Zurich', settings });
    assert.ok(!/\. \./.test(plain[0]!.body), 'no empty place text');
  });
});

describe('push when somebody changes gate, desk or belt', () => {
  const sent: { endpoint: string; title: string; body: string }[] = [];
  const sender: PushSender = {
    publicKey: 'TEST-PUBLIC-KEY',
    async send(t, m) {
      sent.push({ endpoint: t.endpoint, title: m.title, body: m.body });
      return { ok: true, gone: false };
    },
  };
  let ctx: Awaited<ReturnType<typeof setup>>;
  let philip = '';
  let anna = '';
  let tripId = '';
  let itemId = '';
  const keys = { p256dh: 'BPublicKeyOfTheBrowser0123456789', auth: 'AuthSecret1234' };
  const local = (hours: number) => new Date(Date.now() + hours * 3_600_000).toLocaleString('sv-SE', { timeZone: 'Europe/Zurich' }).replace(' ', 'T').slice(0, 16);
  const settle = () => new Promise((r) => setTimeout(r, 80));

  before(async () => {
    ctx = await setup({ pushSender: sender });
    philip = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
    const a = await ctx.call('POST', '/api/users', philip, { username: 'anna', displayName: 'Anna', password: 'annapass1' });
    anna = (await ctx.call('POST', '/api/auth/login', undefined, { username: 'anna', password: 'annapass1' })).body.token;
    tripId = (await ctx.call('POST', '/api/trips', philip, { title: 'Flug' })).body.trip.id;
    await ctx.call('PUT', `/api/trips/${tripId}/members/${a.body.id}`, philip, { role: 'editor' });
    await ctx.call('POST', '/api/push/subscribe', anna, { endpoint: 'https://web.push.apple.com/anna', keys, deviceName: 'iPhone' });
    await ctx.call('POST', '/api/push/subscribe', philip, { endpoint: 'https://web.push.apple.com/philip', keys, deviceName: 'iPhone' });
    for (const t of [anna, philip]) await ctx.call('PATCH', '/api/me/settings', t, { notifications: { enabled: true } });
    itemId = (await ctx.call('POST', `/api/trips/${tripId}/items`, philip, { type: 'flight', title: 'Zürich → Rom', startLocal: local(5), startTz: 'Europe/Zurich', endLocal: local(7), endTz: 'Europe/Zurich' })).body.id;
  });
  after(async () => ctx.cleanup());

  test('the others are told, the editor is not; a second change names the old value', async () => {
    await ctx.call('PATCH', `/api/items/${itemId}`, philip, { details: { gate: 'B14', checkinDesk: '31–40' } });
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.endpoint, 'https://web.push.apple.com/anna');
    assert.match(sent[0]!.title, /✈️ Zürich → Rom/);
    assert.equal(sent[0]!.body, 'Schalter 31–40 (neu), Gate B14 (neu). Eingetragen von Philip.');
    await ctx.call('PATCH', `/api/items/${itemId}`, anna, { details: { gate: 'B12', checkinDesk: '31–40' } });
    await settle();
    assert.equal(sent.length, 2);
    assert.equal(sent[1]!.endpoint, 'https://web.push.apple.com/philip', 'now Philip is told, not Anna');
    assert.match(sent[1]!.body, /^Gate B12 \(vorher B14\)\. Eingetragen von Anna\.$/);
  });

  test('no push for other edits, for the same value, for far-away flights, or when switched off', async () => {
    const n = sent.length;
    await ctx.call('PATCH', `/api/items/${itemId}`, philip, { title: 'Zürich → Rom (neu)' });
    await ctx.call('PATCH', `/api/items/${itemId}`, philip, { details: { gate: 'B12', checkinDesk: '31–40' } });
    await settle();
    assert.equal(sent.length, n, 'title change and unchanged gate announce nothing');

    const far = (await ctx.call('POST', `/api/trips/${tripId}/items`, philip, { type: 'flight', title: 'Rückflug', startLocal: local(24 * 5), startTz: 'Europe/Zurich' })).body.id;
    await ctx.call('PATCH', `/api/items/${far}`, philip, { details: { gate: 'A1' } });
    await settle();
    assert.equal(sent.length, n, 'a flight in five days is not announced yet');

    await ctx.call('PATCH', '/api/me/settings', anna, { notifications: { infoChange: false } });
    await ctx.call('PATCH', `/api/items/${itemId}`, philip, { details: { gate: 'C3', checkinDesk: '31–40' } });
    await settle();
    assert.equal(sent.length, n, 'Anna switched it off');
  });
});
