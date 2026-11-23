import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicExtractor, webFetchTool, webSearchTool } from '../src/ai/anthropic.ts';
import { acceptSuggestions, cleanResearch, type ResearchModelOutput } from '../src/ai/research.ts';
import { normalizeExtraction } from '../src/ai/normalize.ts';
import type { AiResult } from '../src/ai/schema.ts';
import { ExtractionError, type Extractor, type NormalizedExtraction } from '../src/ai/types.ts';
import { setup, upload } from './helpers.ts';

const ctx0 = { today: '2027-01-01', defaultTz: 'Europe/Zurich', tripTitle: 'Mittelmeer', cruiseDays: [] };
const ai: AiResult = {
  suggestedTripTitle: null, documentKind: 'Hotelbuchung', summary: 's', warnings: [], cruise: null,
  items: [{
    type: 'hotel', title: 'Hotel Artemide', startLocal: '2027-05-08T14:00', startTz: null, endLocal: null, endTz: null, location: null,
    confirmation: 'AB12345', provider: null, cost: null, currency: null, paymentStatus: null, paidAmount: null, dueDate: null, notes: 'Frühstück inklusive', cruiseDayId: null, details: [{ key: 'room', value: '12' }],
    infos: [], confidence: 'high',
  }],
};
const analysis = (): NormalizedExtraction => normalizeExtraction(ai, ctx0, 'm');

const raw = (over: Record<string, unknown> = {}) => ({
  target: 'item' as const, index: 0, title: 'Anreise vom Flughafen', fields: [{ field: 'location', value: 'Via Nazionale 22, Rom' }],
  details: [{ key: 'room', value: '99' }, { key: 'phone', value: '+39 06 489911' }],
  infos: [{ label: 'Rezeption', value: '+39 06 489911', kind: 'phone' as const }], note: 'Leonardo Express, ca. 32 Min', sourceUrls: ['https://example.org/a'], ...over,
});
const found = [{ title: 'Seite A', url: 'https://example.org/a' }];

describe('research: cleaning and merging', () => {
  test('a suggestion needs a source that really came from the search; bad targets and values are dropped', () => {
    const out = cleanResearch(
      {
        summary: 'x',
        route: null,
        suggestions: [
          raw(),
          raw({ sourceUrls: ['https://erfunden.example/'] }),
          raw({ index: 7 }),
          raw({ fields: [{ field: 'startTz', value: 'Mars/Olympus' }, { field: 'cost', value: '5' }], details: [], infos: [], note: null }),
        ],
      },
      found, analysis(), 3,
    );
    assert.equal(out.suggestions.length, 1);
    assert.equal(out.searches, 3);
    assert.equal(out.suggestions[0]!.infos[0]!.source, 'web');
    assert.deepEqual(out.suggestions[0]!.sources, found);
  });

  test('accepting fills gaps only: existing values, details and notes survive, the source is noted', () => {
    const a = analysis();
    a.items[0]!.location = 'Rom (aus dem Dokument)';
    const out = cleanResearch({ summary: 's', route: null, suggestions: [raw({ fields: [{ field: 'location', value: 'andere Adresse' }, { field: 'provider', value: 'Artemide Hotels' }] })] }, found, a, 1);
    a.research = { status: 'done', startedAt: 'x', suggestions: out.suggestions.map((s, n) => ({ ...s, id: `s${n}` })) };
    assert.equal(acceptSuggestions(a, ['s0']), 1);
    const item = a.items[0]!;
    assert.equal(item.location, 'Rom (aus dem Dokument)', 'existing value kept');
    assert.equal(item.provider, 'Artemide Hotels', 'gap filled');
    assert.equal(item.details.room, '12', 'existing detail kept');
    assert.equal(item.details.phone, '+39 06 489911');
    assert.equal(item.infos[0]!.source, 'web');
    assert.match(item.notes!, /^Frühstück inklusive\n\nRecherche: Leonardo Express.*Quelle: https:\/\/example\.org\/a/s);
    assert.equal(acceptSuggestions(a, ['s0']), 0, 'accepting twice does nothing');
    assert.equal(acceptSuggestions(a, ['unbekannt']), 0);
  });
});

describe('research: Anthropic extractor (fake client)', () => {
  const searchResult = { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.org/a', title: 'Seite A' }] };
  const make = (model: string, replies: any[], parsed: unknown) => {
    const created: any[] = [];
    const parsedCalls: any[] = [];
    const client: any = {
      messages: { create: async (p: any) => (created.push(structuredClone(p)), replies.shift()) },
      beta: { messages: { parse: async (p: any) => (parsedCalls.push(p), { stop_reason: 'end_turn', parsed_output: parsed }) } },
    };
    return { created, parsedCalls, extractor: createAnthropicExtractor({ apiKey: 'k', model, client }) };
  };

  test('continues a paused search, then structures the notes; only real result URLs count', async () => {
    const { created, parsedCalls, extractor } = make(
      'claude-opus-5-5',
      [
        { stop_reason: 'pause_turn', content: [searchResult], usage: { server_tool_use: { web_search_requests: 2 } } },
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'item 0: Leonardo Express, https://example.org/a' }], usage: { server_tool_use: { web_search_requests: 1 } } },
      ],
      { summary: 'ok', route: null, suggestions: [raw(), raw({ sourceUrls: ['https://nicht-gesucht.example/'] })] },
    );
    const out = await extractor.research!({ analysis: analysis(), context: ctx0 });
    assert.equal(created.length, 2, 'second call continues the paused turn');
    assert.equal(created[1].messages.at(-1).role, 'assistant');
    assert.equal(created[0].tools[0].type, 'web_search_20260209');
    assert.equal(out.searches, 3);
    assert.equal(out.suggestions.length, 1);
    assert.equal(parsedCalls.length, 1);
    assert.match(parsedCalls[0].messages[0].content, /Leonardo Express/);
  });

  test('older models use the basic search tool; nothing found means no second call', async () => {
    assert.equal(webSearchTool('claude-haiku-5-5').type, 'web_search_20250305');
    assert.equal(webSearchTool('claude-sonnet-5-5').type, 'web_search_20260209');
    const { parsedCalls, extractor } = make('claude-haiku-5-5', [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nichts gefunden' }], usage: {} }], null);
    const out = await extractor.research!({ analysis: analysis(), context: ctx0 });
    assert.deepEqual(out.suggestions, []);
    assert.equal(parsedCalls.length, 0);
  });

  test('a refusal is a readable error', async () => {
    const { extractor } = make('claude-opus-5-5', [{ stop_reason: 'refusal', content: [], usage: {} }], null);
    await assert.rejects(extractor.research!({ analysis: analysis(), context: ctx0 }), ExtractionError);
  });
});

const routeOut = (over: Record<string, unknown> = {}): ResearchModelOutput => ({
  summary: 'Reiseverlauf gefunden',
  suggestions: [],
  route: {
    shipName: 'MS Aurora', cruiseLine: 'Beispiel-Reederei', sourceUrls: ['https://example.org/a'],
    days: [
      { date: '2027-05-12', kind: 'sea', portName: null, country: null, timezone: null, arrival: null, departure: null, allAboard: null, tender: false },
      { date: '2027-05-11', kind: 'port', portName: 'Neapel', country: 'Italien', timezone: 'Europe/Rome', arrival: '7:00', departure: '17:00', allAboard: '16:30', tender: false },
      { date: '2027-05-11', kind: 'port', portName: 'Neapel', country: 'Italien', timezone: null, arrival: null, departure: null, allAboard: null, tender: false },
      { date: '31.05.2027', kind: 'port', portName: 'Kaputt', country: null, timezone: null, arrival: null, departure: null, allAboard: null, tender: false },
      { date: '2027-05-10', kind: 'embarkation', portName: 'Civitavecchia', country: 'Italien', timezone: 'Mars/Olympus', arrival: '12:00', departure: '25:99', allAboard: null, tender: false },
    ],
    ...over,
  },
});
const cruiseAnalysis = (): NormalizedExtraction => {
  const a = analysis();
  a.cruise = { shipName: 'MS Aurora', cruiseLine: null, cabin: '8142', bookingRef: null, notes: null, infos: [], days: [
    { date: '2027-05-11', kind: 'port', portName: 'Neapel', country: null, timezone: null, arrival: '08:00', departure: null, allAboard: null, tender: false, notes: null, infos: [] },
  ] };
  return a;
};

describe('research: itinerary (route mode)', () => {
  test('valid days only, sorted, deduplicated; needs a real source', () => {
    const out = cleanResearch(routeOut(), found, cruiseAnalysis(), 2);
    assert.equal(out.suggestions.length, 1);
    const route = out.suggestions[0]!.route!;
    assert.deepEqual(route.days.map((d) => d.date), ['2027-05-10', '2027-05-11', '2027-05-12']);
    assert.equal(route.days[1]!.arrival, '07:00', 'times are normalised');
    assert.equal(route.days[0]!.timezone, null, 'invalid zone dropped');
    assert.equal(route.days[0]!.departure, null, 'invalid time dropped');
    assert.deepEqual(out.diagnostics!.droppedNoSource, 0);

    const none = cleanResearch(routeOut({ sourceUrls: ['https://erfunden.example/'] }), found, cruiseAnalysis(), 2);
    assert.equal(none.suggestions.length, 0);
    assert.equal(none.diagnostics!.droppedNoSource, 1, 'the reason is recorded');
  });

  test('accepting adds missing days, fills only gaps in existing ones, and can create the cruise', () => {
    const a = cruiseAnalysis();
    const out = cleanResearch(routeOut(), found, a, 2);
    a.research = { status: 'done', startedAt: 'x', suggestions: out.suggestions.map((s, n) => ({ ...s, id: `r${n}` })) };
    assert.equal(acceptSuggestions(a, ['r0']), 1);
    assert.deepEqual(a.cruise!.days.map((d) => d.date), ['2027-05-10', '2027-05-11', '2027-05-12']);
    const naples = a.cruise!.days[1]!;
    assert.equal(naples.arrival, '08:00', 'the document wins');
    assert.equal(naples.departure, '17:00', 'gap filled');
    assert.equal(naples.country, 'Italien');
    assert.equal(a.cruise!.cabin, '8142');
    assert.equal(a.cruise!.cruiseLine, 'Beispiel-Reederei');
    assert.match(a.cruise!.notes!, /Reiseverlauf \(3 Tage\).*Quelle/);

    // A document without any cruise: the itinerary creates it (ship name comes from the research).
    const b = analysis();
    const out2 = cleanResearch(routeOut(), found, b, 1);
    b.research = { status: 'done', startedAt: 'x', suggestions: out2.suggestions.map((s, n) => ({ ...s, id: `q${n}` })) };
    assert.equal(acceptSuggestions(b, ['q0']), 1);
    assert.equal(b.cruise!.shipName, 'MS Aurora');
    assert.equal(b.cruise!.days.length, 3);
    // Without any ship name there is nothing to attach days to.
    const c = analysis();
    assert.equal(cleanResearch(routeOut({ shipName: null }), found, c, 1).suggestions.length, 0);
  });

  test('extractor: a given page is fetched and counts as a source; diagnostics list queries and notes', async () => {
    const created: any[] = [];
    const parseCalls: any[] = [];
    const client: any = {
      messages: {
        create: async (p: any) => (created.push(structuredClone(p)), {
          stop_reason: 'end_turn', usage: { server_tool_use: { web_search_requests: 1 } },
          content: [
            { type: 'server_tool_use', name: 'web_search', input: { query: 'MS Aurora Reiseverlauf 10. Mai 2027' } },
            { type: 'server_tool_use', name: 'web_fetch', input: { url: 'https://reederei.example/route' } },
            { type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url: 'https://reederei.example/route', content: {} } },
            { type: 'text', text: 'Route laut https://reederei.example/route: ...' },
          ],
        }),
      },
      beta: { messages: { parse: async (p: any) => (parseCalls.push(p), { stop_reason: 'end_turn', parsed_output: routeOut({ sourceUrls: ['https://reederei.example/route'] }) }) } },
    };
    const extractor = createAnthropicExtractor({ apiKey: 'k', model: 'claude-opus-5-5', client });
    const out = await extractor.research!({ analysis: cruiseAnalysis(), context: ctx0, mode: 'route', url: 'https://reederei.example/route' });
    assert.deepEqual(created[0].tools.map((t: any) => t.name), ['web_search', 'web_fetch']);
    assert.equal(created[0].tools[1].type, webFetchTool('claude-opus-5-5').type);
    assert.match(created[0].messages[0].content, /REISEVERLAUF/);
    assert.match(created[0].messages[0].content, /https:\/\/reederei\.example\/route/);
    assert.match(parseCalls[0].messages[0].content, /Modus: Reiseverlauf/);
    assert.equal(out.suggestions.length, 1);
    assert.deepEqual(out.diagnostics!.queries, ['MS Aurora Reiseverlauf 10. Mai 2027']);
    assert.deepEqual(out.diagnostics!.fetched, ['https://reederei.example/route']);
    assert.match(out.diagnostics!.notes, /Route laut/);

    // Without a page: no fetch tool.
    created.length = 0;
    await extractor.research!({ analysis: cruiseAnalysis(), context: ctx0, mode: 'gaps' });
    assert.deepEqual(created[0].tools.map((t: any) => t.name), ['web_search']);
  });

  test('text but no checkable source: no suggestions, a clear reason and the notes for inspection', async () => {
    const client: any = {
      messages: { create: async () => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'Ich habe die Route gefunden: ...' }] }) },
      beta: { messages: { parse: async () => { throw new Error('must not be called'); } } },
    };
    const out = await createAnthropicExtractor({ apiKey: 'k', model: 'claude-opus-5-5', client }).research!({ analysis: analysis(), context: ctx0, mode: 'route' });
    assert.equal(out.suggestions.length, 0);
    assert.match(out.summary, /keine prüfbaren Quellen/);
    assert.match(out.diagnostics!.notes, /Route gefunden/);
  });
});

describe('research: routes', () => {
  let calls = 0;
  let mode: 'ok' | 'fail' = 'ok';
  const extractor: Extractor = {
    model: 'fake-model',
    async extract() { return ai; },
    async research({ analysis: a }) {
      calls++;
      if (mode === 'fail') throw new ExtractionError('Test: Recherche kaputt');
      assert.equal(a.research, undefined, 'the model never sees earlier research');
      return { summary: 'Route gefunden', searches: 2, suggestions: [{ target: { kind: 'item', index: 0 }, title: 'Anreise', fields: [{ field: 'provider', value: 'Artemide Hotels' }], details: [], infos: [], note: 'Express ab Flughafen', sources: found }] };
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

  const doc = async () => (await upload(c.app, admin, `/api/trips/${tripId}/documents`, 'hotel.pdf', 'application/pdf', '%PDF-1.4 x')).body.attachment.id as string;
  const waitDone = async (id: string) => {
    for (let i = 0; i < 50; i++) {
      const r = (await c.call('GET', `/api/attachments/${id}/research`, admin)).body.research;
      if (r && r.status !== 'pending') return r;
      await new Promise((res) => setTimeout(res, 20));
    }
    throw new Error('Recherche wurde nicht fertig');
  };

  test('start → review → accept flows into the proposal; apply stores it; viewers cannot start', async () => {
    const id = await doc();
    assert.equal((await c.call('GET', `/api/attachments/${id}/research`, admin)).body.research, null);
    assert.equal((await c.call('POST', `/api/attachments/${id}/research`, viewer)).status, 403);
    const start = await c.call('POST', `/api/attachments/${id}/research`, admin);
    assert.equal(start.status, 202);
    const done = await waitDone(id);
    assert.equal(done.status, 'done');
    assert.equal(done.suggestions.length, 1);

    // Nothing changed yet: the proposal still has the document's data only.
    const before = (await c.call('GET', `/api/attachments/${id}/analysis`, admin)).body;
    assert.equal(before.items[0].data.provider, null);
    assert.equal(before.research.suggestions[0].id, done.suggestions[0].id);

    assert.equal((await c.call('POST', `/api/attachments/${id}/research/accept`, viewer, { ids: [done.suggestions[0].id] })).status, 403);
    assert.equal((await c.call('POST', `/api/attachments/${id}/research/accept`, admin, { ids: ['gibtsnicht'] })).status, 400);
    assert.equal((await c.call('POST', `/api/attachments/${id}/research/accept`, admin, { ids: [done.suggestions[0].id] })).status, 200);

    const after = (await c.call('GET', `/api/attachments/${id}/analysis`, admin)).body;
    assert.equal(after.items[0].data.provider, 'Artemide Hotels');
    assert.match(after.items[0].data.notes, /Express ab Flughafen/);
    assert.equal(after.research.suggestions[0].accepted, true);

    const applied = await c.call('POST', `/api/attachments/${id}/apply`, admin, { items: [{ action: 'create', data: after.items[0].data }] });
    assert.equal(applied.status, 200);
    const item = (await c.call('GET', `/api/trips/${tripId}`, admin)).body.items.find((i: any) => i.title === 'Hotel Artemide');
    assert.equal(item.provider, 'Artemide Hotels');
    assert.equal((await c.call('POST', `/api/attachments/${id}/research`, admin)).status, 409, 'applied documents cannot be researched');
  });

  test('a failure is stored readable and can be retried; dismiss removes the research', async () => {
    const id = await doc();
    mode = 'fail';
    await c.call('POST', `/api/attachments/${id}/research`, admin);
    const failed = await waitDone(id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /Recherche kaputt/);
    mode = 'ok';
    const before = calls;
    await c.call('POST', `/api/attachments/${id}/research`, admin);
    assert.equal((await waitDone(id)).status, 'done');
    assert.equal(calls, before + 1);
    assert.equal((await c.call('POST', `/api/attachments/${id}/research/dismiss`, admin)).status, 200);
    assert.equal((await c.call('GET', `/api/attachments/${id}/research`, admin)).body.research, null);
  });

  test('start options: mode and page are passed through and shown, bad addresses are rejected', async () => {
    const seen: any[] = [];
    const orig = extractor.research!;
    (extractor as any).research = async (input: any) => (seen.push({ mode: input.mode, url: input.url }), orig.call(extractor, input));
    try {
      const id = await doc();
      const bad = await c.call('POST', `/api/attachments/${id}/research`, admin, { mode: 'route', url: 'javascript:alert(1)' });
      assert.equal(bad.status, 400);
      assert.equal((await c.call('POST', `/api/attachments/${id}/research`, admin, { mode: 'quatsch' })).status, 400);
      const ok = await c.call('POST', `/api/attachments/${id}/research`, admin, { mode: 'route', url: 'https://reederei.example/route' });
      assert.equal(ok.status, 202);
      assert.equal(ok.body.research.mode, 'route');
      const done = await waitDone(id);
      assert.deepEqual(seen, [{ mode: 'route', url: 'https://reederei.example/route' }]);
      assert.equal(done.mode, 'route');
      assert.equal(done.url, 'https://reederei.example/route');
    } finally {
      (extractor as any).research = orig;
    }
  });
});
