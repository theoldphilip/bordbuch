import type { CruiseDayKind, Info, ItemType } from '../schemas.ts';
import type { AiResult } from './schema.ts';

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

export interface Extractor {
  readonly model: string;
  extract(input: ExtractInput): Promise<AiResult>;
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
}
