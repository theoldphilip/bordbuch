/**
 * AI review of a whole trip: the model looks at all entries together and reports gaps and contradictions
 * (missing return, no transfer to the port, hotel nights that do not fit, ...). It only reports, nothing is
 * changed. What goes to the model is a reduced outline: no booking numbers, prices, phone numbers or files.
 */
import { z } from 'zod';
import type { Cruise, Item } from '../model.ts';
import type { TimelineWarning } from '../timeline.ts';

export const reviewSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: z.enum(['error', 'warning', 'hint']),
      title: z.string(),
      text: z.string(),
      /** ids from the outline ("item <id>"), empty when the finding concerns the trip as a whole */
      itemIds: z.array(z.string()),
      dayIds: z.array(z.string()),
      suggestion: z.string().nullable(),
    }),
  ),
});
export type ReviewModelOutput = z.infer<typeof reviewSchema>;

export interface ReviewFinding {
  severity: 'error' | 'warning' | 'hint';
  title: string;
  text: string;
  itemIds: string[];
  dayIds: string[];
  suggestion: string | null;
}

export interface ReviewData {
  status: 'pending' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  summary?: string;
  findings: ReviewFinding[];
  model?: string;
  /** trips.updated_at at the time of the run; the review is outdated once the trip changed. */
  basedOn: string;
}

export interface ReviewInput {
  outline: string;
  today: string;
  tripTitle: string;
}

const clip = (v: unknown, n: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** Detail fields that help judging a trip. Seat, room, plate and the like stay out. */
const DETAIL_KEYS = ['airline', 'flightNumber', 'from', 'to', 'trainNumber', 'mode', 'bookedVia', 'meetingPoint', 'lot', 'shuttle', 'carClass', 'returnLocation', 'breakfast'];

/** Compact, numbered text view of the whole trip. Ids are what findings refer to. */
export function tripOutline(cruises: Cruise[], items: Item[], warnings: TimelineWarning[]): string {
  const lines: string[] = [];
  for (const c of cruises) {
    lines.push(`Kreuzfahrt: ${c.shipName}${c.cruiseLine ? `, ${c.cruiseLine}` : ''}`);
    for (const d of c.days) {
      lines.push(
        `  day ${d.id}: ${d.date} | ${d.kind} | ${[d.portName, d.country].filter(Boolean).join(', ') || '–'} | an ${d.arrival ?? '–'} ab ${d.departure ?? '–'} | alle an Bord ${d.allAboard ?? '–'} | Zeitzone ${d.timezone ?? '–'}${d.tender ? ' | Tender' : ''}`,
      );
    }
  }
  const sorted = [...items].sort((a, b) => a.startLocal.localeCompare(b.startLocal));
  for (const i of sorted) {
    const details = DETAIL_KEYS.filter((k) => i.details[k]).map((k) => `${k}=${clip(i.details[k], 40)}`).join(', ');
    lines.push(
      `item ${i.id}: ${i.type} | ${clip(i.title, 120)} | ${i.startLocal}${i.startTz ? ` (${i.startTz})` : ''}${i.endLocal ? ` → ${i.endLocal}${i.endTz ? ` (${i.endTz})` : ''}` : ''} | Ort: ${clip(i.location, 120) || '–'} | Anbieter: ${clip(i.provider, 60) || '–'}${i.cruiseDayId ? ` | zu day ${i.cruiseDayId}` : ''}${details ? ` | ${details}` : ''}${i.notes ? ` | Notiz: ${clip(i.notes, 200)}` : ''}`,
    );
  }
  if (warnings.length) {
    lines.push('', 'Bereits automatisch erkannte Warnungen (nicht wiederholen):');
    for (const w of warnings.slice(0, 40)) lines.push(`- ${clip(w.message, 200)}`);
  }
  return lines.join('\n') || '(noch nichts geplant)';
}

/** Drops references to ids that do not exist and caps lengths, so the UI never links into nothing. */
export function cleanReview(raw: ReviewModelOutput, itemIds: Set<string>, dayIds: Set<string>): { summary: string; findings: ReviewFinding[] } {
  const findings: ReviewFinding[] = [];
  for (const f of raw.findings.slice(0, 20)) {
    const title = clip(f.title, 120);
    const text = clip(f.text, 700);
    if (!title || !text) continue;
    findings.push({
      severity: f.severity,
      title,
      text,
      itemIds: [...new Set(f.itemIds)].filter((id) => itemIds.has(id)).slice(0, 6),
      dayIds: [...new Set(f.dayIds)].filter((id) => dayIds.has(id)).slice(0, 6),
      suggestion: f.suggestion?.trim() ? clip(f.suggestion, 400) : null,
    });
  }
  const order = { error: 0, warning: 1, hint: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { summary: clip(raw.summary, 1000), findings };
}
