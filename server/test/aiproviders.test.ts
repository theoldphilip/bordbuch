import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.ts';
import { createOpenAIExtractor, createOpenAIPrimitives } from '../src/ai/openai.ts';
import { createGeminiExtractor, createGeminiPrimitives } from '../src/ai/gemini.ts';
import { chainExtractor, type ExtractorFactory } from '../src/ai/providers.ts';
import { reviewSchema } from '../src/ai/review.ts';
import { ExtractionError, type Extractor } from '../src/ai/types.ts';
import type { AiResult } from '../src/ai/schema.ts';

type Call = { url: string; init: RequestInit; body: any };

/** A stand-in for fetch: records each request and answers from a list. */
function fakeFetch(answers: ((c: Call) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> })[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    const c: Call = { url: String(url), init, body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const a = (answers[calls.length - 1] ?? answers[answers.length - 1])!(c);
    return new Response(a.text ?? JSON.stringify(a.json ?? {}), { status: a.status ?? 200, headers: a.headers });
  }) as typeof fetch;
  return { fn, calls };
}

const review = { summary: 'Alles gut', findings: [{ severity: 'hint', title: 'T', text: 'x', itemIds: [], dayIds: [], suggestion: null }] };
const openaiAnswer = (obj: unknown) => ({ json: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(obj), annotations: [] }] }] } });
const geminiAnswer = (obj: unknown) => ({ json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'überlege…', thought: true }, { text: JSON.stringify(obj) }] } }] } });
const flight = { now: '2027-05-08T07:00', fields: [{ key: 'gate', label: 'Gate' }, { key: 'terminal', label: 'Terminal' }], item: { type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-08T09:40', startTz: 'Europe/Zurich', endLocal: null, provider: 'SWISS', location: null, details: { flightNumber: 'LX 1726', from: 'ZRH' } } } as any;

describe('ChatGPT (OpenAI)', () => {
  test('structured answer: JSON schema, PDF as file, answer checked with zod', async () => {
    const f = fakeFetch([() => openaiAnswer(review)]);
    const p = createOpenAIPrimitives({ apiKey: 'sk-test-123456', model: 'gpt-test', fetch: f.fn });
    const out = await p.structured({ system: 'S', parts: [{ type: 'pdf', data: Buffer.from('%PDF'), filename: 'a.pdf' }, { type: 'text', text: 'T' }], schema: reviewSchema, name: 'x', maxTokens: 100 });
    assert.deepEqual(out, review);
    const c = f.calls[0]!;
    assert.equal(c.url, 'https://api.openai.com/v1/responses');
    assert.equal((c.init.headers as any).authorization, 'Bearer sk-test-123456');
    assert.equal(c.body.text.format.type, 'json_schema');
    assert.equal(c.body.text.format.strict, true);
    assert.equal(c.body.text.format.schema.$schema, undefined);
    assert.equal(c.body.input[0].content[0].type, 'input_file');
    assert.match(c.body.input[0].content[0].file_data, /^data:application\/pdf;base64,/);
  });

  test('an answer that does not fit the schema is refused, not passed on', async () => {
    const f = fakeFetch([() => openaiAnswer({ summary: 1 })]);
    const p = createOpenAIPrimitives({ apiKey: 'k'.repeat(12), model: 'm', fetch: f.fn });
    await assert.rejects(p.structured({ system: 'S', parts: [], schema: reviewSchema, name: 'x', maxTokens: 10 }), /passte nicht/);
  });

  test('a schema the strict mode rejects is sent again without strict', async () => {
    const f = fakeFetch([() => ({ status: 400, text: '{"error":{"message":"Invalid schema for response_format"}}' }), () => openaiAnswer(review)]);
    const p = createOpenAIPrimitives({ apiKey: 'k'.repeat(12), model: 'm', fetch: f.fn });
    await p.structured({ system: 'S', parts: [], schema: reviewSchema, name: 'x', maxTokens: 10 });
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1]!.body.text.format.strict, false);
  });

  test('readable errors: key, credit, model', async () => {
    for (const [status, text, re] of [[401, 'Incorrect API key', /Schlüssel wurde abgelehnt/], [429, 'insufficient_quota', /Guthaben/], [404, 'model', /Modell/]] as const) {
      const f = fakeFetch([() => ({ status, text })]);
      const p = createOpenAIPrimitives({ apiKey: 'k'.repeat(12), model: 'm', fetch: f.fn });
      await assert.rejects(p.check(), re);
    }
  });

  test('day-of-travel lookup: only values with a page the search really returned', async () => {
    const f = fakeFetch([
      () => ({ json: { output: [
        { type: 'web_search_call', action: { type: 'search', query: 'LX 1726 gate', sources: [{ url: 'https://www.flughafen-zuerich.ch/abflug', title: 'Abflug' }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'Gate B12 laut https://www.flughafen-zuerich.ch/abflug', annotations: [] }] },
      ] } }),
      (c) => {
        assert.match(c.body.input[0].content[0].text, /Gefundene Seiten:\n- Abflug: https:\/\/www\.flughafen-zuerich\.ch\/abflug/);
        return openaiAnswer({ summary: 'Gate gefunden', findings: [
          { key: 'gate', value: 'B12', sourceUrl: 'https://www.flughafen-zuerich.ch/abflug', note: null },
          { key: 'terminal', value: '2', sourceUrl: 'https://erfunden.example/seite', note: null },
        ] });
      },
    ]);
    const out = await createOpenAIExtractor({ apiKey: 'k'.repeat(12), model: 'm', fetch: f.fn }).lookupPlace!(flight);
    assert.equal(f.calls[0]!.body.tools[0].type, 'web_search');
    assert.deepEqual(out.findings.map((x) => [x.key, x.value]), [['gate', 'B12']], 'Terminal ohne echte Quelle fällt weg');
    assert.deepEqual(out.queries, ['LX 1726 gate']);
  });
});

describe('Gemini', () => {
  test('structured answer: JSON schema, image inline, thinking parts ignored', async () => {
    const f = fakeFetch([() => geminiAnswer(review)]);
    const p = createGeminiPrimitives({ apiKey: 'AIza-test-1234', model: 'gemini-test', fetch: f.fn });
    const out = await p.structured({ system: 'S', parts: [{ type: 'image', data: Buffer.from('x'), mime: 'image/png', filename: 'a.png' }], schema: reviewSchema, name: 'x', maxTokens: 100 });
    assert.deepEqual(out, review);
    const c = f.calls[0]!;
    assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    assert.equal((c.init.headers as any)['x-goog-api-key'], 'AIza-test-1234');
    assert.equal(c.body.generationConfig.responseMimeType, 'application/json');
    assert.ok(c.body.generationConfig.responseJsonSchema.properties.summary);
    assert.deepEqual(c.body.contents[0].parts[0], { inlineData: { mimeType: 'image/png', data: Buffer.from('x').toString('base64') } });
  });

  test('a blocked answer is an error', async () => {
    const f = fakeFetch([() => ({ json: { promptFeedback: { blockReason: 'SAFETY' } } })]);
    const p = createGeminiPrimitives({ apiKey: 'k'.repeat(12), model: 'm', fetch: f.fn });
    await assert.rejects(p.structured({ system: 'S', parts: [], schema: reviewSchema, name: 'x', maxTokens: 10 }), /abgelehnt/);
  });

  test('search: Google redirect links are resolved to the real page, which then counts as source', async () => {
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';
    const f = fakeFetch([
      () => ({ json: { candidates: [{ content: { parts: [{ text: 'Gate B12' }] }, groundingMetadata: { webSearchQueries: ['LX1726 Gate'], groundingChunks: [{ web: { uri: redirect, title: 'flughafen-zuerich.ch' } }] } }] } }),
      (c) => {
        assert.equal(c.url, redirect);
        assert.equal(c.init.method, 'HEAD');
        return { status: 302, text: '', headers: { location: 'https://www.flughafen-zuerich.ch/abflug' } };
      },
      () => geminiAnswer({ summary: 'ok', findings: [{ key: 'gate', value: 'B12', sourceUrl: 'https://www.flughafen-zuerich.ch/abflug', note: null }] }),
    ]);
    const out = await createGeminiExtractor({ apiKey: 'k'.repeat(12), model: 'm', fetch: f.fn }).lookupPlace!(flight);
    assert.deepEqual(f.calls[0]!.body.tools, [{ googleSearch: {} }, { urlContext: {} }]);
    assert.deepEqual(out.findings.map((x) => [x.key, x.value, x.source.url]), [['gate', 'B12', 'https://www.flughafen-zuerich.ch/abflug']]);
  });
});

describe('fallback', () => {
  const result: AiResult = { suggestedTripTitle: null, documentKind: 'x', summary: 'x', items: [], cruise: null, warnings: [] };
  const fake = (model: string, fail?: string): Extractor => ({
    model,
    async extract() {
      if (fail) throw new ExtractionError(fail);
      return { ...result, summary: model };
    },
    async check() {
      if (fail) throw new ExtractionError(fail);
    },
  });

  test('the next provider steps in when the first fails; the model names who answered', async () => {
    const e = chainExtractor([{ id: 'anthropic', extractor: fake('claude-x', 'Guthaben leer') }, { id: 'openai', extractor: fake('gpt-x') }])!;
    const out = await e.extract({ files: [], context: {} as any });
    assert.equal(out.summary, 'gpt-x');
    assert.equal(e.model, 'ChatGPT (gpt-x)');
  });

  test('when all fail, every reason is in the message', async () => {
    const e = chainExtractor([{ id: 'anthropic', extractor: fake('c', 'Guthaben leer') }, { id: 'gemini', extractor: fake('g', 'Gemini: Anfragelimit erreicht.') }])!;
    await assert.rejects(e.extract({ files: [], context: {} as any }), /Claude: Guthaben leer · Gemini: Anfragelimit erreicht\./);
  });

  test('no provider, no AI', () => assert.equal(chainExtractor([]), null));
});

describe('AI settings (admin)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let admin = '';
  let anna = '';
  const checked: string[] = [];
  const factory: ExtractorFactory = (id, key, model) => ({
    model,
    async extract() {
      if (id === 'anthropic') throw new ExtractionError('Guthaben leer');
      return { suggestedTripTitle: null, documentKind: 'x', summary: id, items: [], cruise: null, warnings: [] };
    },
    async check() {
      checked.push(`${id}:${key}`);
      if (key.includes('falsch')) throw new ExtractionError('Der API-Schlüssel wurde abgelehnt.');
    },
  });

  before(async () => {
    ctx = await setup({ aiFactory: factory });
    admin = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
    await ctx.call('POST', '/api/users', admin, { username: 'anna', displayName: 'Anna', password: 'annapass1' });
    anna = (await ctx.call('POST', '/api/auth/login', undefined, { username: 'anna', password: 'annapass1' })).body.token;
  });
  after(async () => ctx.cleanup());

  test('admin only', async () => {
    assert.equal((await ctx.call('GET', '/api/ai/config', anna)).status, 403);
    assert.equal((await ctx.call('PUT', '/api/ai/config', anna, { primary: 'openai' })).status, 403);
  });

  test('without keys the AI is off', async () => {
    const c = (await ctx.call('GET', '/api/ai/config', admin)).body;
    assert.equal(c.primary, 'anthropic');
    assert.equal(c.fallback, true);
    assert.deepEqual(c.providers.map((p: any) => [p.id, p.configured]), [['anthropic', false], ['openai', false], ['gemini', false]]);
    assert.equal((await ctx.call('GET', '/api/ai/status', admin)).body.enabled, false);
  });

  test('a wrong key is tested and not saved', async () => {
    const r = await ctx.call('PUT', '/api/ai/config', admin, { providers: { openai: { key: 'sk-falsch-0000' } } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /^ChatGPT: Schlüssel nicht übernommen\./);
    assert.equal((await ctx.call('GET', '/api/ai/config', admin)).body.providers[1].configured, false);
  });

  test('keys are saved after a test, shown only as …abcd, and the AI works at once', async () => {
    const r = await ctx.call('PUT', '/api/ai/config', admin, { providers: { anthropic: { key: 'sk-ant-1111aaaa' }, openai: { key: 'sk-proj-2222bbbb', model: 'gpt-x' } } });
    assert.equal(r.status, 200);
    assert.ok(checked.includes('anthropic:sk-ant-1111aaaa') && checked.includes('openai:sk-proj-2222bbbb'));
    const raw = JSON.stringify(r.body);
    assert.ok(!raw.includes('sk-ant-1111aaaa') && !raw.includes('sk-proj-2222bbbb'), 'kein Schlüssel in der Antwort');
    assert.equal(r.body.providers[0].keyHint, '…aaaa');
    assert.equal(r.body.providers[1].model, 'gpt-x');
    assert.deepEqual(r.body.active.map((a: any) => a.id), ['anthropic', 'openai']);
    const s = (await ctx.call('GET', '/api/ai/status', admin)).body;
    assert.equal(s.enabled, true);
    assert.deepEqual(s.providers, ['Claude', 'ChatGPT']);
  });

  test('check reports each provider; switching the primary and turning off the fallback changes the order', async () => {
    const chk = await ctx.call('POST', '/api/ai/check', admin);
    assert.equal(chk.status, 200);
    assert.deepEqual(chk.body.results.map((x: any) => [x.id, x.ok]), [['anthropic', true], ['openai', true]]);
    const r = await ctx.call('PUT', '/api/ai/config', admin, { primary: 'openai', fallback: false });
    assert.deepEqual(r.body.active.map((a: any) => a.id), ['openai']);
    await ctx.call('PUT', '/api/ai/config', admin, { primary: 'anthropic', fallback: true });
  });

  test('a document is read by the fallback when the primary fails', async () => {
    const tripId = (await ctx.call('POST', '/api/trips', admin, { title: 'Rom' })).body.trip.id;
    const { upload } = await import('./helpers.ts');
    const up = await upload(ctx.app, admin, `/api/trips/${tripId}/documents`, 'a.pdf', 'application/pdf', '%PDF-1.4 x');
    assert.equal(up.body.attachment.analysisStatus, 'done');
    const a = await ctx.call('GET', `/api/attachments/${up.body.attachment.id}/analysis`, admin);
    assert.equal(a.body.summary, 'openai');
  });

  test('removing a key turns that provider off', async () => {
    const r = await ctx.call('PUT', '/api/ai/config', admin, { providers: { anthropic: { key: null }, openai: { key: null } } });
    assert.deepEqual(r.body.active, []);
    assert.equal((await ctx.call('GET', '/api/ai/status', admin)).body.enabled, false);
  });

  test('a key from the .env is shown with its source and used', async () => {
    const env = await setup({ aiFactory: factory }, { geminiApiKey: 'AIza-env-9999' });
    try {
      const t = (await env.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'Philip', password: 'geheim123' })).body.token;
      const c = (await env.call('GET', '/api/ai/config', t)).body;
      assert.deepEqual([c.providers[2].source, c.providers[2].keyHint, c.providers[2].configured], ['env', '…9999', true]);
      assert.equal(c.providers[0].source, null);
      assert.deepEqual(c.active.map((a: any) => a.id), ['gemini'], 'Ausweich springt ein, auch wenn der Hauptanbieter keinen Schlüssel hat');
    } finally {
      await env.cleanup();
    }
  });
});
