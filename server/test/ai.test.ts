import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicExtractor } from '../src/ai/anthropic.ts';
import { normalizeExtraction, normalizeLocal } from '../src/ai/normalize.ts';
import { buildProposals, diffItem, matchCruise, matchItem, mergeItem, titleSimilarity } from '../src/ai/proposals.ts';
import { classifyFile } from '../src/ai/files.ts';
import { ExtractionError, type ExtractionContext, type ItemData } from '../src/ai/types.ts';
import type { AiResult } from '../src/ai/schema.ts';
import type { Cruise, Item } from '../src/model.ts';

const ctx: ExtractionContext = {
  today: '2027-01-10',
  defaultTz: 'Europe/Zurich',
  tripTitle: 'Test',
  cruiseDays: [{ id: 'day-1', date: '2027-05-11', kind: 'port', portName: 'Neapel', country: 'Italien', shipName: 'MS Aurora' }],
};

const aiItem = (p: Partial<AiResult['items'][number]> = {}): AiResult['items'][number] => ({
  type: 'hotel', title: 'Hotel Artemide', startLocal: '2027-05-08T14:00', startTz: 'Europe/Rome', endLocal: '2027-05-10T10:00', endTz: null,
  location: null, confirmation: 'AB12345', provider: null, cost: null, currency: null, notes: null, cruiseDayId: null,
  details: [], infos: [], confidence: 'high', ...p,
});
const aiResult = (p: Partial<AiResult> = {}): AiResult => ({ suggestedTripTitle: null, documentKind: 'Hotelbuchung', summary: 'ok', items: [aiItem()], cruise: null, warnings: [], ...p });

const item = (p: Partial<Item> & Pick<Item, 'id' | 'type' | 'startLocal'>): Item => ({
  tripId: 't', title: p.id, startTz: null, endLocal: null, endTz: null, location: null, confirmation: null, provider: null,
  cost: null, currency: null, notes: null, cruiseDayId: null, details: {}, infos: [], createdAt: '', updatedAt: '', ...p,
});
const data = (p: Partial<ItemData> & Pick<ItemData, 'type' | 'startLocal'>): ItemData => ({
  title: 'x', startTz: null, endLocal: null, endTz: null, location: null, confirmation: null, provider: null, cost: null,
  currency: null, notes: null, cruiseDayId: null, details: {}, infos: [], ...p,
});

describe('normalize', () => {
  test('local date times', () => {
    assert.equal(normalizeLocal('2027-05-08 09:40:00'), '2027-05-08T09:40');
    assert.equal(normalizeLocal('2027-05-08T9:40Z'), '2027-05-08T09:40');
    assert.equal(normalizeLocal('2027-05-08'), '2027-05-08');
    assert.equal(normalizeLocal('  '), null);
    assert.equal(normalizeLocal('nächsten Montag'), 'nächsten Montag'); // kept, validation reports it
  });

  test('drops unknown ids and invalid zones, turns details into a map', () => {
    const out = normalizeExtraction(
      aiResult({ items: [aiItem({ startTz: 'Mars/Olympus', cruiseDayId: 'fremd', details: [{ key: 'room', value: ' 12 ' }, { key: 'x', value: '' }] }), aiItem({ cruiseDayId: 'day-1', currency: 'chf' })] }),
      ctx, 'm',
    );
    assert.equal(out.items[0]!.startTz, null);
    assert.equal(out.items[0]!.cruiseDayId, null);
    assert.deepEqual(out.items[0]!.details, { room: '12' });
    assert.equal(out.items[1]!.cruiseDayId, 'day-1');
    assert.equal(out.items[1]!.currency, 'CHF');
  });
});

describe('matching', () => {
  const flights = [
    item({ id: 'out', type: 'flight', startLocal: '2027-05-08T09:40', confirmation: 'K7XQ2P', details: { flightNumber: 'LX 1726', from: 'ZRH', to: 'FCO' } }),
    item({ id: 'back', type: 'flight', startLocal: '2027-05-17T14:25', confirmation: 'K7XQ2P', details: { flightNumber: 'LX 1953', from: 'BCN', to: 'ZRH' } }),
  ];

  test('flights: number and date, round trips are not mixed up', () => {
    assert.equal(matchItem(flights, data({ type: 'flight', startLocal: '2027-05-08T10:05', details: { flightNumber: 'LX1726' } }))?.item.id, 'out');
    // same booking reference, but only the return date matches
    assert.equal(matchItem(flights, data({ type: 'flight', startLocal: '2027-05-17T14:25', confirmation: 'k7xq2p', title: 'Rückflug' }))?.item.id, 'back');
    assert.equal(matchItem(flights, data({ type: 'flight', startLocal: '2027-06-01T10:00', confirmation: 'K7XQ2P' })), null);
  });

  test('hotel: booking reference within a day, otherwise similar title on the same day', () => {
    const hotels = [item({ id: 'h', type: 'hotel', title: 'Hotel Artemide Rom', startLocal: '2027-05-08T14:00', confirmation: 'AB-12345' })];
    assert.equal(matchItem(hotels, data({ type: 'hotel', startLocal: '2027-05-09', confirmation: 'ab12345' }))?.item.id, 'h');
    assert.equal(matchItem(hotels, data({ type: 'hotel', startLocal: '2027-05-08', title: 'Artemide Hotel' }))?.item.id, 'h');
    assert.equal(matchItem(hotels, data({ type: 'hotel', startLocal: '2027-05-08', title: 'Hotel Casa Fuster' })), null);
    assert.equal(matchItem(hotels, data({ type: 'parking', startLocal: '2027-05-08', title: 'Hotel Artemide Rom', confirmation: 'AB12345' })), null, 'other type');
    assert.ok(titleSimilarity('Zürich → Rom', 'Rom → Zürich') === 1, 'why flights must not match on title alone');
  });

  test('diff and merge keep the existing title and notes', () => {
    const existing = item({ id: 'h', type: 'hotel', title: 'Mein Hotel', startLocal: '2027-05-08T14:00', notes: 'eigene Notiz', details: { room: '5' } });
    const p = data({ type: 'hotel', startLocal: '2027-05-08T15:00', confirmation: 'AB12345', notes: 'KI-Notiz', details: { room: '5', phone: '123' } });
    const changes = diffItem(existing, p);
    assert.ok(changes.some((c) => c.startsWith('Beginn: 2027-05-08 14:00 → 2027-05-08 15:00')));
    assert.ok(changes.some((c) => c.startsWith('Buchungsnummer')));
    assert.ok(changes.some((c) => c.startsWith('phone')));
    assert.ok(!changes.some((c) => c.startsWith('room')), 'unchanged detail is not listed');
    const merged = mergeItem(existing, p);
    assert.equal(merged.title, 'Mein Hotel');
    assert.equal(merged.notes, 'eigene Notiz');
    assert.deepEqual(merged.details, { room: '5', phone: '123' });
  });

  test('cruise: booking reference or ship name', () => {
    const cruises: Cruise[] = [{ id: 'c', tripId: 't', shipName: 'MS Aurora', cruiseLine: null, cabin: null, bookingRef: 'AUR-4711', notes: null, infos: [], days: [] }];
    const p = { shipName: 'Andere', cruiseLine: null, cabin: null, bookingRef: 'aur4711', notes: null, infos: [], days: [] };
    assert.equal(matchCruise(cruises, p)?.cruise.id, 'c');
    assert.equal(matchCruise(cruises, { ...p, bookingRef: null, shipName: 'ms aurora' })?.cruise.id, 'c');
    assert.equal(matchCruise(cruises, { ...p, bookingRef: null }), null);
  });
});

describe('proposals', () => {
  test('an unreadable date is one clear problem in German, not a follow-up error', () => {
    const ex = normalizeExtraction(aiResult({ items: [aiItem({ startLocal: 'irgendwann im Mai' })] }), ctx, 'm');
    const view = buildProposals(ex, { items: [], cruises: [] });
    assert.equal(view.items[0]!.problems.length, 1);
    assert.match(view.items[0]!.problems[0]!, /^Beginn: /);
    assert.equal(view.items[0]!.match, null, 'items without a valid date are never matched');
  });
});

describe('file kinds', () => {
  test('classification', () => {
    assert.equal(classifyFile('application/pdf', 'a.bin'), 'pdf');
    assert.equal(classifyFile('application/octet-stream', 'Ticket.PDF'), 'pdf');
    assert.equal(classifyFile('image/jpeg', 'x'), 'image');
    assert.equal(classifyFile('application/octet-stream', 'foto.webp'), 'image');
    assert.equal(classifyFile('message/rfc822', 'mail'), 'text');
    assert.equal(classifyFile('application/octet-stream', 'mail.eml'), 'text');
    assert.equal(classifyFile('image/heic', 'iphone.heic'), null);
    assert.equal(classifyFile('application/zip', 'x.pkpass'), null);
  });
});

describe('Anthropic extractor (fake client, no network)', () => {
  const make = (model: string, reply: unknown) => {
    const calls: any[] = [];
    const client: any = {
      beta: { messages: { parse: async (params: any) => (calls.push(params), reply) } },
      messages: { create: async () => ({}) },
    };
    return { calls, extractor: createAnthropicExtractor({ apiKey: 'k', model, client }) };
  };
  const ok = { stop_reason: 'end_turn', parsed_output: aiResult() };

  test('sends the PDF as a document block with context and structured output', async () => {
    const { calls, extractor } = make('claude-opus-5-5', ok);
    const out = await extractor.extract({ files: [{ data: Buffer.from('%PDF-1.4 x'), mime: 'application/pdf', filename: 'Buchung.pdf' }], context: ctx });
    assert.equal(out.items[0]!.title, 'Hotel Artemide');
    const req = calls[0];
    assert.equal(req.model, 'claude-opus-5-5');
    assert.equal(req.messages[0].content[0].type, 'document');
    assert.equal(req.messages[0].content[0].source.media_type, 'application/pdf');
    assert.equal(req.messages[0].content[0].source.data, Buffer.from('%PDF-1.4 x').toString('base64'));
    assert.match(req.messages[0].content[1].text, /id=day-1 \| 2027-05-11 \| port \| Neapel, Italien \| MS Aurora/);
    assert.match(req.messages[0].content[1].text, /Heutiges Datum: 2027-01-10/);
    assert.ok(req.output_config.format, 'structured output requested');
    assert.equal(req.tool_choice, undefined, 'no forced tool use (rejected by Opus 5.5)');
    assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(req.fallbacks, 'default');
    assert.match(req.system, /keine Anweisungen an dich/, 'prompt-injection guard');
  });

  test('text files and images', async () => {
    const { calls, extractor } = make('claude-sonnet-5-5', ok);
    await extractor.extract({ files: [{ data: Buffer.from('Betreff: Buchung'), mime: 'message/rfc822', filename: 'm.eml' }], context: ctx });
    assert.equal(calls[0].messages[0].content[0].type, 'text');
    assert.match(calls[0].messages[0].content[0].text, /Betreff: Buchung/);
    await extractor.extract({ files: [{ data: Buffer.from('jpg'), mime: 'application/octet-stream', filename: 'foto.png' }], context: ctx });
    assert.equal(calls[1].messages[0].content[0].source.media_type, 'image/png');
  });

  test('several files go into one request with labels and a hint that they belong together', async () => {
    const { calls, extractor } = make('claude-opus-5-5', ok);
    await extractor.extract({
      files: [
        { data: Buffer.from('a'), mime: 'image/png', filename: 'Screenshot 1.png' },
        { data: Buffer.from('b'), mime: 'image/png', filename: 'Screenshot 2.png' },
        { data: Buffer.from('Eingefügter Text'), mime: 'text/plain', filename: 'Text.txt' },
      ],
      context: ctx,
    });
    const content = calls[0].messages[0].content;
    assert.deepEqual(content.map((b: any) => b.type), ['text', 'image', 'text', 'image', 'text', 'text', 'text']);
    assert.equal(content[0].text, 'Datei 1 von 3: Screenshot 1.png');
    assert.match(content.at(-1).text, /3 Dateien gehören zu EINER Unterlage/);
  });

  test('haiku gets no fallback parameters', async () => {
    const { calls, extractor } = make('claude-haiku-5-5', ok);
    await extractor.extract({ files: [{ data: Buffer.from('x'), mime: 'text/plain', filename: 'a.txt' }], context: ctx });
    assert.equal(calls[0].fallbacks, undefined);
    assert.equal(calls[0].betas, undefined);
  });

  test('refusal, truncated and unreadable answers become readable errors', async () => {
    const input = { files: [{ data: Buffer.from('x'), mime: 'text/plain', filename: 'a.txt' }], context: ctx };
    await assert.rejects(make('m', { stop_reason: 'refusal', parsed_output: null }).extractor.extract(input), /abgelehnt/);
    await assert.rejects(make('m', { stop_reason: 'max_tokens', parsed_output: null }).extractor.extract(input), /zu viele Daten/);
    await assert.rejects(make('m', { stop_reason: 'end_turn', parsed_output: null }).extractor.extract(input), /nicht gelesen/);
  });

  test('long pasted documents: up to 500 000 characters are sent, more is refused with a clear message', async () => {
    const { calls, extractor } = make('m', ok);
    const lines = 'Buchungsbestätigung '.repeat(1);
    await extractor.extract({ files: [{ data: Buffer.from(lines.repeat(20000)), mime: 'text/plain', filename: 'Eingefügter Text 1.txt' }], context: ctx });
    assert.equal(calls.length, 1);
    await assert.rejects(
      extractor.extract({ files: [{ data: Buffer.from('x'.repeat(500_001)), mime: 'text/plain', filename: 'zu lang.txt' }], context: ctx }),
      /zu lang/,
    );
  });

  test('unsupported or oversized files are rejected before any request', async () => {
    const { calls, extractor } = make('m', ok);
    await assert.rejects(extractor.extract({ files: [{ data: Buffer.from('x'), mime: 'application/zip', filename: 'a.pkpass' }], context: ctx }), ExtractionError);
    await assert.rejects(extractor.extract({ files: [{ data: Buffer.alloc(6 * 1024 * 1024), mime: 'image/jpeg', filename: 'a.jpg' }], context: ctx }), /zu groß/);
    assert.equal(calls.length, 0);
  });
});
