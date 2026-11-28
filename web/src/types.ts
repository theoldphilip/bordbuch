// Mirrors the server API (server/src/model.ts, server/src/timeline.ts).
export type Role = 'owner' | 'editor' | 'viewer';

export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

/** cruise, city (city trip / holiday) or roundtrip. Decides which parts the app shows. */
export type TripKind = 'cruise' | 'city' | 'roundtrip';

export interface Trip {
  id: string;
  title: string;
  kind: TripKind;
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

/** open, deposit (paidAmount paid so far) or paid; null = not stated. */
export type PaymentStatus = 'open' | 'deposit' | 'paid';

/** Price and payment, the same on entries and cruises. */
export interface Money {
  cost: number | null;
  currency: string | null;
  paymentStatus: PaymentStatus | null;
  paidAmount: number | null;
  /** When the (remaining) amount is due, JJJJ-MM-TT. */
  dueDate: string | null;
}

export interface Cruise extends Money {
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
  | 'stop'
  | 'note';

export interface Item extends Money {
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
  /** Identity of the hint; used to acknowledge it. */
  key: string;
  /** Set when somebody acknowledged the hint ("quittiert"). */
  ack: { by: string | null; at: string } | null;
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
  paymentStatus?: PaymentStatus | null;
  paidAmount?: number | null;
  dueDate?: string | null;
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
  cost?: number | null;
  currency?: string | null;
  paymentStatus?: PaymentStatus | null;
  paidAmount?: number | null;
  dueDate?: string | null;
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

// ---------- day-of-travel lookup (server/src/routes/placeLookup.ts) ----------
export interface PlaceLookupFinding {
  key: string;
  label: string;
  value: string;
  /** What is entered now, for comparison. */
  current: string | null;
  source: { title: string; url: string };
  note: string | null;
}

export interface PlaceLookup {
  status: 'pending' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  summary?: string;
  searches?: number;
  queries?: string[];
  findings: PlaceLookupFinding[];
}

// ---------- cost overview (server/src/costs.ts) ----------
export type CostKind = ItemType | 'cruise';

export interface CostEntry {
  id: string;
  source: 'item' | 'cruise';
  kind: CostKind;
  title: string;
  date: string | null;
  cost: number;
  currency: string | null;
  paymentStatus: PaymentStatus | null;
  paid: number;
  open: number;
  dueDate: string | null;
}

export interface CostGroup {
  kind: CostKind;
  count: number;
  total: number;
  paid: number;
  open: number;
  entryIds: string[];
}

export interface CurrencyTotal {
  currency: string;
  total: number;
  paid: number;
  open: number;
  unstated: number;
  groups: CostGroup[];
}

export interface TripCosts {
  currencies: CurrencyTotal[];
  withoutCurrency: CostEntry[];
  missingPrice: { kind: CostKind; count: number; entryIds: string[] }[];
  due: CostEntry[];
  entries: CostEntry[];
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
  /** Somebody else changed gate, desk, belt or platform of an entry that is about to happen. */
  infoChange: boolean;
  checkin: boolean;
  flightStatus: boolean;
  lockScreen: boolean;
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

/** Live status of one flight (GET /api/trips/:id/flight-status). Local times "YYYY-MM-DDTHH:MM". */
export interface FlightLive {
  status: string;
  cancelled: boolean;
  diverted: boolean;
  depScheduled: string | null;
  depRevised: string | null;
  arrScheduled: string | null;
  arrRevised: string | null;
  delayMinutes: number | null;
  terminal: string | null;
  checkinDesk: string | null;
  gate: string | null;
  baggageBelt: string | null;
  checkedAt: string;
  error: string | null;
}
