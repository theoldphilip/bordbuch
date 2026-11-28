import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, upload } from './helpers.ts';
import { ExtractionError, type Extractor } from '../src/ai/types.ts';
import type { AiResult } from '../src/ai/schema.ts';
import type { ApnsSender } from '../src/apns.ts';
import { apnsPayload } from '../src/apns.ts';
import type { PushMessage } from '../src/push.ts';

const result: AiResult = {
  suggestedTripTitle: null, documentKind: 'Hotelbuchung', summary: 'Hotel', cruise: null, warnings: [],
  items: [{
    type: 'hotel', title: 'Hotel Artemide', startLocal: '2027-05-08T14:00', startTz: 'Europe/Rome', endLocal: '2027-05-10T10:00', endTz: null,
    location: null, confirmation: null, provider: null, cost: null, currency: null, notes: null, cruiseDayId: null,
    details: [], infos: [], confidence: 'high',
  }],
};

describe('document analysis in the background (iPhone share sheet)', { timeout: 20_000 }, () => {
  let release: () => void = () => {};
  const extractor: Extractor = {
    model: 'fake-model',
    async extract({ files }) {
      await new Promise<void>((r) => (release = r));
      if (files[0]!.filename === 'kaputt.pdf') throw new ExtractionError('Test: nicht lesbar');
      return result;
    },
    async check() {},
  };
  const sent: { token: string; message: PushMessage }[] = [];
  const apns: ApnsSender = { async send(token, message) { sent.push({ token, message }); return { ok: true }; } };

  let ctx: Awaited<ReturnType<typeof setup>>;
  let admin = '';
  let tripId = '';
  const token = 'ab'.repeat(32);

  before(async () => {
    ctx = await setup({ extractor, apnsSender: apns });
    admin = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
    tripId = (await ctx.call('POST', '/api/trips', admin, { title: 'Rom' })).body.trip.id;
    assert.equal((await ctx.call('POST', '/api/push/apns', admin, { token, deviceName: 'iPhone-App' })).status, 201);
  });
  after(async () => ctx.cleanup());

  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(cond(), 'Bedingung nicht erreicht');
  };
  const status = async (id: string) => (await ctx.call('GET', `/api/trips/${tripId}`, admin)).body.attachments.find((a: any) => a.id === id).analysisStatus;

  test('answers at once with 202 and "pending", the analysis finishes later', async () => {
    await ctx.call('PATCH', '/api/me/settings', admin, { notifications: { enabled: true } });
    const up = await upload(ctx.app, admin, `/api/trips/${tripId}/documents?background=1`, 'hotel.pdf', 'application/pdf', '%PDF-1.4 x');
    assert.equal(up.status, 202);
    assert.equal(up.body.attachment.analysisStatus, 'pending');
    assert.equal(await status(up.body.attachment.id), 'pending');
    assert.equal(sent.length, 0, 'noch keine Mitteilung');

    release();
    await waitFor(() => sent.length === 1);
    assert.equal(await status(up.body.attachment.id), 'done');
    const m = sent[0]!.message;
    assert.equal(sent[0]!.token, token);
    assert.equal(m.title, '📄 Dokument gelesen');
    assert.equal(m.body, 'hotel.pdf: 1 Vorschlag zum Prüfen.');
    assert.equal(m.url, `/trips/${tripId}`);
    assert.equal(m.documentId, up.body.attachment.id);
    assert.equal(JSON.parse(apnsPayload(m)).documentId, up.body.attachment.id, 'die App bekommt die Dokument-ID');
  });

  test('a failed analysis is reported too', async () => {
    sent.length = 0;
    const up = await upload(ctx.app, admin, `/api/trips/${tripId}/documents?background=1`, 'kaputt.pdf', 'application/pdf', '%PDF-1.4 x');
    assert.equal(up.status, 202);
    release();
    await waitFor(() => sent.length === 1);
    assert.equal(await status(up.body.attachment.id), 'failed');
    assert.equal(sent[0]!.message.title, '📄 Dokument nicht gelesen');
    assert.match(sent[0]!.message.body, /^kaputt\.pdf: /);
  });

  test('no notification when notifications are off for the account, the analysis still runs', async () => {
    sent.length = 0;
    await ctx.call('PATCH', '/api/me/settings', admin, { notifications: { enabled: false } });
    const up = await upload(ctx.app, admin, `/api/trips/${tripId}/documents?background=1`, 'hotel.pdf', 'application/pdf', '%PDF-1.4 x');
    release();
    await waitFor(() => sent.length === 0);
    for (let i = 0; i < 50 && (await status(up.body.attachment.id)) === 'pending'; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(await status(up.body.attachment.id), 'done');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.length, 0);
  });

  test('without ?background the upload still waits for the analysis (web app unchanged)', async () => {
    const pending = upload(ctx.app, admin, `/api/trips/${tripId}/documents`, 'hotel.pdf', 'application/pdf', '%PDF-1.4 x');
    await new Promise((r) => setTimeout(r, 20));
    release();
    const up = await pending;
    assert.equal(up.status, 201);
    assert.equal(up.body.attachment.analysisStatus, 'done');
  });

  test('a file the AI cannot read is stored normally, 201, not pending', async () => {
    const up = await upload(ctx.app, admin, `/api/trips/${tripId}/documents?background=1`, 'tabelle.xlsx', 'application/vnd.ms-excel', 'x');
    assert.equal(up.status, 201);
    assert.equal(up.body.analyzable, false);
    assert.equal(up.body.attachment.analysisStatus, null);
  });
});
