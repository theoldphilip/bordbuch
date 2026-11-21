import type { CruiseDayKind, Info, ItemType } from '../schemas.ts';
import type { AiResult } from './schema.ts';
import type { ReviewInput, ReviewModelOutput } from './review.ts';

export class ExtractionError extends Error {}

export interface ExtractionContext {
  /** ISO date, used to resolve dates without a year. */
  today: string;
  defaultTz: string;
  tripTitle: string;
  cruiseDays: { id: string; date: string; kind: CruiseDayKind; portName: string | null; country: string | null; shipName: string }[];
}

export interface InputFile {
  data: Buffer;
  mime: string;
  filename: string;
}

export interface ExtractInput {
  /** One file, or several that belong to the same booking (e.g. screenshots of one page). */
  files: InputFile[];
  context: ExtractionContext;
}

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchRouteDay {
  date: string;
  kind: CruiseDayKind;
  portName: string | null;
  country: string | null;
  timezone: string | null;
  arrival: string | null;
  departure: string | null;
  allAboard: string | null;
  tender: boolean;
}

/** The cruise itinerary found on the web: becomes cruise days (new ones are added, existing ones only get gaps filled). */
export interface ResearchRoute {
  shipName: string | null;
  cruiseLine: string | null;
  days: ResearchRouteDay[];
}

/** What the research did, so "nothing found" can be understood instead of guessed. */
export interface ResearchDiagnostics {
  queries: string[];
  fetched: string[];
  sourcesFound: number;
  droppedNoSource: number;
  droppedInvalid: number;
  /** Start of the model's own notes, before they were turned into suggestions. */
  notes: string;
}

/** One proposed addition from the web research. Nothing is stored in trips until a user accepts it and applies the document. */
export interface ResearchSuggestion {
  id: string;
  target: { kind: 'item' | 'day' | 'cruise'; index: number };
  title: string;
  /** Only gaps are filled: fields that are already set are never overwritten. */
  fields: { field: string; value: string }[];
  details: { key: string; value: string }[];
  infos: Info[];
  note: string | null;
  sources: ResearchSource[];
  /** Set for a found itinerary (target.kind is then 'cruise'). */
  route?: ResearchRoute;
  accepted?: boolean;
}

export interface ResearchData {
  status: 'pending' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  summary?: string;
  suggestions: ResearchSuggestion[];
  searches?: number;
  model?: string;
  mode?: ResearchMode;
  /** Page the user pointed the research to. */
  url?: string | null;
  diagnostics?: ResearchDiagnostics;
}

export type ResearchMode = 'gaps' | 'route';

export interface ResearchInput {
  analysis: NormalizedExtraction;
  context: ExtractionContext;
  /** gaps: fill what is missing at known points. route: find the cruise itinerary. Default gaps. */
  mode?: ResearchMode;
  /** A page to read first (e.g. the cruise line's page for this trip). */
  url?: string | null;
}

export interface ResearchOutput {
  summary: string;
  suggestions: Omit<ResearchSuggestion, 'id'>[];
  searches: number;
  diagnostics?: ResearchDiagnostics;
}

export interface Extractor {
  readonly model: string;
  extract(input: ExtractInput): Promise<AiResult>;
  /** Optional web research for gaps in an analysis (routes, times, phone numbers). Slow: runs in the background. */
  research?(input: ResearchInput): Promise<ResearchOutput>;
  /** Optional review of the whole trip for gaps and contradictions (no web, no changes). */
  review?(input: ReviewInput): Promise<ReviewModelOutput>;
  /** Cheap request to verify key, model and network. Throws ExtractionError with a readable message. */
  check(): Promise<void>;
}

// ---------- normalised data used by the rest of the app ----------
export interface ItemData {
  type: ItemType;
  title: string;
  startLocal: string;
  startTz: string | null;
  endLocal: string | null;
  endTz: string | null;
  location: string | null;
  confirmation: string | null;
  provider: string | null;
  cost: number | null;
  currency: string | null;
  notes: string | null;
  cruiseDayId: string | null;
  details: Record<string, string>;
  infos: Info[];
}

export interface CruiseDayData {
  date: string;
  kind: CruiseDayKind;
  portName: string | null;
  country: string | null;
  timezone: string | null;
  arrival: string | null;
  departure: string | null;
  allAboard: string | null;
  tender: boolean;
  notes: string | null;
  infos: Info[];
}

export interface CruiseData {
  shipName: string;
  cruiseLine: string | null;
  cabin: string | null;
  bookingRef: string | null;
  notes: string | null;
  infos: Info[];
  days: CruiseDayData[];
}

export interface NormalizedExtraction {
  /** Missing in analyses stored before this field existed. */
  suggestedTripTitle?: string | null;
  documentKind: string;
  summary: string;
  items: (ItemData & { confidence: 'high' | 'medium' | 'low' })[];
  cruise: CruiseData | null;
  warnings: string[];
  model: string;
  analyzedAt: string;
  /** Web research started from the review dialog (optional). */
  research?: ResearchData;
}
