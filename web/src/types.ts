// Mirrors the server API (server/src/model.ts, server/src/timeline.ts).
export type Role = 'owner' | 'editor' | 'viewer';

export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export interface Trip {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripSummary extends Trip {
  role: Role;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  ships: string[];
  memberCount: number;
}

export interface Member {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
}

export type CruiseDayKind = 'embarkation' | 'port' | 'sea' | 'disembarkation';

export type InfoKind = 'phone' | 'emergency' | 'email' | 'link' | 'text';

/** Additional information at a travel point: phone and emergency numbers, hints. */
export interface Info {
  label: string;
  value: string;
  kind: InfoKind;
  /** user = typed in, document = read from a document, ai = general knowledge of the model, web = web research (both to be verified) */
  source: 'user' | 'document' | 'ai' | 'web';
}

export interface CruiseDay {
  id: string;
  cruiseId: string;
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

export interface Cruise {
  id: string;
  tripId: string;
  shipName: string;
  cruiseLine: string | null;
  cabin: string | null;
  bookingRef: string | null;
  notes: string | null;
  infos: Info[];
  days: CruiseDay[];
}

export type ItemType =
  | 'flight'
  | 'train'
  | 'bus'
  | 'ferry'
  | 'transfer'
  | 'car_rental'
  | 'parking'
  | 'hotel'
  | 'activity'
  | 'excursion'
  | 'restaurant'
  | 'note';

export interface Item {
  id: string;
  tripId: string;
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
  details: Record<string, string | undefined>;
  infos: Info[];
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  tripId: string;
  itemId: string | null;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  analysisStatus: 'pending' | 'done' | 'failed' | 'applied' | 'dismissed' | 'grouped' | null;
  analysisError: string | null;
}

export interface TripDetail {
  trip: Trip;
  role: Role;
  members: Member[];
  cruises: Cruise[];
  items: Item[];
  attachments: Attachment[];
}

export interface TimelineEntry {
  itemId: string;
  role: 'start' | 'end';
  time: string | null;
  timezone: string;
  item: Item;
}

export interface TimelineDay {
  date: string;
  cruiseDay: CruiseDay | null;
  entries: TimelineEntry[];
}

export interface TimelinePhase {
  kind: 'trip' | 'pre' | 'cruise' | 'between' | 'post';
  title: string;
  cruiseId: string | null;
  startDate: string | null;
  endDate: string | null;
  days: TimelineDay[];
}

export interface TimelineWarning {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  itemId?: string;
  cruiseId?: string;
  cruiseDayId?: string;
  /** Fine with the normal time, too tight with the user's personal time need. */
  personal?: boolean;
  role?: 'start' | 'end';
}

export interface Timeline {
  tripId: string;
  updatedAt: string;
  defaultTimezone: string;
  /** The caller's personal time need when enabled; recommended times in the warnings already include it. */
  pace: Pace | null;
  phases: TimelinePhase[];
  warnings: TimelineWarning[];
}

// ---------- document analysis (server/src/ai/proposals.ts) ----------
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

export interface ItemProposal {
  index: number;
  data: ItemData;
  confidence: 'high' | 'medium' | 'low';
  match: { itemId: string; title: string; reason: string; changes: string[] } | null;
  problems: string[];
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

export interface CruiseProposal {
  data: CruiseData;
  match: { cruiseId: string; shipName: string; reason: string } | null;
  newDays: number;
  updatedDays: number;
  problems: string[];
}

export interface ResearchSuggestion {
  id: string;
  target: { kind: 'item' | 'day' | 'cruise'; index: number };
  title: string;
  fields: { field: string; value: string }[];
  details: { key: string; value: string }[];
  infos: Info[];
  note: string | null;
  sources: { title: string; url: string }[];
  /** A found itinerary; target.kind is then 'cruise'. */
  route?: { shipName: string | null; cruiseLine: string | null; days: ResearchRouteDay[] };
  accepted?: boolean;
}

export interface ResearchRouteDay {
  date: string;
  kind: CruiseDay['kind'];
  portName: string | null;
  country: string | null;
  timezone: string | null;
  arrival: string | null;
  departure: string | null;
  allAboard: string | null;
  tender: boolean;
}

export interface ResearchDiagnostics {
  queries: string[];
  fetched: string[];
  sourcesFound: number;
  droppedNoSource: number;
  droppedInvalid: number;
  notes: string;
}

export interface Research {
  status: 'pending' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  summary?: string;
  suggestions: ResearchSuggestion[];
  searches?: number;
  model?: string;
  mode?: 'gaps' | 'route';
  url?: string | null;
  diagnostics?: ResearchDiagnostics;
}

export interface AnalysisView {
  research: Research | null;
  suggestedTripTitle: string | null;
  status: Attachment['analysisStatus'];
  attachment: Attachment;
  /** All files analysed together; more than one when they were grouped. */
  files: { id: string; filename: string }[];
  documentKind: string;
  summary: string;
  warnings: string[];
  model: string;
  analyzedAt: string;
  items: ItemProposal[];
  cruise: CruiseProposal | null;
}

export interface Pace {
  enabled: boolean;
  factor: number;
  extraMinutes: number;
}

export interface NotificationPrefs {
  enabled: boolean;
  boarding: boolean;
  boardingLead: number;
  excursion: boolean;
  excursionLead: number;
  transport: boolean;
  transportLead: number;
  flightLead: number;
}

export interface UserSettings {
  pace: Pace;
  notifications: NotificationPrefs;
}

export interface ReviewFinding {
  severity: 'error' | 'warning' | 'hint';
  title: string;
  text: string;
  itemIds: string[];
  dayIds: string[];
  suggestion: string | null;
}

export interface TripReview {
  status: 'pending' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  summary?: string;
  findings: ReviewFinding[];
  model?: string;
  basedOn: string;
}
