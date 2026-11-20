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
}

export interface Cruise {
  id: string;
  tripId: string;
  shipName: string;
  cruiseLine: string | null;
  cabin: string | null;
  bookingRef: string | null;
  notes: string | null;
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
}

export interface Timeline {
  tripId: string;
  updatedAt: string;
  defaultTimezone: string;
  phases: TimelinePhase[];
  warnings: TimelineWarning[];
}
