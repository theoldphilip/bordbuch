import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicExtractor, REVIEW_PROMPT } from '../src/ai/anthropic.ts';
import { cleanReview, tripOutline, type ReviewInput, type ReviewModelOutput } from '../src/ai/review.ts';
import { ExtractionError, type Extractor } from '../src/ai/types.ts';
import { setup } from './helpers.ts';

const finding = (over: Partial<ReviewModelOutput['findings'][number]> = {}): ReviewModelOutput['findings'][number] => ({
  severity: 'warning', title: 'Keine Rückreise', text: 'Nach dem 13. Mai gibt es keinen Eintrag.', itemIds: [], dayIds: [], suggestion: 'Rückflug anlegen', ...over,
});

describe('review: cleaning and outline', () => {
  test('unknown ids are dropped, findings sorted by severity, lengths capped, empty ones removed', () => {
    const out = cleanReview(
      {
        summary: '  Gesamteindruck  ',
        findings: [
          finding({ severity: 'hint', title: 'Frage', itemIds: ['a', 'zz'], dayIds: ['d1', 'nope'] }),
          finding({ severity: 'error', title: 'Fehler', text: 'x'.repeat(2000) }),
          finding({ title: '', text: 'ohne Titel' }),
          finding({ suggestion: '   ' }),
        ],
      },
      new Set(['a']), new Set(['d1']),
    );
    assert.equal(out.summary, 'Gesamteindruck');
    assert.deepEqual(out.findings.map((f) => f.severity), ['error', 'warning', 'hint']);
    assert.equal(out.findings[0]!.text.length, 700);
    assert.deepEqual(out.findings[2]!.itemIds, ['a']);
    assert.deepEqual(out.findings[2]!.dayIds, ['d1']);
    assert.equal(out.findings[1]!.suggestion, null);
  });

  test('the outline carries times and ids, but no booking numbers, prices, phone numbers, seats or rooms', () => {
    const item: any = {
      id: 'i1', tripId: 't', type: 'hotel', title: 'Hotel Artemide', startLocal: '2027-05-08T14:00', startTz: 'Europe/Rome', endLocal: '2027-05-10T10:00', endTz: null,
      location: 'Via Nazionale 22', confirmation: 'GEHEIM123', provider: 'Artemide', cost: 410, currency: 'EUR', notes: 'Check-in bis 22 Uhr', cruiseDayId: null,
      details: { room: '1204', phone: '+39 06 111', breakfast: 'ja', seat: '12A' }, infos: [{ label: 'Rezeption', value: '+39 06 999', kind: 'phone', source: 'user' }],
    };
    const text = tripOutline([], [item], [{ level: 'warning', code: 'x', message: 'Puffer knapp' }]);
    assert.match(text, /item i1: hotel \| Hotel Artemide \| 2027-05-08T14:00 \(Europe\/Rome\) → 2027-05-10T10:00/);
    assert.match(text, /breakfast=ja/);
    assert.match(text, /Notiz: Check-in bis 22 Uhr/);
    assert.match(text, /Puffer knapp/);
    for (const secret of ['GEHEIM123', '410', '1204', '+39 06 111', '+39 06 999', '12A', 'Rezeption']) assert.ok(!text.includes(secret), `${secret} must not be sent`);
  });
});

describe('review: Anthropic extractor (fake client)', () => {
  test('sends the outline with the review prompt as structured output, handles refusal and truncation', async () => {
    const calls: any[] = [];
    const reply: any = { stop_reason: 'end_turn', parsed_output: { summary: 's', findings: [] } };
    const client: any = { messages: { create: async () => ({}) }, beta: { messages: { parse: async (p: any) => (calls.push(p), reply) } } };
    const ex = createAnthropicExtractor({ apiKey: 'k', model: 'claude-opus-5-5', client });
    const out = await ex.review!({ outline: 'item i1: hotel', today: '2027-01-01', tripTitle: 'Mittelmeer' });
    assert.deepEqual(out, { summary: 's', findings: [] });
    assert.equal(calls[0].system, REVIEW_PROMPT);
    assert.match(calls[0].messages[0].content, /item i1: hotel/);
    assert.ok(calls[0].output_config.format, 'structured output');
    assert.equal(calls[0].tools, undefined, 'no web access for the review');
    reply.stop_reason = 'refusal';
    await assert.rejects(ex.review!({ outline: 'x', today: 't', tripTitle: 'm' }), ExtractionError);
    reply.stop_reason = 'max_tokens';
    await assert.rejects(ex.review!({ outline: 'x', today: 't', tripTitle: 'm' }), /zu umfangreich/);
  });
});

describe('review: routes', () => {
  let mode: 'ok' | 'fail' = 'ok';
  const inputs: ReviewInput[] = [];
  let itemId = '';
  const extractor: Extractor = {
    model: 'fake-model',
    async extract() { throw new ExtractionError('nicht benötigt'); },
    async review(input) {
      inputs.push(input);
      if (mode === 'fail') throw new ExtractionError('Test: Prüfung kaputt');
      return { summary: 'Reise wirkt schlüssig bis auf die Rückreise.', findings: [finding({ severity: 'error', itemIds: [itemId, 'erfunden'] })] };
    },
    async check() {},
  };
  let c: Awaited<ReturnType<typeof setup>>;
  let admin = '';
  let viewer = '';
  let tripId = '';
  before(async () => {
    c = await setup({ extractor });
    admin = (await c.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
    const anna = await c.call('POST', '/api/users', admin, { username: 'anna', displayName: 'Anna', password: 'annapass1' });
    viewer = (await c.call('POST', '/api/auth/login', undefined, { username: 'anna', password: 'annapass1' })).body.token;
    tripId = (await c.call('POST', '/api/trips', admin, { title: 'Mittelmeer' })).body.trip.id;
    await c.call('PUT', `/api/trips/${tripId}/members/${anna.body.id}`, admin, { role: 'viewer' });
  });
  after(async () => c.cleanup());

  const waitDone = async () => {
    for (let i = 0; i < 50; i++) {
      const r = (await c.call('GET', `/api/trips/${tripId}/review`, admin)).body;
      if (r.review && r.review.status !== 'pending') return r;
      await new Promise((res) => setTimeout(res, 20));
    }
    throw new Error('Prüfung wurde nicht fertig');
  };

  test('status endpoint announces the review', async () => {
    assert.equal((await c.call('GET', '/api/ai/status', admin)).body.review, true);
  });

  test('an empty trip has nothing to review; no result yet', async () => {
    assert.deepEqual((await c.call('GET', `/api/trips/${tripId}/review`, admin)).body, { review: null, stale: false });
    assert.equal((await c.call('POST', `/api/trips/${tripId}/review`, admin)).status, 400);
  });

  test('start → findings with valid ids only → stale after a change; viewers read but cannot start', async () => {
    itemId = (await c.call('POST', `/api/trips/${tripId}/items`, admin, { type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T09:40', startTz: 'Europe/Zurich', endLocal: '2027-05-09T11:15', endTz: 'Europe/Rome', confirmation: 'K7XQ2P' })).body.id;
    assert.equal((await c.call('POST', `/api/trips/${tripId}/review`, viewer)).status, 403);
    const start = await c.call('POST', `/api/trips/${tripId}/review`, admin);
    assert.equal(start.status, 202);
    assert.equal(start.body.review.status, 'pending');
    const done = await waitDone();
    assert.equal(done.review.status, 'done');
    assert.equal(done.stale, false);
    assert.deepEqual(done.review.findings[0].itemIds, [itemId], 'invented id dropped');
    assert.match(inputs[0]!.outline, new RegExp(`item ${itemId}: flight`));
    assert.ok(!inputs[0]!.outline.includes('K7XQ2P'), 'booking number is not sent');
    assert.equal((await c.call('GET', `/api/trips/${tripId}/review`, viewer)).status, 200, 'viewers can read the result');

    await c.call('PATCH', `/api/items/${itemId}`, admin, { title: 'Zürich → Rom (neu)' });
    assert.equal((await c.call('GET', `/api/trips/${tripId}/review`, admin)).body.stale, true, 'outdated once the trip changed');
  });

  test('a failure is stored readable and can be retried', async () => {
    mode = 'fail';
    await c.call('POST', `/api/trips/${tripId}/review`, admin);
    const failed = await waitDone();
    assert.equal(failed.review.status, 'failed');
    assert.match(failed.review.error, /Prüfung kaputt/);
    mode = 'ok';
    await c.call('POST', `/api/trips/${tripId}/review`, admin);
    assert.equal((await waitDone()).review.status, 'done');
  });

  test('without the AI feature the endpoint says so', async () => {
    const plain = await setup({ extractor: null });
    try {
      const t = (await plain.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
      const id = (await plain.call('POST', '/api/trips', t, { title: 'x' })).body.trip.id;
      await plain.call('POST', `/api/trips/${id}/items`, t, { type: 'note', title: 'n', startLocal: '2027-05-10' });
      assert.equal((await plain.call('POST', `/api/trips/${id}/review`, t)).status, 409);
    } finally {
      await plain.cleanup();
    }
  });
});
