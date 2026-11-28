/**
 * The AI functions (read documents, research, review a trip, day-of-travel lookup) on top of two primitives that
 * every provider can offer: a structured answer (JSON validated with zod) and a web search that returns notes plus
 * the pages it really saw. Claude has its own, older implementation in anthropic.ts; ChatGPT and Gemini use this one.
 * Prompts, rules and the source check are the same for all providers.
 */
import type { z } from 'zod';
import { classifyFile, imageMediaType, MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_TEXT_CHARS } from './files.ts';
import { contextText, KIND_LABEL, RESEARCH_PROMPT, RESEARCH_ROUTE_FOCUS, RESEARCH_STRUCTURE_PROMPT, REVIEW_PROMPT, SYSTEM_PROMPT } from './anthropic.ts';
import { aiResultSchema } from './schema.ts';
import { analysisOutline, cleanResearch, researchSchema } from './research.ts';
import { reviewSchema } from './review.ts';
import { cleanPlaceFindings, describeForLookup, PLACE_PROMPT, PLACE_STRUCTURE_PROMPT, placeSchema } from './placeLookup.ts';
import { ExtractionError, type Extractor, type InputFile, type ResearchSource } from './types.ts';

export type Part =
  | { type: 'text'; text: string }
  | { type: 'pdf'; data: Buffer; filename: string }
  | { type: 'image'; data: Buffer; mime: string; filename: string };

export interface SearchResult {
  notes: string;
  sources: ResearchSource[];
  queries: string[];
  fetched: string[];
  searches: number;
}

export interface Primitives {
  readonly model: string;
  /** One request, answer as JSON that matches the schema. Throws ExtractionError with a readable message. */
  structured<T>(o: { system: string; parts: Part[]; schema: z.ZodType<T>; name: string; maxTokens: number }): Promise<T>;
  /** One request with web search (and, if a URL is given in the prompt, reading that page). */
  search(o: { system: string; prompt: string; maxSearches: number; readPages: boolean; maxTokens: number }): Promise<SearchResult>;
  check(): Promise<void>;
}

export function filePart(input: InputFile): Part {
  const kind = classifyFile(input.mime, input.filename);
  if (kind === 'pdf') {
    if (input.data.length > MAX_PDF_BYTES) throw new ExtractionError('Das PDF ist zu groß für die Analyse (max. 20 MB).');
    return { type: 'pdf', data: input.data, filename: input.filename };
  }
  if (kind === 'image') {
    if (input.data.length > MAX_IMAGE_BYTES) throw new ExtractionError('Das Bild ist zu groß für die Analyse (max. 5 MB). Bitte verkleinern oder als PDF hochladen.');
    return { type: 'image', data: input.data, mime: imageMediaType(input.mime, input.filename), filename: input.filename };
  }
  if (kind === 'text') {
    const text = input.data.toString('utf8');
    if (text.length > MAX_TEXT_CHARS) throw new ExtractionError('Die Textdatei ist zu lang für die Analyse.');
    return { type: 'text', text: `Inhalt der Datei "${input.filename}":\n\n${text}` };
  }
  throw new ExtractionError('Dieser Dateityp kann nicht automatisch gelesen werden (unterstützt: PDF, Bilder, E-Mail/Text).');
}

/** Parses a JSON answer and checks it against the schema; models without guaranteed schemas still have to pass this. */
export function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    throw new ExtractionError('Die Antwort der KI konnte nicht gelesen werden (kein gültiges JSON). Bitte erneut versuchen.');
  }
  const res = schema.safeParse(raw);
  if (!res.success) throw new ExtractionError('Die Antwort der KI passte nicht zum erwarteten Aufbau. Bitte erneut versuchen.');
  return res.data;
}

export function createGenericExtractor(p: Primitives): Extractor {
  return {
    get model() {
      return p.model;
    },

    async extract(input) {
      if (input.files.length === 0) throw new ExtractionError('Keine Datei zum Lesen übergeben.');
      const many = input.files.length > 1;
      const parts: Part[] = [
        ...input.files.flatMap((f, n): Part[] => [...(many ? [{ type: 'text' as const, text: `Datei ${n + 1} von ${input.files.length}: ${f.filename}` }] : []), filePart(f)]),
        { type: 'text', text: contextText(input) },
      ];
      return p.structured({ system: SYSTEM_PROMPT, parts, schema: aiResultSchema, name: 'reiseunterlage', maxTokens: 16000 });
    },

    async research({ analysis, context, mode = 'gaps', url = null }) {
      const outline = analysisOutline(analysis);
      const task =
        mode === 'route'
          ? `${RESEARCH_ROUTE_FOCUS}${url ? `\n\nSeite des Nutzers, bitte zuerst lesen: ${url}` : ''}`
          : `Recherchiere die Lücken bei den bekannten Reisepunkten.${url ? `\n\nSeite des Nutzers, bitte zuerst lesen: ${url}` : ''}`;
      const prompt = `Heutiges Datum: ${context.today}\nReise: ${context.tripTitle}${context.tripKind ? ` (${KIND_LABEL[context.tripKind]})` : ''}\n\nBereits bekannte Reisepunkte:\n${outline}\n\n${task}`;
      const s = await p.search({ system: RESEARCH_PROMPT, prompt, maxSearches: mode === 'route' ? 10 : 8, readPages: !!url, maxTokens: 8000 });
      const found = new Map<string, ResearchSource>(s.sources.map((x) => [x.url, x]));
      if (url && !found.has(url)) found.set(url, { title: 'Von dir angegebene Seite', url });
      const diag = (summary: string) => ({
        summary, suggestions: [], searches: s.searches,
        diagnostics: { queries: s.queries.slice(0, 20), fetched: s.fetched.slice(0, 10), sourcesFound: found.size, droppedNoSource: 0, droppedInvalid: 0, notes: s.notes.slice(0, 1500) },
      });
      if (!s.notes) return diag('Die Recherche hat keine Antwort geliefert.');
      if (found.size === 0) return diag('Die Suche lieferte Text, aber keine prüfbaren Quellen. Deshalb wird nichts vorgeschlagen. Unter „Was wurde gesucht?“ siehst du die Notizen der KI.');
      const parsed = await p.structured({
        system: RESEARCH_STRUCTURE_PROMPT,
        parts: [{ type: 'text', text: `Modus: ${mode === 'route' ? 'Reiseverlauf' : 'Lücken'}\n\nReisepunkte:\n${outline}\n\nRecherche-Notizen:\n${s.notes}` }],
        schema: researchSchema,
        name: 'recherche',
        maxTokens: 16000,
      });
      return cleanResearch(parsed, [...found.values()], analysis, s.searches, { queries: s.queries, fetched: s.fetched, notes: s.notes });
    },

    async review({ outline, today, tripTitle, kind }) {
      return p.structured({
        system: REVIEW_PROMPT,
        parts: [{ type: 'text', text: `Heutiges Datum: ${today}\nReise: ${tripTitle}${kind ? ` (${KIND_LABEL[kind]})` : ''}\n\nÜbersicht:\n${outline}\n\nPrüfe die Reise.` }],
        schema: reviewSchema,
        name: 'reisepruefung',
        maxTokens: 8000,
      });
    },

    async lookupPlace(input) {
      const s = await p.search({ system: PLACE_PROMPT, prompt: `${describeForLookup(input)}\n\nSuche die gesuchten Felder für genau diesen Termin.`, maxSearches: 5, readPages: true, maxTokens: 4000 });
      const base = { searches: s.searches, queries: s.queries.slice(0, 10) };
      if (!s.notes || s.sources.length === 0) {
        return { ...base, summary: 'Keine Seite mit Angaben zu diesem Termin gefunden. Gate und Gleis stehen oft erst kurz vorher fest.', findings: [] };
      }
      const out = await p.structured({
        system: PLACE_STRUCTURE_PROMPT,
        parts: [{ type: 'text', text: `Erlaubte Schlüssel: ${input.fields.map((f) => f.key).join(', ')}\n\nNotizen:\n${s.notes}` }],
        schema: placeSchema,
        name: 'reisetag',
        maxTokens: 4000,
      });
      return { ...base, ...cleanPlaceFindings(out, input.fields, s.sources) };
    },

    check: () => p.check(),
  };
}
