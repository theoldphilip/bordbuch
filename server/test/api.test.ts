import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';

describe('API', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let admin = '';
  let anna = '';
  let annaId = '';
  let tripId = '';

  before(async () => {
    ctx = await setup();
  });
  after(async () => ctx.cleanup());

  test('setup creates the first admin exactly once', async () => {
    assert.deepEqual((await ctx.call('GET', '/api/setup')).body, { needsSetup: true });
    const res = await ctx.call('POST', '/api/setup', undefined, {
      username: 'philip',
      displayName: 'Philip',
      password: 'geheim123',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.isAdmin, true);
    admin = res.body.token;
    const again = await ctx.call('POST', '/api/setup', undefined, {
      username: 'xy',
      displayName: 'X',
      password: 'geheim123',
    });
    assert.equal(again.status, 409);
  });

  test('requires auth and rejects wrong passwords', async () => {
    assert.equal((await ctx.call('GET', '/api/trips')).status, 401);
    assert.equal((await ctx.call('GET', '/api/trips', 'falsch')).status, 401);
    const bad = await ctx.call('POST', '/api/auth/login', undefined, { username: 'philip', password: 'nope' });
    assert.equal(bad.status, 401);
  });

  test('admin creates a family member who can log in', async () => {
    const res = await ctx.call('POST', '/api/users', admin, {
      username: 'anna',
      displayName: 'Anna',
      password: 'annapass1',
    });
    assert.equal(res.status, 201);
    annaId = res.body.id;
    const login = await ctx.call('POST', '/api/auth/login', undefined, { username: 'ANNA', password: 'annapass1' });
    assert.equal(login.status, 200);
    anna = login.body.token;
    assert.equal((await ctx.call('POST', '/api/users', anna, { username: 'z', displayName: 'Z', password: 'zzzzzzzz' })).status, 403);
  });

  test('trip with cruise, items and timeline', async () => {
    const trip = await ctx.call('POST', '/api/trips', admin, { title: 'Mittelmeer 2027' });
    assert.equal(trip.status, 201);
    tripId = trip.body.trip.id;

    const cruise = await ctx.call('POST', `/api/trips/${tripId}/cruises`, admin, {
      shipName: 'MS Beispiel',
      cruiseLine: 'Beispiel Cruises',
      days: [
        { date: '2027-05-10', kind: 'embarkation', portName: 'Civitavecchia', timezone: 'Europe/Rome', arrival: '12:00', departure: '18:00', allAboard: '17:00' },
        { date: '2027-05-11', kind: 'port', portName: 'Neapel', timezone: 'Europe/Rome', arrival: '08:00', departure: '18:00', allAboard: '17:30' },
        { date: '2027-05-12', kind: 'sea' },
        { date: '2027-05-13', kind: 'disembarkation', portName: 'Barcelona', timezone: 'Europe/Madrid', arrival: '07:00', departure: '09:00' },
      ],
    });
    assert.equal(cruise.status, 201);
    assert.equal(cruise.body.days.length, 4);
    const naples = cruise.body.days[1];

    const add = (payload: object) => ctx.call('POST', `/api/trips/${tripId}/items`, admin, payload);
    assert.equal((await add({ type: 'flight', title: 'ZRH → FCO', startLocal: '2027-05-09T10:00', startTz: 'Europe/Zurich', endLocal: '2027-05-09T11:40', endTz: 'Europe/Rome', details: { flightNumber: 'LX1726' } })).status, 201);
    assert.equal((await add({ type: 'hotel', title: 'Hotel Roma', startLocal: '2027-05-09T15:00', startTz: 'Europe/Rome', endLocal: '2027-05-10T10:00' })).status, 201);
    const excursion = await add({ type: 'excursion', title: 'Pompeji privat', startLocal: '2027-05-11T09:00', endLocal: '2027-05-11T17:00', cruiseDayId: naples.id, details: { bookedVia: 'private' } });
    assert.equal(excursion.status, 201);
    assert.equal((await add({ type: 'flight', title: 'BCN → ZRH', startLocal: '2027-05-13T10:30', startTz: 'Europe/Madrid', endLocal: '2027-05-13T12:15', endTz: 'Europe/Zurich' })).status, 201);
    assert.equal((await add({ type: 'flight', title: 'kaputt', startLocal: 'morgen' })).status, 400);

    const tl = await ctx.call('GET', `/api/trips/${tripId}/timeline`, admin);
    assert.equal(tl.status, 200);
    assert.deepEqual(tl.body.phases.map((p: any) => p.kind), ['pre', 'cruise', 'post']);
    assert.deepEqual(tl.body.phases.map((p: any) => p.title), ['Anreise', 'Kreuzfahrt · MS Beispiel', 'Abreise']);
    const pre = tl.body.phases[0];
    assert.deepEqual(pre.days.map((d: any) => d.date), ['2027-05-09', '2027-05-10']);
    assert.equal(pre.days[1].entries[0].role, 'end', 'hotel check-out on embarkation morning is in Anreise');
    const cruisePhase = tl.body.phases[1];
    assert.equal(cruisePhase.days.length, 4, 'sea day is shown even without entries');
    assert.equal(cruisePhase.days[1].entries[0].item.title, 'Pompeji privat');

    const codes = tl.body.warnings.map((w: any) => w.code);
    assert.ok(codes.includes('excursion_tight'), 'private excursion 30 min before all aboard is tight');
    assert.ok(codes.includes('disembark_tight'), 'flight 1.5 h after disembarkation is tight');
    assert.ok(!codes.includes('embark_tight'), 'arrival the day before is fine');
  });

  test('sharing: viewer can read but not edit, list shows ships', async () => {
    assert.equal((await ctx.call('GET', `/api/trips/${tripId}`, anna)).status, 404);
    const share = await ctx.call('PUT', `/api/trips/${tripId}/members/${annaId}`, admin, { role: 'viewer' });
    assert.equal(share.status, 200);
    assert.equal(share.body.length, 2);

    const list = await ctx.call('GET', '/api/trips', anna);
    assert.equal(list.body.length, 1);
    assert.deepEqual(list.body[0].ships, ['MS Beispiel']);
    assert.equal(list.body[0].effectiveStartDate, '2027-05-09');
    assert.equal(list.body[0].effectiveEndDate, '2027-05-13');

    const edit = await ctx.call('POST', `/api/trips/${tripId}/items`, anna, { type: 'note', title: 'x', startLocal: '2027-05-10' });
    assert.equal(edit.status, 403);
    const leave = await ctx.call('DELETE', `/api/trips/${tripId}/members/${annaId}`, anna);
    assert.equal(leave.status, 200, 'viewer may leave');
    const me = (await ctx.call('GET', '/api/me', admin)).body;
    const demote = await ctx.call('PUT', `/api/trips/${tripId}/members/${me.id}`, admin, { role: 'editor' });
    assert.equal(demote.status, 409, 'last owner cannot be demoted');
  });

  test('attachments upload, download, size limit', async () => {
    const boundary = '----bordbuch';
    const body = (content: string | Buffer, name: string) =>
      Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`),
        Buffer.isBuffer(content) ? content : Buffer.from(content),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
    const up = await ctx.app.inject({
      method: 'POST',
      url: `/api/trips/${tripId}/attachments`,
      headers: { authorization: `Bearer ${admin}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body('%PDF-1.4 bordkarte', 'Bordkarte.pdf'),
    });
    assert.equal(up.statusCode, 201);
    const att = up.json();
    assert.equal(att.filename, 'Bordkarte.pdf');

    const down = await ctx.app.inject({ method: 'GET', url: `/api/attachments/${att.id}`, headers: { authorization: `Bearer ${admin}` } });
    assert.equal(down.statusCode, 200);
    assert.equal(down.body, '%PDF-1.4 bordkarte');

    const tooBig = await ctx.app.inject({
      method: 'POST',
      url: `/api/trips/${tripId}/attachments`,
      headers: { authorization: `Bearer ${admin}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body(Buffer.alloc(1.5 * 1024 * 1024), 'gross.pdf'),
    });
    assert.equal(tooBig.statusCode, 413);

    const del = await ctx.call('DELETE', `/api/attachments/${att.id}`, admin);
    assert.equal(del.status, 204);
  });

  test('additional infos on items, cruise days and cruises', async () => {
    const infos = [
      { label: 'Rezeption', value: '+39 06 1234', kind: 'phone' },
      { label: 'Notruf Italien', value: '112', kind: 'emergency', source: 'ai' },
    ];
    const created = await ctx.call('POST', `/api/trips/${tripId}/items`, admin, { type: 'hotel', title: 'Info-Hotel', startLocal: '2027-06-01T14:00', infos });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.infos.map((i: any) => i.source), ['user', 'ai'], 'source defaults to user');
    const patched = await ctx.call('PATCH', `/api/items/${created.body.id}`, admin, { notes: 'x' });
    assert.equal(patched.body.infos.length, 2, 'infos survive unrelated edits');
    assert.equal((await ctx.call('PATCH', `/api/items/${created.body.id}`, admin, { infos: [{ label: 'x', value: 'y', kind: 'kaputt' }] })).status, 400);
    assert.equal((await ctx.call('PATCH', `/api/items/${created.body.id}`, admin, { infos: [] })).body.infos.length, 0, 'can be cleared');

    const detail = (await ctx.call('GET', `/api/trips/${tripId}`, admin)).body;
    const day = await ctx.call('PATCH', `/api/cruise-days/${detail.cruises[0].days[1].id}`, admin, { infos: [{ label: 'Agentur', value: '+39 081 555', kind: 'phone' }] });
    assert.equal(day.body.infos[0].label, 'Agentur');
    const cruise = await ctx.call('PATCH', `/api/cruises/${detail.cruises[0].id}`, admin, { infos: [{ label: 'Hotline', value: '+49 40 1', kind: 'emergency' }] });
    assert.equal(cruise.body.infos[0].kind, 'emergency');
    assert.equal((await ctx.call('GET', `/api/trips/${tripId}`, admin)).body.cruises[0].days[1].infos.length, 1);
  });

  test('personal time need is a per-user setting and shapes that user\'s timeline', async () => {
    assert.deepEqual((await ctx.call('GET', '/api/me/settings', admin)).body.pace, { enabled: false, factor: 1.5, extraMinutes: 0 });
    assert.equal((await ctx.call('GET', `/api/trips/${tripId}/timeline`, admin)).body.pace, null);

    const on = await ctx.call('PATCH', '/api/me/settings', admin, { pace: { enabled: true, factor: 2, extraMinutes: 10 } });
    assert.equal(on.status, 200);
    assert.deepEqual(on.body.pace, { enabled: true, factor: 2, extraMinutes: 10 });
    assert.deepEqual((await ctx.call('GET', `/api/trips/${tripId}/timeline`, admin)).body.pace, { enabled: true, factor: 2, extraMinutes: 10 });

    // validation
    assert.equal((await ctx.call('PATCH', '/api/me/settings', admin, { pace: { factor: 0.5 } })).status, 400, 'faster than normal makes no sense');
    assert.equal((await ctx.call('PATCH', '/api/me/settings', admin, { pace: { factor: 9 } })).status, 400);
    assert.equal((await ctx.call('PATCH', '/api/me/settings', admin, { pace: { extraMinutes: -5 } })).status, 400);

    // other users are not affected, and a partial update keeps the other values
    assert.equal((await ctx.call('GET', '/api/me/settings', anna)).body.pace.enabled, false);
    const off = await ctx.call('PATCH', '/api/me/settings', admin, { pace: { enabled: false } });
    assert.deepEqual(off.body.pace, { enabled: false, factor: 2, extraMinutes: 10 });
    assert.equal((await ctx.call('GET', `/api/trips/${tripId}/timeline`, admin)).body.pace, null);
    assert.equal((await ctx.call('GET', '/api/me/settings')).status, 401);
  });

  test('deleting a trip removes it', async () => {
    assert.equal((await ctx.call('DELETE', `/api/trips/${tripId}`, admin)).status, 204);
    assert.equal((await ctx.call('GET', `/api/trips/${tripId}`, admin)).status, 404);
  });
});

describe('trip kind', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let token = '';
  before(async () => {
    ctx = await setup();
    token = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
  });
  after(async () => ctx.cleanup());

  test('a trip is a cruise unless said otherwise; kind can be chosen and changed, invalid kinds are rejected', async () => {
    const plain = await ctx.call('POST', '/api/trips', token, { title: 'Ohne Angabe' });
    assert.equal(plain.body.trip.kind, 'cruise', 'default keeps existing behaviour');
    const city = await ctx.call('POST', '/api/trips', token, { title: 'Rom', kind: 'city' });
    assert.equal(city.body.trip.kind, 'city');
    assert.equal((await ctx.call('POST', '/api/trips', token, { title: 'x', kind: 'raumschiff' })).status, 400);
    const changed = await ctx.call('PATCH', `/api/trips/${city.body.trip.id}`, token, { kind: 'roundtrip' });
    assert.equal(changed.body.trip.kind, 'roundtrip');
    assert.equal((await ctx.call('PATCH', `/api/trips/${city.body.trip.id}`, token, { title: 'Italien' })).body.trip.kind, 'roundtrip', 'other edits keep the kind');
    assert.equal((await ctx.call('GET', '/api/trips', token)).body.find((t: any) => t.id === city.body.trip.id).kind, 'roundtrip');
  });

  test('creating a cruise turns the trip into a cruise trip; stations can be created as items', async () => {
    const id = (await ctx.call('POST', '/api/trips', token, { title: 'Wird Kreuzfahrt', kind: 'city' })).body.trip.id;
    const stop = await ctx.call('POST', `/api/trips/${id}/items`, token, { type: 'stop', title: 'Florenz', startLocal: '2027-05-12T15:00', startTz: 'Europe/Rome', endLocal: '2027-05-15T10:00' });
    assert.equal(stop.status, 201);
    assert.equal((await ctx.call('POST', `/api/trips/${id}/cruises`, token, { shipName: 'MS Test', days: [] })).status, 201);
    assert.equal((await ctx.call('GET', `/api/trips/${id}`, token)).body.trip.kind, 'cruise');
  });
});
