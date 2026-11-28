/**
 * ChatGPT (OpenAI Responses API) as AI provider, via plain HTTPS (no SDK). Structured answers use a JSON schema
 * generated from the zod schema; the answer is validated with zod again. Web search uses the built-in web_search tool;
 * only pages that the search really returned count as sources.
 */
import { z } from 'zod';
import { createGenericExtractor, parseJson, type Part, type Primitives, type SearchResult } from './generic.ts';
import { ExtractionError, type Extractor, type ResearchSource } from './types.ts';

export type FetchFn = typeof fetch;
const BASE = 'https://api.openai.com/v1';

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** Readable German message for an HTTP error of a provider. */
export function providerHttpError(label: string, status: number, body: string): ExtractionError {
  const text = body.slice(0, 300);
  if (status === 401 || status === 403 || /API_KEY_INVALID|invalid api key|Incorrect API key/i.test(body)) return new ExtractionError(`${label}: Der API-Schlüssel wurde abgelehnt.`);
  if (status === 404) return new ExtractionError(`${label}: Das eingestellte Modell wurde nicht gefunden.`);
  if (status === 429) {
    return /quota|billing|RESOURCE_EXHAUSTED|credit/i.test(body)
      ? new ExtractionError(`${label}: Kontingent oder Guthaben erschöpft.`)
      : new ExtractionError(`${label}: Anfragelimit erreicht. Bitte später erneut versuchen.`);
  }
  if (status >= 500) return new ExtractionError(`${label}: Der Dienst ist gerade gestört (${status}).`);
  return new ExtractionError(`${label} hat die Anfrage abgelehnt (${status}): ${text}`);
}

export async function postJson(fetchFn: FetchFn, label: string, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
  } catch (err) {
    throw new ExtractionError(`Keine Verbindung zu ${label}. Hat der Server Internetzugang? (${(err as Error).message})`);
  }
  const text = await res.text();
  if (!res.ok) throw providerHttpError(label, res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new ExtractionError(`${label}: unerwartete Antwort.`);
  }
}

const toContent = (parts: Part[]) =>
  parts.map((p) =>
    p.type === 'text'
      ? { type: 'input_text', text: p.text }
      : p.type === 'pdf'
        ? { type: 'input_file', filename: p.filename, file_data: `data:application/pdf;base64,${p.data.toString('base64')}` }
        : { type: 'input_image', image_url: `data:${p.mime};base64,${p.data.toString('base64')}` },
  );

function outputText(res: any): { text: string; refused: boolean } {
  let text = '';
  let refused = false;
  for (const item of res?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c?.type === 'output_text') text += c.text ?? '';
      if (c?.type === 'refusal') refused = true;
    }
  }
  return { text: text.trim(), refused };
}

/** Sources, queries and opened pages of a response with web search. */
export function openaiSources(res: any): Pick<SearchResult, 'sources' | 'queries' | 'fetched' | 'searches'> {
  const sources = new Map<string, ResearchSource>();
  const add = (url: unknown, title: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url) && !sources.has(url)) sources.set(url, { title: String(title || url).slice(0, 200), url });
  };
  const queries: string[] = [];
  const fetched: string[] = [];
  let searches = 0;
  for (const item of res?.output ?? []) {
    if (item?.type === 'web_search_call') {
      const a = item.action ?? {};
      if (a.type === 'search') {
        searches++;
        if (typeof a.query === 'string') queries.push(a.query);
        for (const s of a.sources ?? []) add(s?.url, s?.title);
      }
      if (a.type === 'open_page' && typeof a.url === 'string') {
        fetched.push(a.url);
        add(a.url, a.url);
      }
    }
    if (item?.type === 'message') {
      for (const c of item.content ?? []) for (const an of c?.annotations ?? []) if (an?.type === 'url_citation') add(an.url, an.title);
    }
  }
  return { sources: [...sources.values()], queries, fetched, searches };
}

export function createOpenAIPrimitives(opts: { apiKey: string; model: string; fetch?: FetchFn }): Primitives {
  const fetchFn = opts.fetch ?? fetch;
  const auth = { authorization: `Bearer ${opts.apiKey}` };
  const label = 'ChatGPT';
  return {
    model: opts.model,

    async structured({ system, parts, schema, name, maxTokens }) {
      const body = (strict: boolean) => ({
        model: opts.model,
        instructions: system,
        input: [{ role: 'user', content: toContent(parts) }],
        max_output_tokens: maxTokens,
        text: { format: { type: 'json_schema', name, schema: jsonSchemaOf(schema), strict } },
      });
      let res: any;
      try {
        res = await postJson(fetchFn, label, `${BASE}/responses`, auth, body(true));
      } catch (err) {
        // Strict mode accepts only part of JSON Schema; without it the answer is still checked with zod below.
        if (!(err instanceof ExtractionError) || !/\(400\).*schema/i.test(err.message)) throw err;
        res = await postJson(fetchFn, label, `${BASE}/responses`, auth, body(false));
      }
      const { text, refused } = outputText(res);
      if (refused) throw new ExtractionError(`${label} hat die Verarbeitung abgelehnt.`);
      if (res?.status === 'incomplete' && !text) throw new ExtractionError(`${label}: Die Antwort wurde abgeschnitten (zu viele Daten). Bitte in kleinere Dateien aufteilen.`);
      return parseJson(text, schema);
    },

    async search({ system, prompt, maxSearches, maxTokens }) {
      const res = await postJson(fetchFn, label, `${BASE}/responses`, auth, {
        model: opts.model,
        instructions: system,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        tools: [{ type: 'web_search' }],
        max_tool_calls: maxSearches,
        include: ['web_search_call.action.sources'],
        max_output_tokens: maxTokens,
      });
      const { text, refused } = outputText(res);
      if (refused) throw new ExtractionError(`${label} hat die Suche abgelehnt.`);
      const s = openaiSources(res);
      // The structuring step may only cite these pages; list them with their exact URLs.
      const notes = text && s.sources.length ? `${text}\n\nGefundene Seiten:\n${s.sources.map((x) => `- ${x.title}: ${x.url}`).join('\n')}` : text;
      return { notes, ...s };
    },

    async check() {
      let res: Response;
      try {
        res = await fetchFn(`${BASE}/models/${encodeURIComponent(opts.model)}`, { headers: auth, signal: AbortSignal.timeout(30_000) });
      } catch (err) {
        throw new ExtractionError(`Keine Verbindung zu ${label} (api.openai.com). (${(err as Error).message})`);
      }
      if (!res.ok) throw providerHttpError(label, res.status, await res.text());
    },
  };
}

export const createOpenAIExtractor = (opts: { apiKey: string; model: string; fetch?: FetchFn }): Extractor => createGenericExtractor(createOpenAIPrimitives(opts));
