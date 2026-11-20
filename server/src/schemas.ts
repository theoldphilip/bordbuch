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

export const ITEM_TYPES = [
  'flight',
  'train',
  'bus',
  'ferry',
  'transfer',
  'car_rental',
  'hotel',
  'activity',
  'excursion',
  'restaurant',
  'note',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const TRANSPORT_TYPES: readonly ItemType[] = ['flight', 'train', 'bus', 'ferry', 'transfer'];
/** Types whose end is shown as its own entry on the timeline (check-out, return). */
export const SPAN_TYPES: readonly ItemType[] = ['hotel', 'car_rental'];

export const CRUISE_DAY_KINDS = ['embarkation', 'port', 'sea', 'disembarkation'] as const;
export type CruiseDayKind = (typeof CRUISE_DAY_KINDS)[number];

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
});
export type CruiseDayInput = z.infer<typeof cruiseDayInput>;

export const cruiseInput = z.object({
  shipName: text(120).min(1),
  cruiseLine: optText(120),
  cabin: optText(60),
  bookingRef: optText(80),
  notes: optText(10000),
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
    cost: z.number().finite().nullish().transform((v) => v ?? null),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, 'Währung als 3-stelliger Code, z. B. CHF')
      .nullish()
      .transform((v) => (v ? v.toUpperCase() : null)),
    notes: optText(10000),
    cruiseDayId: z.string().nullish().transform((v) => v ?? null),
    /**
     * Type-specific fields, e.g.
     *  flight:    { airline, flightNumber, from, to, terminal, gate, seat }
     *  excursion: { bookedVia: 'ship' | 'private', meetingPoint }
     *  hotel:     { room, address, phone }
     */
    details: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((v, ctx) => {
    if (v.endLocal && v.endLocal < v.startLocal && (v.endTz ?? v.startTz) === v.startTz) {
      ctx.addIssue({ code: 'custom', path: ['endLocal'], message: 'Ende liegt vor dem Beginn' });
    }
  });
export type ItemInput = z.infer<typeof itemInput>;
