import { z } from 'zod';
import { isValidTimeZone } from './util.ts';

const text = (max = 200) => z.string().trim().max(max);
const optText = (max = 200) =>
  text(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT erwartet');
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM erwartet');
export const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/, 'Datum/Zeit im Format JJJJ-MM-TT oder JJJJ-MM-TTTHH:MM erwartet');
export const timeZone = z.string().refine(isValidTimeZone, 'Unbekannte Zeitzone');

export const TRIP_KINDS = ['cruise', 'city', 'roundtrip'] as const;
export type TripKind = (typeof TRIP_KINDS)[number];

export const ITEM_TYPES = [
  'flight',
  'train',
  'bus',
  'ferry',
  'transfer',
  'car_rental',
  'parking',
  'hotel',
  'activity',
  'excursion',
  'restaurant',
  'stop',
  'note',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const TRANSPORT_TYPES: readonly ItemType[] = ['flight', 'train', 'bus', 'ferry', 'transfer'];
/** Types whose end is shown as its own entry on the timeline (check-out, return). */
export const SPAN_TYPES: readonly ItemType[] = ['hotel', 'car_rental', 'parking', 'stop'];

export const CRUISE_DAY_KINDS = ['embarkation', 'port', 'sea', 'disembarkation'] as const;
export type CruiseDayKind = (typeof CRUISE_DAY_KINDS)[number];

// ---------- additional information (phone numbers, emergency numbers, hints) ----------
export const INFO_KINDS = ['phone', 'emergency', 'email', 'link', 'text'] as const;
export const INFO_SOURCES = ['user', 'document', 'ai', 'web'] as const;

export const infoInput = z.object({
  label: text(80).min(1),
  value: text(500).min(1),
  kind: z.enum(INFO_KINDS).default('text'),
  /** user = typed in, document = read from a document, ai = general knowledge of the model, web = web research (both must be verified). */
  source: z.enum(INFO_SOURCES).default('user'),
});
export const infoList = z.array(infoInput).max(30).default([]);
export type Info = z.infer<typeof infoInput>;

const infoKey = (i: Info) => `${i.label.toLowerCase()}|${i.value.toLowerCase().replace(/[^a-z0-9+]/g, '')}`;
/** Existing infos first, new ones appended unless the same label and value are already there. */
export function mergeInfos(existing: Info[], added: Info[]): Info[] {
  const seen = new Set(existing.map(infoKey));
  const result = [...existing];
  for (const i of added) {
    if (seen.has(infoKey(i))) continue;
    seen.add(infoKey(i));
    result.push(i);
  }
  return result.slice(0, 30);
}

// ---------- personal settings ----------
/**
 * Personal time need: every recommended minimum time (arrival buffer, excursion return, hotel check-out)
 * is multiplied by factor and extended by extraMinutes. Stored as plain numbers, nothing about why.
 */
export const paceInput = z.object({
  enabled: z.boolean().default(false),
  factor: z.number().min(1).max(4).default(1.5),
  extraMinutes: z.number().int().min(0).max(120).default(0),
});
const lead = (def: number) => z.number().int().min(5).max(480).default(def);
/** Reminders by time. Lead times are the normal ones; the personal time need (pace) is applied on top. */
export const notificationInput = z.object({
  enabled: z.boolean().default(false),
  boarding: z.boolean().default(true),
  boardingLead: lead(60),
  excursion: z.boolean().default(true),
  excursionLead: lead(45),
  transport: z.boolean().default(true),
  transportLead: lead(90),
  flightLead: lead(180),
  /** Somebody else changed gate, desk, belt or platform of an entry that is about to happen. */
  infoChange: z.boolean().default(true),
  /** Online check-in of a flight opens (by default 24 h before departure, per flight in details.checkinHours). */
  checkin: z.boolean().default(true),
  /** Live flight status: delay, cancellation, new gate from the flight data service. */
  flightStatus: z.boolean().default(true),
  /** Live Activity on the iPhone lock screen on travel days (started by the server via push-to-start). */
  lockScreen: z.boolean().default(true),
});
export const userSettingsInput = z.object({
  pace: paceInput.default({ enabled: false, factor: 1.5, extraMinutes: 0 }),
  notifications: notificationInput.default({
    enabled: false, boarding: true, boardingLead: 60, excursion: true, excursionLead: 45, transport: true, transportLead: 90, flightLead: 180, infoChange: true, checkin: true, flightStatus: true, lockScreen: true,
  }),
});
export type UserSettings = z.infer<typeof userSettingsInput>;

// ---------- auth / users ----------
export const username = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Nur Buchstaben, Zahlen, Punkt, Bindestrich und Unterstrich');
export const password = z.string().min(8, 'Passwort muss mindestens 8 Zeichen haben').max(200);

export const setupInput = z.object({
  username,
  displayName: text(80).min(1),
  password,
});

export const loginInput = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  deviceName: optText(80),
});

export const createUserInput = setupInput.extend({ isAdmin: z.boolean().default(false) });

export const updateMeInput = z.object({
  displayName: text(80).min(1).optional(),
  currentPassword: z.string().optional(),
  newPassword: password.optional(),
});

export const resetPasswordInput = z.object({ password });

// ---------- trips ----------
export const tripInput = z.object({
  title: text(120).min(1),
  kind: z.enum(TRIP_KINDS).default('cruise'),
  startDate: dateOnly.nullish().transform((v) => v ?? null),
  endDate: dateOnly.nullish().transform((v) => v ?? null),
  notes: optText(10000),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish()
    .transform((v) => v ?? null),
});
export type TripInput = z.infer<typeof tripInput>;

export const memberInput = z.object({
  role: z.enum(['owner', 'editor', 'viewer']),
});

// ---------- money and payment (items and cruises) ----------
export const PAYMENT_STATUSES = ['open', 'deposit', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'Währung als 3-stelliger Code, z. B. CHF')
  .nullish()
  .transform((v) => (v ? v.toUpperCase() : null));

/**
 * Price and payment state. paymentStatus null = not stated. paidAmount is the deposit and only counts when the
 * status is 'deposit'. dueDate is when the (remaining) amount has to be paid.
 */
const moneyFields = {
  cost: z.number().finite().nullish().transform((v) => v ?? null),
  currency: currencyCode,
  paymentStatus: z.enum(PAYMENT_STATUSES).nullish().transform((v) => v ?? null),
  paidAmount: z.number().finite().min(0, 'Anzahlung darf nicht negativ sein').nullish().transform((v) => v ?? null),
  dueDate: dateOnly.nullish().transform((v) => v ?? null),
};

// ---------- cruises ----------
const optTime = timeOfDay.nullish().transform((v) => v ?? null);

export const cruiseDayInput = z.object({
  date: dateOnly,
  kind: z.enum(CRUISE_DAY_KINDS),
  portName: optText(120),
  country: optText(80),
  timezone: timeZone.nullish().transform((v) => v ?? null),
  arrival: optTime,
  departure: optTime,
  allAboard: optTime,
  tender: z.boolean().default(false),
  notes: optText(5000),
  infos: infoList,
});
export type CruiseDayInput = z.infer<typeof cruiseDayInput>;

export const cruiseInput = z.object({
  shipName: text(120).min(1),
  cruiseLine: optText(120),
  cabin: optText(60),
  bookingRef: optText(80),
  notes: optText(10000),
  infos: infoList,
  ...moneyFields,
});
export type CruiseInput = z.infer<typeof cruiseInput>;

export const cruiseCreateInput = cruiseInput.extend({
  days: z.array(cruiseDayInput).max(200).default([]),
});

// ---------- items ----------
export const itemInput = z
  .object({
    type: z.enum(ITEM_TYPES),
    title: text(200).min(1),
    startLocal: localDateTime,
    startTz: timeZone.nullish().transform((v) => v ?? null),
    endLocal: localDateTime.nullish().transform((v) => v ?? null),
    endTz: timeZone.nullish().transform((v) => v ?? null),
    location: optText(300),
    confirmation: optText(120),
    provider: optText(120),
    ...moneyFields,
    notes: optText(10000),
    cruiseDayId: z.string().nullish().transform((v) => v ?? null),
    /**
     * Type-specific fields, e.g.
     *  flight:    { airline, flightNumber, from, to, terminal, gate, checkinDesk, baggageBelt, seat }
     *  train:     { trainNumber, from, to, platform, seat }
     *  car_rental: { carClass, returnLocation, desk }
     *  excursion: { bookedVia: 'ship' | 'private', meetingPoint }
     *  hotel:     { room, address, phone }
     */
    details: z.record(z.string(), z.unknown()).default({}),
    /** Phone numbers, emergency numbers, hints for this place. */
    infos: infoList,
  })
  .superRefine((v, ctx) => {
    if (v.endLocal && /^\d{4}-\d{2}-\d{2}/.test(v.startLocal) && v.endLocal < v.startLocal && (v.endTz ?? v.startTz) === v.startTz) {
      ctx.addIssue({ code: 'custom', path: ['endLocal'], message: 'Ende liegt vor dem Beginn' });
    }
  });
export type ItemInput = z.infer<typeof itemInput>;
