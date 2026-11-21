/**
 * Web research for gaps in an analysis. The model searches the web and proposes additions; this file
 * checks them (sources must come from real search results, values must be valid) and merges the ones
 * a user accepts into the stored analysis. Only gaps are filled, existing values are never overwritten.
 */
import { z } from 'zod';
import { INFO_KINDS, mergeInfos, type Info } from '../schemas.ts';
import { isValidTimeZone } from '../util.ts';
import { normalizeLocal } from './normalize.ts';
import type { NormalizedExtraction, ResearchOutput, ResearchSource, ResearchSuggestion } from './types.ts';

export const ITEM_FIELDS = ['location', 'startTz', 'endTz', 'endLocal', 'provider'] as const;
export const DAY_FIELDS = ['country', 'timezone', 'arrival', 'departure', 'allAboard'] as const;

/** Shape of the second (structured) step. Closed objects, no maps, like the extraction schema. */
export const researchSchema = z.object({
  summary: z.string(),
  suggestions: z.array(
    z.object({
      target: z.enum(['item', 'day', 'cruise']),
      index: z.number(),
      title: z.string(),
      fields: z.array(z.object({ field: z.string(), value: z.string() })),
      details: z.array(z.object({ key: z.string(), value: z.string() })),
      infos: z.array(z.object({ label: z.string(), value: z.string(), kind: z.enum(INFO_KINDS) })),
      note: z.string().nullable(),
      sourceUrls: z.array(z.string()),
    }),
  ),
});
export type ResearchModelOutput = z.infer<typeof researchSchema>;

const trim = (v: string, max: number) => v.trim().slice(0, max);
const hhmm = (v: string): string | null => {
  const m = v.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
};

/** Keeps only valid fields of a suggestion; returns the cleaned field list. */
function cleanFields(kind: 'item' | 'day' | 'cruise', fields: { field: string; value: string }[]): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = [];
  for (const { field, value } of fields) {
    const v = value.trim();
    if (!v) continue;
    if (kind === 'item' && (ITEM_FIELDS as readonly string[]).includes(field)) {
      if ((field === 'startTz' || field === 'endTz') && !isValidTimeZone(v)) continue;
      if (field === 'endLocal') {
        const l = normalizeLocal(v);
        if (!l || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(l)) continue;
        out.push({ field, value: l });
        continue;
      }
      out.push({ field, value: trim(v, 300) });
    } else if (kind === 'day' && (DAY_FIELDS as readonly string[]).includes(field)) {
      if (field === 'timezone' && !isValidTimeZone(v)) continue;
      if (field === 'arrival' || field === 'departure' || field === 'allAboard') {
        const t = hhmm(v);
        if (t) out.push({ field, value: t });
        continue;
      }
      out.push({ field, value: trim(v, 80) });
    }
  }
  return out;
}

const normUrl = (u: string) => u.trim().replace(/#.*$/, '').replace(/\/+$/, '');

/**
 * Turns the model's structured step into suggestions. A suggestion without at least one source that was
 * really returned by the web search is dropped: unverifiable claims are not shown to the user.
 */
export function cleanResearch(
  raw: ResearchModelOutput,
  found: ResearchSource[],
  analysis: NormalizedExtraction,
  searches: number,
): ResearchOutput {
  const known = new Map(found.map((s) => [normUrl(s.url), s] as const));
  const suggestions: ResearchOutput['suggestions'] = [];
  for (const s of raw.suggestions.slice(0, 40)) {
    const index = Math.round(s.index);
    const exists =
      s.target === 'item' ? !!analysis.items[index] : s.target === 'day' ? !!analysis.cruise?.days[index] : s.target === 'cruise' ? !!analysis.cruise : false;
    if (!exists) continue;
    const sources = [...new Set(s.sourceUrls.map(normUrl))]
      .map((u) => known.get(u))
      .filter((x): x is ResearchSource => !!x)
      .slice(0, 4);
    if (sources.length === 0) continue;
    const infos: Info[] = s.infos
      .map((i) => ({ label: trim(i.label, 80), value: trim(i.value, 500), kind: i.kind, source: 'web' }) satisfies Info)
      .filter((i) => i.label && i.value)
      .slice(0, 8);
    const details = s.details.map((d) => ({ key: trim(d.key, 60), value: trim(d.value, 300) })).filter((d) => d.key && d.value).slice(0, 8);
    const fields = cleanFields(s.target, s.fields);
    const note = s.note?.trim() ? trim(s.note, 1000) : null;
    if (!fields.length && !details.length && !infos.length && !note) continue;
    suggestions.push({
      target: { kind: s.target, index },
      title: trim(s.title, 160) || 'Recherche-Ergebnis',
      fields,
      details: s.target === 'cruise' || s.target === 'day' ? [] : details,
      infos,
      note,
      sources,
    });
  }
  return { summary: raw.summary.trim().slice(0, 1500), suggestions, searches };
}

const NOTE_MAX = 10000;
const appendNote = (existing: string | null, s: ResearchSuggestion): string | null => {
  const text = s.note ?? s.title;
  const line = `Recherche: ${text} (Quelle: ${s.sources.map((x) => x.url).join(', ')})`;
  const next = existing ? `${existing}\n\n${line}` : line;
  return next.slice(0, NOTE_MAX);
};

/** Merges the accepted suggestions into the stored analysis. Returns how many were applied. */
export function acceptSuggestions(analysis: NormalizedExtraction, ids: string[]): number {
  const research = analysis.research;
  if (!research || research.status !== 'done') return 0;
  let n = 0;
  for (const s of research.suggestions) {
    if (!ids.includes(s.id) || s.accepted) continue;
    const { kind, index } = s.target;
    if (kind === 'item') {
      const item = analysis.items[index];
      if (!item) continue;
      const rec = item as unknown as Record<string, unknown>;
      for (const f of s.fields) {
        if (!rec[f.field]) rec[f.field] = f.value;
      }
      for (const d of s.details) if (!(d.key in item.details)) item.details[d.key] = d.value;
      item.infos = mergeInfos(item.infos, s.infos);
      item.notes = appendNote(item.notes, s);
    } else if (kind === 'day') {
      const day = analysis.cruise?.days[index];
      if (!day) continue;
      const rec = day as unknown as Record<string, unknown>;
      for (const f of s.fields) {
        if (!rec[f.field]) rec[f.field] = f.value;
      }
      day.infos = mergeInfos(day.infos, s.infos);
      day.notes = appendNote(day.notes, s);
    } else {
      const cruise = analysis.cruise;
      if (!cruise) continue;
      cruise.infos = mergeInfos(cruise.infos, s.infos);
      cruise.notes = appendNote(cruise.notes, s);
    }
    s.accepted = true;
    n++;
  }
  return n;
}

/** Compact, numbered view of the analysis for the prompts. Indexes are what suggestions refer to. */
export function analysisOutline(a: NormalizedExtraction): string {
  const items = a.items.map(
    (i, n) =>
      `item ${n}: ${i.type} | ${i.title} | ${i.startLocal}${i.endLocal ? ` → ${i.endLocal}` : ''} | Ort: ${i.location ?? '–'} | Zeitzone: ${i.startTz ?? '–'}${i.endTz ? `/${i.endTz}` : ''} | Anbieter: ${i.provider ?? '–'}`,
  );
  const days = a.cruise
    ? a.cruise.days.map(
        (d, n) =>
          `day ${n}: ${d.date} | ${d.kind} | ${[d.portName, d.country].filter(Boolean).join(', ') || '–'} | an ${d.arrival ?? '–'} ab ${d.departure ?? '–'} | alle an Bord ${d.allAboard ?? '–'} | Zeitzone ${d.timezone ?? '–'}`,
      )
    : [];
  const cruise = a.cruise ? [`cruise: ${a.cruise.shipName}${a.cruise.cruiseLine ? `, ${a.cruise.cruiseLine}` : ''}`] : [];
  return [...cruise, ...items, ...days].join('\n') || '(nichts erkannt)';
}
