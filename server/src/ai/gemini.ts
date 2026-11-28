/**
 * Gemini (Google Generative Language API) as AI provider, via plain HTTPS (no SDK). Structured answers ask for JSON
 * with a JSON schema; the answer is validated with zod again. Web search uses Google Search grounding (and URL context
 * when a page should be read). Grounding returns redirect links; they are resolved to the real pages, and only those
 * pages count as sources.
 */
import { createGenericExtractor, parseJson, type Part, type Primitives, type SearchResult } from './generic.ts';
import { jsonSchemaOf, postJson, providerHttpError, type FetchFn } from './openai.ts';
import { ExtractionError, type Extractor, type ResearchSource } from './types.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const toParts = (parts: Part[]) =>
  parts.map((p) => (p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.type === 'pdf' ? 'application/pdf' : p.mime, data: p.data.toString('base64') } }));

function candidateText(res: any): { text: string; blocked: boolean; truncated: boolean } {
  const c = res?.candidates?.[0];
  const text = (c?.content?.parts ?? [])
    .filter((p: any) => typeof p?.text === 'string' && !p.thought)
    .map((p: any) => p.text)
    .join('')
    .trim();
  const reason = String(c?.finishReason ?? '');
  return { text, blocked: !!res?.promptFeedback?.blockReason || /SAFETY|BLOCKLIST|PROHIBITED|RECITATION/.test(reason), truncated: reason === 'MAX_TOKENS' };
}

/** Grounding links point to a Google redirect; follow it once (no body) to get the real page. */
async function resolveRedirect(fetchFn: FetchFn, uri: string): Promise<string> {
  if (!/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/.test(uri)) return uri;
  try {
    const res = await fetchFn(uri, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const loc = res.headers.get('location');
    return loc && /^https?:\/\//.test(loc) ? loc : uri;
  } catch {
    return uri;
  }
}

export async function geminiSources(fetchFn: FetchFn, res: any): Promise<Pick<SearchResult, 'sources' | 'queries' | 'fetched' | 'searches'>> {
  const c = res?.candidates?.[0] ?? {};
  const g = c.groundingMetadata ?? {};
  const queries: string[] = (g.webSearchQueries ?? []).filter((q: unknown) => typeof q === 'string');
  const chunks: { uri: string; title: string }[] = (g.groundingChunks ?? [])
    .map((ch: any) => ({ uri: ch?.web?.uri, title: ch?.web?.title }))
    .filter((x: any) => typeof x.uri === 'string')
    .slice(0, 15);
  const sources = new Map<string, ResearchSource>();
  for (const ch of chunks) {
    const url = await resolveRedirect(fetchFn, ch.uri);
    if (/^https?:\/\//.test(url) && !sources.has(url)) sources.set(url, { title: String(ch.title || url).slice(0, 200), url });
  }
  const fetched: string[] = [];
  for (const m of c.urlContextMetadata?.urlMetadata ?? []) {
    const url = m?.retrievedUrl;
    if (typeof url === 'string' && /SUCCESS/.test(String(m?.urlRetrievalStatus ?? 'SUCCESS'))) {
      fetched.push(url);
      if (!sources.has(url)) sources.set(url, { title: url, url });
    }
  }
  return { sources: [...sources.values()], queries, fetched, searches: queries.length };
}

export function createGeminiPrimitives(opts: { apiKey: string; model: string; fetch?: FetchFn }): Primitives {
  const fetchFn = opts.fetch ?? fetch;
  const headers = { 'x-goog-api-key': opts.apiKey };
  const url = `${BASE}/models/${encodeURIComponent(opts.model)}:generateContent`;
  const label = 'Gemini';
  return {
    model: opts.model,

    async structured({ system, parts, schema, maxTokens }) {
      const body = (withSchema: boolean) => ({
        systemInstruction: { parts: [{ text: withSchema ? system : `${system}\n\nAntworte ausschließlich mit JSON nach diesem Schema:\n${JSON.stringify(jsonSchemaOf(schema))}` }] },
        contents: [{ role: 'user', parts: toParts(parts) }],
        generationConfig: { responseMimeType: 'application/json', ...(withSchema ? { responseJsonSchema: jsonSchemaOf(schema) } : {}), maxOutputTokens: maxTokens },
      });
      let res: any;
      try {
        res = await postJson(fetchFn, label, url, headers, body(true));
      } catch (err) {
        // Gemini supports only part of JSON Schema; then the schema goes into the prompt and zod checks the answer.
        if (!(err instanceof ExtractionError) || !/\(400\).*schema/i.test(err.message)) throw err;
        res = await postJson(fetchFn, label, url, headers, body(false));
      }
      const { text, blocked, truncated } = candidateText(res);
      if (blocked) throw new ExtractionError(`${label} hat die Verarbeitung abgelehnt.`);
      if (truncated && !text) throw new ExtractionError(`${label}: Die Antwort wurde abgeschnitten (zu viele Daten). Bitte in kleinere Dateien aufteilen.`);
      return parseJson(text, schema);
    },

    async search({ system, prompt, readPages, maxTokens }) {
      const res = await postJson(fetchFn, label, url, headers, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }, ...(readPages ? [{ urlContext: {} }] : [])],
        generationConfig: { maxOutputTokens: maxTokens },
      });
      const { text, blocked } = candidateText(res);
      if (blocked) throw new ExtractionError(`${label} hat die Suche abgelehnt.`);
      const s = await geminiSources(fetchFn, res);
      const notes = text && s.sources.length ? `${text}\n\nGefundene Seiten:\n${s.sources.map((x) => `- ${x.title}: ${x.url}`).join('\n')}` : text;
      return { notes, ...s };
    },

    async check() {
      let res: Response;
      try {
        res = await fetchFn(`${BASE}/models/${encodeURIComponent(opts.model)}`, { headers, signal: AbortSignal.timeout(30_000) });
      } catch (err) {
        throw new ExtractionError(`Keine Verbindung zu ${label} (generativelanguage.googleapis.com). (${(err as Error).message})`);
      }
      if (!res.ok) throw providerHttpError(label, res.status, await res.text());
    },
  };
}

export const createGeminiExtractor = (opts: { apiKey: string; model: string; fetch?: FetchFn }): Extractor => createGenericExtractor(createGeminiPrimitives(opts));
