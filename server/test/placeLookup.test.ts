import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicExtractor } from '../src/ai/anthropic.ts';
import { cleanPlaceFindings, describeForLookup, type PlaceLookupInput } from '../src/ai/placeLookup.ts';
import type { Extractor } from '../src/ai/types.ts';
import { PLACE_FIELDS } from '../src/place.ts';
import { setup } from './helpers.ts';

const flightFields = PLACE_FIELDS.flight!;
const found = [{ title: 'Abflüge Flughafen Zürich', url: 'https://flughafen.example/abfluege' }];

describe('place lookup: cleaning', () => {
  test('only wanted fields, short values and sources that really came from the search', () => {
    const out = cleanPlaceFindings(
      {
        summary: 'Gate gefunden.',
        findings: [
          { key: 'gate', value: ' B12 ', sourceUrl: 'https://flughafen.example/abfluege', note: 'Stand 07:42' },
          { key: 'gate', value: 'B14', sourceUrl: 'https://flughafen.example/abfluege', note: null },
          { key: 'checkinDesk', value: '31–40', sourceUrl: 'https://erfunden.example/', note: null },
          { key: 'seat', value: '12A', sourceUrl: 'https://flughafen.example/abfluege', note: null },
          { key: 'baggageBelt', value: 'noch nicht bekannt', sourceUrl: 'https://flughafen.example/abfluege', note: null },
          { key: 'terminal', value: '1', sourceUrl: 'https://flughafen.example/abfluege', note: null },
        ],
      },
      flightFields, found,
    );
    assert.deepEqual(out.findings.map((f) => [f.key, f.value]), [['gate', 'B12'], ['terminal', '1']]);
    assert.equal(out.findings[0]!.note, 'Stand 07:42');
    assert.deepEqual(out.findings[0]!.source, found[0]);
  });

  test('the model only gets what identifies the flight, never a booking number', () => {
    const input: PlaceLookupInput = {
      now: '2027-05-09 06:10 (Europe/Zurich)',
      item: { type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T09:40', startTz: 'Europe/Zurich', endLocal: null, provider: 'SWISS', location: null, details: { flightNumber: 'LX 1726', from: 'ZRH', to: 'FCO', terminal: '1' } },
      fields: flightFields,
    };
    const text = describeForLookup(input);
    assert.match(text, /flightNumber: LX 1726/);
    assert.match(text, /Terminal: 1 \(bisher eingetragen\)/);
    assert.match(text, /gate = Gate/);
    assert.doesNotMatch(text, /K7XQ2P|confirmation/);
  });
});

describe('place lookup: Anthropic call (fake client, no network)', () => {
  test('searches with web search and fetch, follows pause_turn, keeps only sourced findings', async () => {
    const created: any[] = [];
    const replies = [
      { stop_reason: 'pause_turn', usage: { server_tool_use: { web_search_requests: 1 } }, content: [{ type: 'server_tool_use', name: 'web_search', input: { query: 'LX 1726 Zürich Abflug Gate 9. Mai' } }] },
      {
        stop_reason: 'end_turn', usage: { server_tool_use: { web_search_requests: 1 } },
        content: [
          { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://flughafen.example/abfluege', title: 'Abflüge' }] },
          { type: 'text', text: 'Gate B12 laut Abflugtafel (https://flughafen.example/abfluege), Schalter nicht gefunden.' },
        ],
      },
    ];
    const parseCalls: any[] = [];
    const client: any = {
      messages: { create: async (p: any) => (created.push(structuredClone(p)), replies.shift()) },
      beta: {
        messages: {
          parse: async (p: any) => (parseCalls.push(p), {
            stop_reason: 'end_turn',
            parsed_output: { summary: 'Gate B12 gefunden.', findings: [{ key: 'gate', value: 'B12', sourceUrl: 'https://flughafen.example/abfluege', note: 'kann sich ändern' }, { key: 'checkinDesk', value: '31', sourceUrl: 'https://anders.example/', note: null }] },
          }),
        },
      },
    };
    const ex = createAnthropicExtractor({ apiKey: 'x', model: 'claude-opus-5-5', client }) as Required<Extractor>;
    const out = await ex.lookupPlace({
      now: '2027-05-09 06:10 (Europe/Zurich)',
      item: { type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T09:40', startTz: 'Europe/Zurich', endLocal: null, provider: null, location: null, details: { flightNumber: 'LX 1726' } },
      fields: flightFields,
    });
    assert.equal(created.length, 2, 'pause_turn is continued');
    assert.deepEqual(created[0].tools.map((t: any) => [t.name, t.max_uses]), [['web_search', 5], ['web_fetch', 3]], 'few, targeted searches');
    assert.match(created[0].system, /Live-Seiten/);
    assert.match(created[0].system, /Durchforste nicht das Internet/);
    assert.deepEqual(out.findings.map((f) => [f.key, f.value]), [['gate', 'B12']], 'a value without a real source is dropped');
    assert.equal(out.searches, 2);
    assert.deepEqual(out.queries, ['LX 1726 Zürich Abflug Gate 9. Mai']);
    assert.equal(parseCalls.length, 1);
  });

  test('without any page found nothing is asked of the second step', async () => {
    const client: any = {
      messages: { create: async () => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'Gate vermutlich B12.' }] }) },
      beta: { messages: { parse: async () => { throw new Error('must not be called'); } } },
    };
    const ex = createAnthropicExtractor({ apiKey: 'x', model: 'claude-opus-5-5', client }) as Required<Extractor>;
    const out = await ex.lookupPlace({ now: 'x', item: { type: 'train', title: 'Zürich → Mailand', startLocal: '2027-05-09T07:33', startTz: null, endLocal: null, provider: null, location: null, details: {} }, fields: PLACE_FIELDS.train! });
    assert.deepEqual(out.findings, [], 'a guess without a source never becomes a finding');
  });
});

describe('place lookup: API', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let owner = '';
  let viewer = '';
  let flightId = '';
  let hotelId = '';
  const seen: any[] = [];
  const extractor: Extractor = {
    model: 'fake',
    async extract() { throw new Error('not used'); },
    async check() {},
    async lookupPlace(input) {
      seen.push(input);
      return { summary: 'Gate und Schalter gefunden.', searches: 2, queries: ['LX 1726 Gate'], findings: [
        { key: 'gate', value: 'B12', source: { title: 'Abflüge', url: 'https://flughafen.example/abfluege' }, note: 'Stand 07:42' },
        { key: 'checkinDesk', value: '31–40', source: { title: 'Abflüge', url: 'https://flughafen.example/abfluege' }, note: null },
      ] };
    },
  };

  before(async () => {
    ctx = await setup({ extractor });
    owner = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'P', password: 'geheim123' })).body.token;
    const u = await ctx.call('POST', '/api/users', owner, { username: 'gast', displayName: 'Gast', password: 'gastpass1' });
    viewer = (await ctx.call('POST', '/api/auth/login', undefined, { username: 'gast', password: 'gastpass1' })).body.token;
    const tripId = (await ctx.call('POST', '/api/trips', owner, { title: 'Rom' })).body.trip.id;
    await ctx.call('PUT', `/api/trips/${tripId}/members/${u.body.id}`, owner, { role: 'viewer' });
    flightId = (await ctx.call('POST', `/api/trips/${tripId}/items`, owner, {
      type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T09:40', startTz: 'Europe/Zurich', confirmation: 'K7XQ2P',
      details: { flightNumber: 'LX 1726', from: 'ZRH', to: 'FCO', gate: 'B14', seat: '12A' },
    })).body.id;
    hotelId = (await ctx.call('POST', `/api/trips/${tripId}/items`, owner, { type: 'hotel', title: 'Hotel', startLocal: '2027-05-09' })).body.id;
  });
  after(async () => ctx.cleanup());

  const waitDone = async (token: string) => {
    for (let i = 0; i < 50; i++) {
      const r = await ctx.call('GET', `/api/items/${flightId}/place-lookup`, token);
      if (r.body.lookup?.status !== 'pending') return r.body.lookup;
      await new Promise((res) => setTimeout(res, 20));
    }
    throw new Error('lookup did not finish');
  };

  test('status tells the client the lookup exists', async () => {
    assert.equal((await ctx.call('GET', '/api/ai/status', owner)).body.placeLookup, true);
  });

  test('an editor starts it; the result shows found and current values, nothing is saved', async () => {
    const start = await ctx.call('POST', `/api/items/${flightId}/place-lookup`, owner);
    assert.equal(start.status, 202);
    const lookup = await waitDone(owner);
    assert.equal(lookup.status, 'done');
    assert.deepEqual(lookup.findings.map((f: any) => [f.label, f.value, f.current]), [['Gate', 'B12', 'B14'], ['Schalter', '31–40', null]]);
    const item = (await ctx.call('GET', `/api/trips/${(await ctx.call('GET', '/api/trips', owner)).body[0].id}`, owner)).body.items.find((i: any) => i.id === flightId);
    assert.equal(item.details.gate, 'B14', 'the lookup itself changes nothing');
    const input = seen.at(-1);
    assert.deepEqual(Object.keys(input.item.details).sort(), ['flightNumber', 'from', 'gate', 'to'], 'no seat, no booking number');
    assert.match(input.now, /\(Europe\/Zurich\)$/);
  });

  test('viewers may read the result but not start a lookup; strangers see nothing', async () => {
    assert.equal((await ctx.call('GET', `/api/items/${flightId}/place-lookup`, viewer)).body.lookup.status, 'done');
    assert.equal((await ctx.call('POST', `/api/items/${flightId}/place-lookup`, viewer)).status, 403);
    const other = await ctx.call('POST', '/api/users', owner, { username: 'fremd', displayName: 'F', password: 'fremdpass1' });
    assert.ok(other.body.id);
    const token = (await ctx.call('POST', '/api/auth/login', undefined, { username: 'fremd', password: 'fremdpass1' })).body.token;
    assert.equal((await ctx.call('GET', `/api/items/${flightId}/place-lookup`, token)).status, 404);
  });

  test('entries without gate or platform are refused', async () => {
    assert.equal((await ctx.call('POST', `/api/items/${hotelId}/place-lookup`, owner)).status, 400);
  });

  test('without AI the lookup is not available', async () => {
    const plain = await setup({ extractor: null });
    try {
      const t = (await plain.call('POST', '/api/setup', undefined, { username: 'anna', displayName: 'Anna', password: 'geheim123' })).body.token;
      const trip = (await plain.call('POST', '/api/trips', t, { title: 'X' })).body.trip.id;
      const f = (await plain.call('POST', `/api/trips/${trip}/items`, t, { type: 'flight', title: 'F', startLocal: '2027-05-09T09:40' })).body.id;
      assert.equal((await plain.call('POST', `/api/items/${f}/place-lookup`, t)).status, 409);
      assert.equal((await plain.call('GET', '/api/ai/status', t)).body.placeLookup, false);
    } finally {
      await plain.cleanup();
    }
  });
});
