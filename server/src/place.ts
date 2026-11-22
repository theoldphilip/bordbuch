/**
 * Where to be: terminal, gate, check-in desk, baggage belt, platform. These are details of an entry that are often only
 * known shortly before (gate) or after (belt) the event, so they are shown prominently, put into the departure reminder
 * and announced to the other members of the trip when somebody changes them.
 */
import type { Item } from './model.ts';

export interface PlaceField {
  key: string;
  label: string;
  /** departure = relevant before leaving, arrival = after landing */
  when: 'departure' | 'arrival';
}

export const PLACE_FIELDS: Partial<Record<Item['type'], PlaceField[]>> = {
  flight: [
    { key: 'terminal', label: 'Terminal', when: 'departure' },
    { key: 'checkinDesk', label: 'Schalter', when: 'departure' },
    { key: 'gate', label: 'Gate', when: 'departure' },
    { key: 'baggageBelt', label: 'Kofferband', when: 'arrival' },
  ],
  train: [{ key: 'platform', label: 'Gleis', when: 'departure' }],
  car_rental: [{ key: 'desk', label: 'Schalter', when: 'departure' }],
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** "Terminal 2, Schalter 31–40, Gate B12" for what is known; `when` limits it to departure or arrival fields. */
export function placeInfo(item: Pick<Item, 'type' | 'details'>, when?: PlaceField['when']): string[] {
  return (PLACE_FIELDS[item.type] ?? [])
    .filter((f) => !when || f.when === when)
    .map((f) => ({ f, v: text(item.details?.[f.key]) }))
    .filter(({ v }) => v)
    .map(({ f, v }) => `${f.label} ${v}`);
}

export interface PlaceChange {
  label: string;
  now: string;
  before: string;
}

/** Which place fields differ between two states of an entry. Removed values are not announced. */
export function placeChanges(before: Pick<Item, 'type' | 'details'>, after: Pick<Item, 'type' | 'details'>): PlaceChange[] {
  return (PLACE_FIELDS[after.type] ?? [])
    .map((f) => ({ label: f.label, now: text(after.details?.[f.key]), before: text(before.details?.[f.key]) }))
    .filter((c) => c.now && c.now !== c.before);
}

/** Text of the notification body for a set of changes: "Gate B12 (vorher B14), Kofferband 4 (neu)". */
export function describeChanges(changes: PlaceChange[]): string {
  return changes.map((c) => `${c.label} ${c.now} ${c.before ? `(vorher ${c.before})` : '(neu)'}`).join(', ');
}
