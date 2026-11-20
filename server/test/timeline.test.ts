import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, toInstant } from '../src/timeline.ts';
import type { Cruise, CruiseDay, Item } from '../src/model.ts';

const day = (p: Partial<CruiseDay> & Pick<CruiseDay, 'id' | 'date' | 'kind'>): CruiseDay => ({
  cruiseId: 'c1', portName: null, country: null, timezone: 'Europe/Rome', arrival: null, departure: null,
  allAboard: null, tender: false, notes: null, ...p,
});
const item = (p: Partial<Item> & Pick<Item, 'id' | 'type' | 'startLocal'>): Item => ({
  tripId: 't', title: p.id, startTz: null, endLocal: null, endTz: null, location: null, confirmation: null,
  provider: null, cost: null, currency: null, notes: null, cruiseDayId: null, details: {}, createdAt: '', updatedAt: '', ...p,
});
const cruise = (days: CruiseDay[], id = 'c1', shipName = 'MS Test'): Cruise => ({
  id, tripId: 't', shipName, cruiseLine: null, cabin: null, bookingRef: null, notes: null,
  days: days.map((d) => ({ ...d, cruiseId: id })),
});

describe('toInstant', () => {
  test('handles zones and DST', () => {
    assert.equal(new Date(toInstant('2027-07-01T12:00', 'Europe/Zurich')).toISOString(), '2027-07-01T10:00:00.000Z');
    assert.equal(new Date(toInstant('2027-01-15T12:00', 'Europe/Zurich')).toISOString(), '2027-01-15T11:00:00.000Z');
    assert.equal(new Date(toInstant('2027-01-15T12:00', 'America/Miami'.replace('Miami', 'New_York'))).toISOString(), '2027-01-15T17:00:00.000Z');
  });
});

describe('buildTimeline', () => {
  const embark = day({ id: 'e', date: '2027-05-10', kind: 'embarkation', arrival: '12:00', allAboard: '16:30', departure: '17:00' });
  const port = day({ id: 'p', date: '2027-05-11', kind: 'port', arrival: '08:00', allAboard: '17:30', departure: '18:00', tender: true });
  const dis = day({ id: 'd', date: '2027-05-12', kind: 'disembarkation', arrival: '07:00' });

  test('trip without cruise has a single phase', () => {
    const tl = buildTimeline([], [item({ id: 'a', type: 'hotel', startLocal: '2027-01-01' })], 'Europe/Zurich');
    assert.deepEqual(tl.phases.map((p) => p.kind), ['trip']);
  });

  test('same-day flight that misses all aboard is an error', () => {
    const tl = buildTimeline(
      [cruise([embark, port, dis])],
      [item({ id: 'f', type: 'flight', startLocal: '2027-05-10T14:00', startTz: 'Europe/Zurich', endLocal: '2027-05-10T17:00', endTz: 'Europe/Rome' })],
      'Europe/Zurich',
    );
    const codes = tl.warnings.map((w) => w.code);
    assert.deepEqual(codes, ['embark_missed']);
    assert.equal(tl.warnings[0]!.level, 'error');
    assert.equal(tl.phases[0]!.kind, 'pre');
  });

  test('same-day flight with enough buffer gives info only', () => {
    const tl = buildTimeline(
      [cruise([embark, port, dis])],
      [item({ id: 'f', type: 'flight', startLocal: '2027-05-10T07:00', startTz: 'Europe/Zurich', endLocal: '2027-05-10T08:40', endTz: 'Europe/Rome' })],
      'Europe/Zurich',
    );
    assert.deepEqual(tl.warnings.map((w) => w.code), ['embark_same_day']);
  });

  test('excursion in tender port needs extra buffer; late return is an error', () => {
    const tight = buildTimeline(
      [cruise([embark, port, dis])],
      [item({ id: 'x', type: 'excursion', startLocal: '2027-05-11T09:00', endLocal: '2027-05-11T16:50', cruiseDayId: 'p' })],
      'Europe/Zurich',
    );
    assert.deepEqual(tight.warnings.map((w) => w.code), ['excursion_tight']);
    assert.match(tight.warnings[0]!.message, /Tenderhafen/);

    const late = buildTimeline(
      [cruise([embark, port, dis])],
      [item({ id: 'x', type: 'excursion', startLocal: '2027-05-11T07:00', endLocal: '2027-05-11T18:00', cruiseDayId: 'p' })],
      'Europe/Zurich',
    );
    assert.deepEqual(late.warnings.map((w) => w.code).sort(), ['excursion_before_arrival', 'excursion_late']);
  });

  test('flight before the ship arrives is an error', () => {
    const tl = buildTimeline(
      [cruise([embark, port, dis])],
      [item({ id: 'f', type: 'flight', startLocal: '2027-05-12T06:30', startTz: 'Europe/Rome' })],
      'Europe/Zurich',
    );
    assert.deepEqual(tl.warnings.map((w) => w.code), ['disembark_conflict']);
  });

  test('back-to-back cruises get a Zwischenprogramm', () => {
    const c2 = cruise(
      [
        day({ id: 'e2', date: '2027-05-14', kind: 'embarkation', allAboard: '16:00' }),
        day({ id: 'd2', date: '2027-05-18', kind: 'disembarkation', arrival: '07:00' }),
      ],
      'c2',
      'MS Zwei',
    );
    const tl = buildTimeline(
      [cruise([embark, port, dis]), c2],
      [
        item({ id: 'h', type: 'hotel', startLocal: '2027-05-12T14:00', endLocal: '2027-05-14T10:00' }),
        item({ id: 'r', type: 'restaurant', startLocal: '2027-05-20T19:00' }),
      ],
      'Europe/Rome',
    );
    assert.deepEqual(tl.phases.map((p) => p.kind), ['cruise', 'between', 'cruise', 'post']);
    assert.equal(tl.phases[2]!.title, 'Kreuzfahrt · MS Zwei');
  });
});
