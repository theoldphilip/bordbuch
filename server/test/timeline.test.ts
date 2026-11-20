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
    assert.deepEqual(tl.phases.map((p) => p.kind), ['pre', 'cruise', 'between', 'cruise', 'post']);
    assert.equal(tl.phases[3]!.title, 'Kreuzfahrt · MS Zwei');
    assert.equal(tl.phases[0]!.days.length, 0, 'empty Anreise is still offered');
  });

  test('parking that ends before the return trip is flagged', () => {
    const base = [
      item({ id: 'p', type: 'parking', startLocal: '2027-05-08T07:00', startTz: 'Europe/Zurich', endLocal: '2027-05-17', endTz: 'Europe/Zurich' }),
      item({ id: 'out', type: 'flight', startLocal: '2027-05-08T09:40', startTz: 'Europe/Zurich', endLocal: '2027-05-08T11:15', endTz: 'Europe/Rome' }),
      item({ id: 'back', type: 'flight', startLocal: '2027-05-18T14:00', startTz: 'Europe/Madrid', endLocal: '2027-05-18T16:00', endTz: 'Europe/Zurich' }),
    ];
    const short = buildTimeline([cruise([embark, port, dis])], base, 'Europe/Zurich');
    assert.ok(short.warnings.some((w) => w.code === 'parking_short'));
    const ok = buildTimeline([cruise([embark, port, dis])], [{ ...base[0]!, endLocal: '2027-05-18' }, base[1]!, base[2]!], 'Europe/Zurich');
    assert.ok(!ok.warnings.some((w) => w.code === 'parking_short'), 'date-only end counts until end of day');
  });

  describe('hotel buffers', () => {
    // embarkation: check-in opens 12:00, all aboard 16:30; disembarkation 07:00 (off ship ~08:00)
    const run = (items: Item[]) => buildTimeline([cruise([embark, port, dis])], items, 'Europe/Zurich').warnings;
    const preHotel = (checkout: string) =>
      item({ id: 'h', type: 'hotel', startLocal: '2027-05-08T15:00', startTz: 'Europe/Rome', endLocal: `2027-05-10T${checkout}`, endTz: 'Europe/Rome' });

    test('check-out after all aboard is an error on the check-out entry', () => {
      const w = run([preHotel('17:30')]);
      const late = w.find((x) => x.code === 'hotel_checkout_late')!;
      assert.equal(late.level, 'error');
      assert.equal(late.role, 'end');
    });

    test('a late check-out alone is not a double booking', () => {
      assert.ok(!run([preHotel('16:00')]).some((x) => x.code === 'hotel_overlaps_cruise'));
    });

    test('tight check-out is a warning, comfortable check-out is silent', () => {
      assert.deepEqual(run([preHotel('15:00')]).map((x) => x.code), ['hotel_embark_tight']);
      assert.deepEqual(run([preHotel('10:00')]).map((x) => x.code), []);
    });

    test('very early check-out hints at the wait before boarding opens', () => {
      assert.deepEqual(run([preHotel('07:00')]).map((x) => x.code), ['hotel_wait_boarding']);
    });

    test('long wait between leaving the ship and hotel check-in', () => {
      const h = item({ id: 'h2', type: 'hotel', startLocal: '2027-05-12T15:00', startTz: 'Europe/Rome', endLocal: '2027-05-14T11:00', endTz: 'Europe/Rome' });
      assert.deepEqual(run([h]).map((x) => x.code), ['hotel_checkin_wait']);
    });

    test('a hotel night during the cruise is flagged as double booking', () => {
      const h = item({ id: 'h3', type: 'hotel', startLocal: '2027-05-09T15:00', startTz: 'Europe/Rome', endLocal: '2027-05-11T10:00', endTz: 'Europe/Rome' });
      assert.ok(run([h]).some((x) => x.code === 'hotel_overlaps_cruise'));
    });

    test('late and early arrivals at the hotel', () => {
      const hotel = item({ id: 'h4', type: 'hotel', startLocal: '2027-05-08T15:00', startTz: 'Europe/Rome', endLocal: '2027-05-10T10:00', endTz: 'Europe/Rome' });
      const late = item({ id: 'f1', type: 'flight', startLocal: '2027-05-08T20:00', startTz: 'Europe/Zurich', endLocal: '2027-05-08T23:10', endTz: 'Europe/Rome' });
      const early = item({ id: 'f2', type: 'flight', startLocal: '2027-05-08T06:00', startTz: 'Europe/Zurich', endLocal: '2027-05-08T08:00', endTz: 'Europe/Rome' });
      assert.deepEqual(run([hotel, late]).map((x) => x.code), ['hotel_late_arrival']);
      assert.deepEqual(run([hotel, early]).map((x) => x.code), ['hotel_early_arrival']);
    });
  });
});
