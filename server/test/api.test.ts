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
    const pre = tl.body.phases[0];
    assert.deepEqual(pre.days.map((d: any) => d.date), ['2027-05-09', '2027-05-10']);
    assert.equal(pre.days[1].entries[0].role, 'end', 'hotel check-out on embarkation morning is in Vorprogramm');
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

  test('deleting a trip removes it', async () => {
    assert.equal((await ctx.call('DELETE', `/api/trips/${tripId}`, admin)).status, 204);
    assert.equal((await ctx.call('GET', `/api/trips/${tripId}`, admin)).status, 404);
  });
});
