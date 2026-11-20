/**
 * Shape the model must return (structured output). Constraints of the API's JSON-schema mode:
 * every object is closed, no numeric ranges, no free-form maps. So all fields are required but
 * nullable, and "details" is a list of key/value pairs.
 */
import { z } from 'zod';
import { CRUISE_DAY_KINDS, ITEM_TYPES } from '../schemas.ts';

const nullableText = z.string().nullable();

export const aiItemSchema = z.object({
  type: z.enum(ITEM_TYPES),
  title: z.string(),
  startLocal: z.string(),
  startTz: nullableText,
  endLocal: nullableText,
  endTz: nullableText,
  location: nullableText,
  confirmation: nullableText,
  provider: nullableText,
  cost: z.number().nullable(),
  currency: nullableText,
  notes: nullableText,
  cruiseDayId: nullableText,
  details: z.array(z.object({ key: z.string(), value: z.string() })),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const aiCruiseDaySchema = z.object({
  date: z.string(),
  kind: z.enum(CRUISE_DAY_KINDS),
  portName: nullableText,
  country: nullableText,
  timezone: nullableText,
  arrival: nullableText,
  departure: nullableText,
  allAboard: nullableText,
  tender: z.boolean(),
  notes: nullableText,
});

export const aiCruiseSchema = z.object({
  shipName: z.string(),
  cruiseLine: nullableText,
  cabin: nullableText,
  bookingRef: nullableText,
  notes: nullableText,
  days: z.array(aiCruiseDaySchema),
});

export const aiResultSchema = z.object({
  documentKind: z.string(),
  summary: z.string(),
  items: z.array(aiItemSchema),
  cruise: aiCruiseSchema.nullable(),
  warnings: z.array(z.string()),
});

export type AiResult = z.infer<typeof aiResultSchema>;
