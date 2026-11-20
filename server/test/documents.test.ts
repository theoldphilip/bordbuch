import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, upload } from './helpers.ts';
import { ExtractionError, type Extractor } from '../src/ai/types.ts';
import type { AiResult } from '../src/ai/schema.ts';

const item = (p: Partial<AiResult['items'][number]> = {}): AiResult['items'][number] => ({
  type: 'hotel', title: 'Hotel Artemide', startLocal: '2027-05-08T14:00', startTz: 'Europe/Rome', endLocal: '2027-05-10T10:00', endTz: null,
  location: 'Via Nazionale 22, Rom', confirmation: 'AB12345', provider: 'Artemide', cost: 410, currency: 'EUR', notes: null, cruiseDayId: null,
  details: [{ key: 'room', value: '12' }], confidence: 'high', ...p,
});
const result = (p: Partial<AiResult> = {}): AiResult => ({ suggestedTripTitle: 'Mittelmeer mit MS Aurora', documentKind: 'Hotelbuchung', summary: 'Hotel in Rom', items: [item()], cruise: null, warnings: [], ...p });

describe('document inbox', () => {
  // What the fake "AI" returns is chosen per file name, so every test controls its own document.
  const replies = new Map<string, (ctx: Parameters<Extractor['extract']>[0]['context']) => AiResult>();
  const extractor: Extractor = {
    model: 'fake-model',
    async extract({ filename, context }) {
      const reply = replies.get(filename);
      if (!reply) throw new ExtractionError('Test: keine Antwort vorbereitet');
      return reply(context);
    },
    async check() {},
  };

  let ctx: Awaited<ReturnType<typeof setup>>;
  let admin = '';
  let viewer = '';
  let viewerId = '';
  let tripId = '';

  before(async () => {
    ctx = await setup({ extractor });
    admin = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
    const anna = await ctx.call('POST', '/api/users', admin, { username: 'anna', displayName: 'Anna', password: 'annapass1' });
    viewerId = anna.body.id;
    viewer = (await ctx.call('POST', '/api/auth/login', undefined, { username: 'anna', password: 'annapass1' })).body.token;
    tripId = (await ctx.call('POST', '/api/trips', admin, { title: 'Mittelmeer' })).body.trip.id;
    await ctx.call('PUT', `/api/trips/${tripId}/members/${viewerId}`, admin, { role: 'viewer' });
  });
  after(async () => ctx.cleanup());

  const send = (name: string, mime = 'application/pdf', content = '%PDF-1.4 test') => upload(ctx.app, admin, `/api/trips/${tripId}/documents`, name, mime, content);
  const detail = async () => (await ctx.call('GET', `/api/trips/${tripId}`, admin)).body;

  test('status endpoint reports the model without exposing a key', async () => {
    const s = await ctx.call('GET', '/api/ai/status', admin);
    assert.deepEqual(s.body, { enabled: true, model: 'fake-model' });
    assert.equal((await ctx.call('POST', '/api/ai/check', viewer)).status, 403, 'admin only');
    assert.equal((await ctx.call('POST', '/api/ai/check', admin)).status, 200);
  });

  test('upload → proposal → apply creates the item and files the document under it', async () => {
    replies.set('hotel.pdf', () => result());
    const up = await send('hotel.pdf');
    assert.equal(up.status, 201);
    assert.equal(up.body.attachment.analysisStatus, 'done');
    const id = up.body.attachment.id;

    const a = await ctx.call('GET', `/api/attachments/${id}/analysis`, admin);
    assert.equal(a.status, 200);
    assert.equal(a.body.items.length, 1);
    assert.equal(a.body.items[0].match, null);
    assert.deepEqual(a.body.items[0].problems, []);
    assert.equal(a.body.items[0].data.details.room, '12');

    // Nothing is created before apply.
    assert.equal((await detail()).items.length, 0);

    const applied = await ctx.call('POST', `/api/attachments/${id}/apply`, admin, { items: [{ action: 'create', data: a.body.items[0].data }] });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.createdItemIds.length, 1);
    const d = await detail();
    assert.equal(d.items.length, 1);
    assert.equal(d.items[0].title, 'Hotel Artemide');
    assert.equal(d.items[0].cost, 410);
    const att = d.attachments.find((x: any) => x.id === id);
    assert.equal(att.itemId, d.items[0].id);
    assert.equal(att.analysisStatus, 'applied');
  });

  test('a second document for the same booking is matched and updates the existing item', async () => {
    replies.set('hotel-update.pdf', () => result({ items: [item({ title: 'Artemide Roma', startLocal: '2027-05-08T15:00', details: [{ key: 'phone', value: '+39 06 1234' }] })] }));
    const up = await send('hotel-update.pdf');
    const id = up.body.attachment.id;
    const a = (await ctx.call('GET', `/api/attachments/${id}/analysis`, admin)).body;
    const existing = (await detail()).items[0];
    assert.equal(a.items[0].match.itemId, existing.id);
    assert.ok(a.items[0].match.changes.some((c: string) => c.startsWith('Beginn')));

    const applied = await ctx.call('POST', `/api/attachments/${id}/apply`, admin, { items: [{ action: 'update', itemId: existing.id, data: a.items[0].data }] });
    assert.equal(applied.status, 200);
    const d = await detail();
    assert.equal(d.items.length, 1, 'no duplicate');
    assert.equal(d.items[0].title, 'Hotel Artemide', 'own title is kept');
    assert.equal(d.items[0].startLocal, '2027-05-08T15:00');
    assert.deepEqual(d.items[0].details, { room: '12', phone: '+39 06 1234' });
  });

  test('a cruise document creates cruise and days; a later excursion is linked to its port day', async () => {
    replies.set('kreuzfahrt.pdf', () =>
      result({
        documentKind: 'Kreuzfahrt',
        items: [],
        cruise: {
          shipName: 'MS Aurora', cruiseLine: 'Beispiel', cabin: '8142', bookingRef: 'AUR-4711', notes: null,
          days: [
            { date: '2027-05-10', kind: 'embarkation', portName: 'Civitavecchia', country: 'Italien', timezone: 'Europe/Rome', arrival: '12:00', departure: '18:00', allAboard: '17:30', tender: false, notes: null },
            { date: '2027-05-11', kind: 'port', portName: 'Neapel', country: 'Italien', timezone: 'Europe/Rome', arrival: '07:00', departure: '17:00', allAboard: '16:30', tender: false, notes: null },
          ],
        },
      }),
    );
    const up = await send('kreuzfahrt.pdf');
    const a = (await ctx.call('GET', `/api/attachments/${up.body.attachment.id}/analysis`, admin)).body;
    assert.equal(a.cruise.match, null);
    assert.equal(a.cruise.newDays, 2);
    const applied = await ctx.call('POST', `/api/attachments/${up.body.attachment.id}/apply`, admin, { items: [], cruise: { action: 'create', data: a.cruise.data } });
    assert.equal(applied.status, 200);
    const cruise = (await detail()).cruises[0];
    assert.equal(cruise.days.length, 2);

    // The AI gets the new days as context and links the excursion to the Naples day.
    replies.set('ausflug.pdf', (c) => {
      const naples = c.cruiseDays.find((d) => d.portName === 'Neapel');
      assert.ok(naples, 'cruise days are part of the context');
      return result({ items: [item({ type: 'excursion', title: 'Pompeji', startLocal: '2027-05-11T09:00', endLocal: '2027-05-11T15:00', confirmation: 'EX-1', cruiseDayId: naples.id, details: [{ key: 'bookedVia', value: 'ship' }] })] });
    });
    const ex = await send('ausflug.pdf');
    const exA = (await ctx.call('GET', `/api/attachments/${ex.body.attachment.id}/analysis`, admin)).body;
    assert.equal(exA.items[0].data.cruiseDayId, cruise.days[1].id);
    await ctx.call('POST', `/api/attachments/${ex.body.attachment.id}/apply`, admin, { items: [{ action: 'create', data: exA.items[0].data }] });
    const created = (await detail()).items.find((i: any) => i.title === 'Pompeji');
    assert.equal(created.cruiseDayId, cruise.days[1].id);

    // The same cruise document again merges into the existing cruise instead of duplicating it.
    const again = await send('kreuzfahrt.pdf');
    const againA = (await ctx.call('GET', `/api/attachments/${again.body.attachment.id}/analysis`, admin)).body;
    assert.equal(againA.cruise.match.cruiseId, cruise.id);
    assert.equal(againA.cruise.updatedDays, 2);
    assert.equal(againA.cruise.newDays, 0);
    await ctx.call('POST', `/api/attachments/${again.body.attachment.id}/apply`, admin, { items: [], cruise: { action: 'update', cruiseId: cruise.id, data: againA.cruise.data } });
    const after = (await detail()).cruises;
    assert.equal(after.length, 1);
    assert.equal(after[0].days.length, 2);
  });

  test('an excursion applied before the cruise is linked to its port day once the cruise exists', async () => {
    const t2 = (await ctx.call('POST', '/api/trips', admin, { title: 'Reihenfolge' })).body.trip.id;
    const sendTo = (name: string) => upload(ctx.app, admin, `/api/trips/${t2}/documents`, name, 'application/pdf', '%PDF-1.4 x');
    replies.set('erst-ausflug.pdf', () => result({ suggestedTripTitle: null, items: [item({ type: 'excursion', title: 'Stadtrundgang', startLocal: '2027-06-02T10:00', endLocal: '2027-06-02T13:00', confirmation: 'EX-9', details: [] })] }));
    const ex = await sendTo('erst-ausflug.pdf');
    const exA = (await ctx.call('GET', `/api/attachments/${ex.body.attachment.id}/analysis`, admin)).body;
    assert.equal(exA.suggestedTripTitle, null);
    await ctx.call('POST', `/api/attachments/${ex.body.attachment.id}/apply`, admin, { items: [{ action: 'create', data: exA.items[0].data }] });
    assert.equal((await ctx.call('GET', `/api/trips/${t2}`, admin)).body.items[0].cruiseDayId, null);

    replies.set('dann-schiff.pdf', () =>
      result({ items: [], cruise: { shipName: 'MS Nordlicht', cruiseLine: null, cabin: null, bookingRef: null, notes: null, days: [
        { date: '2027-06-01', kind: 'embarkation', portName: 'Kiel', country: null, timezone: 'Europe/Berlin', arrival: null, departure: '17:00', allAboard: '16:30', tender: false, notes: null },
        { date: '2027-06-02', kind: 'port', portName: 'Oslo', country: 'Norwegen', timezone: 'Europe/Oslo', arrival: '08:00', departure: '18:00', allAboard: '17:30', tender: false, notes: null },
      ] } }),
    );
    const ship = await sendTo('dann-schiff.pdf');
    const shipA = (await ctx.call('GET', `/api/attachments/${ship.body.attachment.id}/analysis`, admin)).body;
    assert.equal(shipA.suggestedTripTitle, 'Mittelmeer mit MS Aurora');
    await ctx.call('POST', `/api/attachments/${ship.body.attachment.id}/apply`, admin, { items: [], cruise: { action: 'create', data: shipA.cruise.data } });
    const d = (await ctx.call('GET', `/api/trips/${t2}`, admin)).body;
    const oslo = d.cruises[0].days.find((x: any) => x.portName === 'Oslo');
    assert.equal(d.items[0].cruiseDayId, oslo.id);
  });

  test('bulk delete removes several entries, rejects foreign ids and needs edit rights', async () => {
    const t3 = (await ctx.call('POST', '/api/trips', admin, { title: 'Aufräumen' })).body.trip.id;
    const mk = async (title: string) => (await ctx.call('POST', `/api/trips/${t3}/items`, admin, { type: 'note', title, startLocal: '2027-07-01' })).body.id;
    const [a, b, c] = [await mk('a'), await mk('b'), await mk('c')];
    await ctx.call('PUT', `/api/trips/${t3}/members/${viewerId}`, admin, { role: 'viewer' });
    assert.equal((await ctx.call('POST', `/api/trips/${t3}/items/delete`, viewer, { ids: [a] })).status, 403);
    assert.equal((await ctx.call('POST', `/api/trips/${t3}/items/delete`, admin, { ids: [a, 'fremd'] })).status, 400);
    assert.equal((await ctx.call('GET', `/api/trips/${t3}`, admin)).body.items.length, 3, 'nothing deleted by the failed call');
    assert.equal((await ctx.call('POST', `/api/trips/${t3}/items/delete`, admin, { ids: [a, b] })).status, 204);
    assert.deepEqual((await ctx.call('GET', `/api/trips/${t3}`, admin)).body.items.map((i: any) => i.id), [c]);
  });

  test('apply validates again; one bad entry rolls everything back', async () => {
    replies.set('x.pdf', () => result());
    const id = (await send('x.pdf')).body.attachment.id;
    const before = (await detail()).items.length;
    const bad = await ctx.call('POST', `/api/attachments/${id}/apply`, admin, {
      items: [
        { action: 'create', data: { ...item(), details: {}, startLocal: '2027-06-01T10:00' } },
        { action: 'create', data: { type: 'hotel', title: 'Kaputt', startLocal: 'morgen' } },
      ],
    });
    assert.equal(bad.status, 400);
    assert.equal((await detail()).items.length, before, 'first entry was rolled back');
    assert.equal((await ctx.call('POST', `/api/attachments/${id}/apply`, admin, { items: [{ action: 'skip', data: {} }] })).status, 400, 'nothing selected');
    const foreign = await ctx.call('POST', `/api/attachments/${id}/apply`, admin, { items: [{ action: 'update', itemId: 'gibt-es-nicht', data: {} }] });
    assert.equal(foreign.status, 400);
  });

  test('viewers can look but not apply, dismiss or upload', async () => {
    replies.set('y.pdf', () => result());
    const id = (await send('y.pdf')).body.attachment.id;
    assert.equal((await ctx.call('GET', `/api/attachments/${id}/analysis`, viewer)).status, 200);
    assert.equal((await ctx.call('POST', `/api/attachments/${id}/apply`, viewer, { items: [{ action: 'create', data: item() }] })).status, 403);
    assert.equal((await ctx.call('POST', `/api/attachments/${id}/dismiss`, viewer)).status, 403);
    assert.equal((await upload(ctx.app, viewer, `/api/trips/${tripId}/documents`, 'z.pdf', 'application/pdf', 'x')).status, 403);
    const dismissed = await ctx.call('POST', `/api/attachments/${id}/dismiss`, admin);
    assert.equal(dismissed.body.analysisStatus, 'dismissed');
  });

  test('failed analysis keeps the file, shows the reason and can be retried', async () => {
    const up = await send('unbekannt.pdf'); // the fake has no reply for this name → error
    assert.equal(up.status, 201);
    assert.equal(up.body.attachment.analysisStatus, 'failed');
    assert.match(up.body.attachment.analysisError, /keine Antwort/);
    const id = up.body.attachment.id;
    assert.equal((await ctx.call('GET', `/api/attachments/${id}`, admin)).status, 200, 'file is stored');
    replies.set('unbekannt.pdf', () => result({ items: [], summary: 'Keine Reisedaten' }));
    const retry = await ctx.call('POST', `/api/attachments/${id}/analyze`, admin);
    assert.equal(retry.body.analysisStatus, 'done');
    const a = (await ctx.call('GET', `/api/attachments/${id}/analysis`, admin)).body;
    assert.deepEqual(a.items, []);
    assert.equal(a.summary, 'Keine Reisedaten');
  });

  test('files the AI cannot read are stored without analysis', async () => {
    const up = await send('Pass.pkpass', 'application/vnd.apple.pkpass', 'zip');
    assert.equal(up.body.analyzable, false);
    assert.equal(up.body.attachment.analysisStatus, null);
    assert.equal((await ctx.call('POST', `/api/attachments/${up.body.attachment.id}/analyze`, admin)).status, 400);
  });
});

describe('without API key', () => {
  test('documents are stored and the feature reports itself as off', async () => {
    const c = await setup({ extractor: null });
    try {
      const token = (await c.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
      const tripId = (await c.call('POST', '/api/trips', token, { title: 'T' })).body.trip.id;
      assert.deepEqual((await c.call('GET', '/api/ai/status', token)).body, { enabled: false, model: null });
      const up = await upload(c.app, token, `/api/trips/${tripId}/documents`, 'a.pdf', 'application/pdf', 'x');
      assert.equal(up.status, 201);
      assert.equal(up.body.aiEnabled, false);
      assert.equal(up.body.attachment.analysisStatus, null);
      assert.equal((await c.call('POST', '/api/ai/check', token)).status, 409);
    } finally {
      await c.cleanup();
    }
  });
});
