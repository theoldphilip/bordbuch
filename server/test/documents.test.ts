import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, upload } from './helpers.ts';
import { ExtractionError, type Extractor } from '../src/ai/types.ts';
import type { AiResult } from '../src/ai/schema.ts';

const item = (p: Partial<AiResult['items'][number]> = {}): AiResult['items'][number] => ({
  type: 'hotel', title: 'Hotel Artemide', startLocal: '2027-05-08T14:00', startTz: 'Europe/Rome', endLocal: '2027-05-10T10:00', endTz: null,
  location: 'Via Nazionale 22, Rom', confirmation: 'AB12345', provider: 'Artemide', cost: 410, currency: 'EUR', notes: null, cruiseDayId: null,
  details: [{ key: 'room', value: '12' }], infos: [], confidence: 'high', ...p,
});
const result = (p: Partial<AiResult> = {}): AiResult => ({ suggestedTripTitle: 'Mittelmeer mit MS Aurora', documentKind: 'Hotelbuchung', summary: 'Hotel in Rom', items: [item()], cruise: null, warnings: [], ...p });

describe('document inbox', () => {
  // What the fake "AI" returns is chosen per file name, so every test controls its own document.
  const replies = new Map<string, (ctx: Parameters<Extractor['extract']>[0]['context']) => AiResult>();
  let lastFileCount = 0;
  const extractor: Extractor = {
    model: 'fake-model',
    async extract({ files, context }) {
      lastFileCount = files.length;
      const filename = files[0]!.filename;
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
    assert.deepEqual(s.body, { enabled: true, model: 'fake-model', research: false, review: false });
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
          shipName: 'MS Aurora', cruiseLine: 'Beispiel', cabin: '8142', bookingRef: 'AUR-4711', notes: null, infos: [],
          days: [
            { date: '2027-05-10', kind: 'embarkation', portName: 'Civitavecchia', country: 'Italien', timezone: 'Europe/Rome', arrival: '12:00', departure: '18:00', allAboard: '17:30', tender: false, notes: null, infos: [] },
            { date: '2027-05-11', kind: 'port', portName: 'Neapel', country: 'Italien', timezone: 'Europe/Rome', arrival: '07:00', departure: '17:00', allAboard: '16:30', tender: false, notes: null, infos: [] },
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
      result({ items: [], cruise: { shipName: 'MS Nordlicht', cruiseLine: null, cabin: null, bookingRef: null, notes: null, infos: [], days: [
        { date: '2027-06-01', kind: 'embarkation', portName: 'Kiel', country: null, timezone: 'Europe/Berlin', arrival: null, departure: '17:00', allAboard: '16:30', tender: false, notes: null, infos: [] },
        { date: '2027-06-02', kind: 'port', portName: 'Oslo', country: 'Norwegen', timezone: 'Europe/Oslo', arrival: '08:00', departure: '18:00', allAboard: '17:30', tender: false, notes: null, infos: [] },
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

  test('additional infos from a document land on the matching entry and merge without duplicates', async () => {
    const t4 = (await ctx.call('POST', '/api/trips', admin, { title: 'Infos' })).body.trip.id;
    const sendTo = (name: string) => upload(ctx.app, admin, `/api/trips/${t4}/documents`, name, 'application/pdf', '%PDF-1.4 x');
    replies.set('infos1.pdf', () =>
      result({ items: [item({ confirmation: 'ZZ99001', infos: [
        { label: 'Rezeption', value: '+39 06 1234', kind: 'phone', source: 'document' },
        { label: 'Notruf Italien', value: '112 (Polizei, Rettung, Feuerwehr)', kind: 'emergency', source: 'ai' },
      ] })] }),
    );
    const first = await sendTo('infos1.pdf');
    const a1 = (await ctx.call('GET', `/api/attachments/${first.body.attachment.id}/analysis`, admin)).body;
    assert.equal(a1.items[0].data.infos.length, 2);
    await ctx.call('POST', `/api/attachments/${first.body.attachment.id}/apply`, admin, { items: [{ action: 'create', data: a1.items[0].data }] });
    const stored = (await ctx.call('GET', `/api/trips/${t4}`, admin)).body.items[0];
    assert.deepEqual(stored.infos.map((i: any) => [i.label, i.kind, i.source]), [['Rezeption', 'phone', 'document'], ['Notruf Italien', 'emergency', 'ai']]);

    replies.set('infos2.pdf', () =>
      result({ items: [item({ confirmation: 'ZZ99001', infos: [
        { label: 'Rezeption', value: '+39 06 12 34', kind: 'phone', source: 'document' },
        { label: 'Frühstück', value: 'ab 7:00 im Erdgeschoss', kind: 'text', source: 'document' },
      ] })] }),
    );
    const second = await sendTo('infos2.pdf');
    const a2 = (await ctx.call('GET', `/api/attachments/${second.body.attachment.id}/analysis`, admin)).body;
    assert.ok(a2.items[0].match.changes.includes('1 Zusatzinfo ergänzt'), 'same number with other spacing is not new');
    await ctx.call('POST', `/api/attachments/${second.body.attachment.id}/apply`, admin, { items: [{ action: 'update', itemId: a2.items[0].match.itemId, data: a2.items[0].data }] });
    const merged = (await ctx.call('GET', `/api/trips/${t4}`, admin)).body.items[0];
    assert.deepEqual(merged.infos.map((i: any) => i.label), ['Rezeption', 'Notruf Italien', 'Frühstück']);
  });

  test('several files analysed together act as one document and follow the lead', async () => {
    const t5 = (await ctx.call('POST', '/api/trips', admin, { title: 'Screenshots' })).body.trip.id;
    const plain = async (name: string, mime = 'image/png') => (await upload(ctx.app, admin, `/api/trips/${t5}/attachments`, name, mime, 'bild')).body.id as string;
    const [a, b, c] = [await plain('s1.png'), await plain('s2.png'), await plain('s3.png')];
    replies.set('s1.png', () => result({ items: [item({ confirmation: 'SC12345' })] }));

    const grouped = await ctx.call('POST', `/api/trips/${t5}/documents/group`, admin, { attachmentIds: [a, b, c] });
    assert.equal(grouped.status, 200);
    assert.equal(lastFileCount, 3, 'one extraction request with all files');
    assert.equal(grouped.body.attachment.id, a);
    const state = (await ctx.call('GET', `/api/trips/${t5}`, admin)).body.attachments;
    assert.deepEqual(state.map((x: any) => [x.id === a ? 'lead' : 'member', x.analysisStatus]), [['lead', 'done'], ['member', 'grouped'], ['member', 'grouped']]);

    const view = (await ctx.call('GET', `/api/attachments/${a}/analysis`, admin)).body;
    assert.deepEqual(view.files.map((f: any) => f.filename), ['s1.png', 's2.png', 's3.png']);
    await ctx.call('POST', `/api/attachments/${a}/apply`, admin, { items: [{ action: 'create', data: view.items[0].data }] });
    const after = (await ctx.call('GET', `/api/trips/${t5}`, admin)).body;
    const itemId = after.items[0].id;
    assert.deepEqual(after.attachments.map((x: any) => [x.itemId, x.analysisStatus]), [[itemId, 'applied'], [itemId, 'applied'], [itemId, 'applied']]);
  });

  test('group analysis: dismiss takes members along, unreadable files and foreign ids are rejected, a failure can be retried', async () => {
    const t6 = (await ctx.call('POST', '/api/trips', admin, { title: 'Gruppe 2' })).body.trip.id;
    const plain = async (name: string, mime: string) => (await upload(ctx.app, admin, `/api/trips/${t6}/attachments`, name, mime, 'x')).body.id as string;
    const [a, b] = [await plain('g1.pdf', 'application/pdf'), await plain('g2.pdf', 'application/pdf')];
    const zip = await plain('wallet.pkpass', 'application/vnd.apple.pkpass');

    assert.equal((await ctx.call('POST', `/api/trips/${t6}/documents/group`, admin, { attachmentIds: [a, zip] })).status, 400, 'unreadable type');
    assert.equal((await ctx.call('POST', `/api/trips/${t6}/documents/group`, admin, { attachmentIds: [a, 'fremd'] })).status, 400, 'foreign id');
    assert.equal((await ctx.call('POST', `/api/trips/${t6}/documents/group`, admin, { attachmentIds: [a] })).status, 400, 'needs two');
    assert.equal((await ctx.call('POST', `/api/trips/${t6}/documents/group`, viewer, { attachmentIds: [a, b] })).status, 404, 'not a member of this trip');

    const failed = await ctx.call('POST', `/api/trips/${t6}/documents/group`, admin, { attachmentIds: [a, b] }); // no reply prepared → error
    assert.equal(failed.body.attachment.analysisStatus, 'failed');
    replies.set('g1.pdf', () => result());
    const retry = await ctx.call('POST', `/api/attachments/${a}/analyze`, admin);
    assert.equal(retry.body.analysisStatus, 'done');
    assert.equal(lastFileCount, 2, 'the retry still analyses both files');
    await ctx.call('POST', `/api/attachments/${a}/dismiss`, admin);
    const states = (await ctx.call('GET', `/api/trips/${t6}`, admin)).body.attachments.filter((x: any) => x.id !== zip).map((x: any) => x.analysisStatus);
    assert.deepEqual(states, ['dismissed', 'dismissed']);
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
  test('two stations turn an automatically created city trip into a round trip; a cruise turns it into a cruise trip', async () => {
    const t = (await ctx.call('POST', '/api/trips', admin, { title: 'Italien', kind: 'city' })).body.trip.id;
    const stopItem = (title: string, startLocal: string, endLocal: string) => ({ type: 'stop', title, startLocal, endLocal, startTz: 'Europe/Rome' });
    replies.set('programm.pdf', () => result({
      documentKind: 'Rundreise-Programm', summary: 'Florenz und Rom',
      items: [stopItem('Florenz', '2027-05-12T15:00', '2027-05-15T10:00'), stopItem('Rom', '2027-05-15T13:00', '2027-05-18T10:00')].map((x) => item(x as any)),
    }));
    const up = await upload(ctx.app, admin, `/api/trips/${t}/documents`, 'programm.pdf', 'application/pdf', '%PDF-1.4 x');
    const id = up.body.attachment.id;
    const a = (await ctx.call('GET', `/api/attachments/${id}/analysis`, admin)).body;
    assert.deepEqual(a.items.map((i: any) => i.data.type), ['stop', 'stop']);
    assert.equal((await ctx.call('GET', `/api/trips/${t}`, admin)).body.trip.kind, 'city', 'nothing changes before apply');
    const ap = await ctx.call('POST', `/api/attachments/${id}/apply`, admin, { items: a.items.map((i: any) => ({ action: 'create', data: i.data })) });
    assert.equal(ap.status, 200);
    assert.equal((await ctx.call('GET', `/api/trips/${t}`, admin)).body.trip.kind, 'roundtrip');
    const tl = (await ctx.call('GET', `/api/trips/${t}/timeline`, admin)).body;
    assert.ok(tl.warnings.some((w: any) => w.code === 'stop_no_lodging'), 'stations without hotel are flagged');
  });

  test('a general document (Bord-ABC): only the ship\'s numbers arrive as infos on the existing cruise and its embarkation day, no new days', async () => {
    const t = (await ctx.call('POST', '/api/trips', admin, { title: 'Relax' })).body.trip.id;
    const created = await ctx.call('POST', `/api/trips/${t}/cruises`, admin, {
      shipName: 'Mein Schiff Relax',
      days: [
        { date: '2026-12-04', kind: 'embarkation', portName: 'Santa Cruz', arrival: '16:00', departure: '22:30', timezone: 'Atlantic/Canary' },
        { date: '2026-12-11', kind: 'disembarkation', portName: 'Santa Cruz', arrival: '06:00', timezone: 'Atlantic/Canary' },
      ],
    });
    assert.equal(created.status, 201);
    const info = (label: string, value: string) => ({ label, value, kind: 'phone' as const, source: 'document' as const });
    const emptyDay = { portName: null, country: null, timezone: null, arrival: null, departure: null, allAboard: null, tender: false, notes: null };
    replies.set('bord-abc.pdf', () => result({
      documentKind: 'Bord-ABC', summary: 'Allgemeine Bordinformationen', items: [], warnings: [],
      cruise: {
        shipName: 'Mein Schiff Relax', cruiseLine: null, cabin: null, bookingRef: null, notes: null,
        infos: [info('Notfalltelefon Mein Schiff Relax', '+49 40 87 40 80 28')],
        days: [{ ...emptyDay, date: '2026-12-04', kind: 'embarkation', infos: [{ ...info('Verspätete Anreise (nur am Anreisetag)', '+49 40 600 01-7108'), kind: 'emergency' as const }] }],
      },
    }));
    const up = await upload(ctx.app, admin, `/api/trips/${t}/documents`, 'bord-abc.pdf', 'application/pdf', '%PDF-1.4 x');
    const id = up.body.attachment.id;
    const a = (await ctx.call('GET', `/api/attachments/${id}/analysis`, admin)).body;
    assert.equal(a.items.length, 0);
    assert.equal(a.cruise.match.shipName, 'Mein Schiff Relax', 'the document belongs to the existing cruise');
    assert.equal(a.cruise.newDays, 0, 'no new days');
    const ap = await ctx.call('POST', `/api/attachments/${id}/apply`, admin, { items: [], cruise: { action: 'update', cruiseId: a.cruise.match.cruiseId, data: a.cruise.data } });
    assert.equal(ap.status, 200);
    const cruise = (await ctx.call('GET', `/api/trips/${t}`, admin)).body.cruises[0];
    assert.equal(cruise.days.length, 2, 'still two days');
    assert.deepEqual(cruise.infos.map((i: any) => i.value), ['+49 40 87 40 80 28']);
    const embark = cruise.days.find((d: any) => d.kind === 'embarkation');
    assert.deepEqual(embark.infos.map((i: any) => [i.kind, i.value]), [['emergency', '+49 40 600 01-7108']]);
    assert.equal(embark.arrival, '16:00', 'existing times stay');
  });
});

describe('without API key', () => {
  test('documents are stored and the feature reports itself as off', async () => {
    const c = await setup({ extractor: null });
    try {
      const token = (await c.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
      const tripId = (await c.call('POST', '/api/trips', token, { title: 'T' })).body.trip.id;
      assert.deepEqual((await c.call('GET', '/api/ai/status', token)).body, { enabled: false, model: null, research: false, review: false });
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
