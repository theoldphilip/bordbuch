import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCosts, paidOf } from '../src/costs.ts';
import type { Cruise, Item } from '../src/model.ts';
import { setup } from './helpers.ts';

const item = (p: Partial<Item> & Pick<Item, 'id' | 'type'>): Item => ({
  tripId: 't', title: p.id, startLocal: '2027-05-01', startTz: null, endLocal: null, endTz: null, location: null, confirmation: null,
  provider: null, cost: null, currency: null, paymentStatus: null, paidAmount: null, dueDate: null, notes: null, cruiseDayId: null,
  details: {}, infos: [], createdAt: '', updatedAt: '', ...p,
});
const cruise = (p: Partial<Cruise> = {}): Cruise => ({
  id: 'c1', tripId: 't', shipName: 'MS Aurora', cruiseLine: null, cabin: null, bookingRef: null, notes: null, infos: [],
  cost: null, currency: null, paymentStatus: null, paidAmount: null, dueDate: null,
  days: [{ id: 'd1', cruiseId: 'c1', date: '2027-05-10', kind: 'embarkation', portName: null, country: null, timezone: null, arrival: null, departure: null, allAboard: null, tender: false, notes: null, infos: [] }],
  ...p,
});

describe('cost overview (pure)', () => {
  test('paid amount per payment state', () => {
    assert.equal(paidOf(100, 'paid', null), 100);
    assert.equal(paidOf(100, 'deposit', 30), 30);
    assert.equal(paidOf(100, 'deposit', 250), 100, 'a deposit never exceeds the price');
    assert.equal(paidOf(100, 'deposit', null), 0);
    assert.equal(paidOf(100, 'open', 30), 0, 'a deposit amount without state deposit does not count');
    assert.equal(paidOf(100, null, null), 0);
  });

  test('sums per currency, never mixed, with groups by kind', () => {
    const r = computeCosts(
      [
        item({ id: 'f1', type: 'flight', cost: 200.1, currency: 'EUR', paymentStatus: 'paid' }),
        item({ id: 'f2', type: 'flight', cost: 199.2, currency: 'EUR' }),
        item({ id: 'h1', type: 'hotel', cost: 412.5, currency: 'CHF', paymentStatus: 'deposit', paidAmount: 100 }),
      ],
      [cruise({ cost: 3480, currency: 'EUR', paymentStatus: 'deposit', paidAmount: 500, dueDate: '2027-03-01' })],
    );
    assert.deepEqual(r.currencies.map((c) => c.currency), ['EUR', 'CHF'], 'largest total first');
    const eur = r.currencies[0]!;
    assert.equal(eur.total, 3879.3, 'cents add up without float noise');
    assert.equal(eur.paid, 700.1);
    assert.equal(eur.open, 3179.2);
    assert.equal(eur.unstated, 1);
    assert.deepEqual(eur.groups.map((g) => [g.kind, g.count, g.total]), [['cruise', 1, 3480], ['flight', 2, 399.3]]);
    const chf = r.currencies[1]!;
    assert.deepEqual([chf.total, chf.paid, chf.open], [412.5, 100, 312.5]);
  });

  test('amounts without currency stay apart and are never summed', () => {
    const r = computeCosts([item({ id: 'p', type: 'parking', cost: 80 }), item({ id: 'f', type: 'flight', cost: 10, currency: 'EUR' })], []);
    assert.deepEqual(r.withoutCurrency.map((e) => e.id), ['p']);
    assert.equal(r.currencies.length, 1);
    assert.equal(r.currencies[0]!.total, 10);
  });

  test('bookable entries and the cruise without a price are listed, notes and activities are not', () => {
    const r = computeCosts(
      [
        item({ id: 'f1', type: 'flight' }),
        item({ id: 'f2', type: 'flight' }),
        item({ id: 'h', type: 'hotel', cost: 0, currency: 'EUR' }),
        item({ id: 'n', type: 'note' }),
        item({ id: 'a', type: 'activity' }),
        item({ id: 's', type: 'stop' }),
      ],
      [cruise()],
    );
    assert.deepEqual(r.missingPrice.map((m) => [m.kind, m.count]), [['cruise', 1], ['flight', 2]], 'a price of 0 counts as a price');
  });

  test('open payments with due date, earliest first; fully paid ones are left out', () => {
    const r = computeCosts(
      [
        item({ id: 'late', type: 'hotel', cost: 100, currency: 'EUR', dueDate: '2027-04-01' }),
        item({ id: 'early', type: 'parking', cost: 50, currency: 'EUR', paymentStatus: 'deposit', paidAmount: 20, dueDate: '2027-02-01' }),
        item({ id: 'done', type: 'flight', cost: 300, currency: 'EUR', paymentStatus: 'paid', dueDate: '2027-01-01' }),
        item({ id: 'nodate', type: 'flight', cost: 300, currency: 'EUR' }),
      ],
      [],
    );
    assert.deepEqual(r.due.map((e) => [e.id, e.open]), [['early', 30], ['late', 100]]);
  });
});

describe('cost overview (API)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let owner = '';
  let viewer = '';
  let tripId = '';

  before(async () => {
    ctx = await setup();
    owner = (await ctx.call('POST', '/api/setup', undefined, { username: 'philip', displayName: 'P', password: 'geheim123' })).body.token;
    const u = await ctx.call('POST', '/api/users', owner, { username: 'gast', displayName: 'Gast', password: 'gastpass1' });
    viewer = (await ctx.call('POST', '/api/auth/login', undefined, { username: 'gast', password: 'gastpass1' })).body.token;
    tripId = (await ctx.call('POST', '/api/trips', owner, { title: 'Kosten-Test' })).body.trip.id;
    await ctx.call('PUT', `/api/trips/${tripId}/members/${u.body.id}`, owner, { role: 'viewer' });
  });
  after(async () => ctx.cleanup());

  test('cruise price and payment state are stored and summed', async () => {
    const c = await ctx.call('POST', `/api/trips/${tripId}/cruises`, owner, {
      shipName: 'MS Aurora', cost: 3480, currency: 'eur', paymentStatus: 'deposit', paidAmount: 500, dueDate: '2027-03-01',
      days: [{ date: '2027-05-10', kind: 'embarkation' }],
    });
    assert.equal(c.status, 201);
    assert.deepEqual([c.body.cost, c.body.currency, c.body.paymentStatus, c.body.paidAmount, c.body.dueDate], [3480, 'EUR', 'deposit', 500, '2027-03-01']);

    const f = await ctx.call('POST', `/api/trips/${tripId}/items`, owner, {
      type: 'flight', title: 'Zürich → Rom', startLocal: '2027-05-09T08:00', cost: 420, currency: 'EUR', paymentStatus: 'paid',
    });
    assert.equal(f.status, 201);
    assert.equal(f.body.paymentStatus, 'paid');

    const r = await ctx.call('GET', `/api/trips/${tripId}/costs`, viewer);
    assert.equal(r.status, 200, 'viewers may see the costs');
    assert.deepEqual([r.body.currencies[0].currency, r.body.currencies[0].total, r.body.currencies[0].paid, r.body.currencies[0].open], ['EUR', 3900, 920, 2980]);
    assert.deepEqual(r.body.due.map((e: { title: string }) => e.title), ['MS Aurora']);
  });

  test('a deposit amount is dropped when the state is not deposit', async () => {
    const f = await ctx.call('POST', `/api/trips/${tripId}/items`, owner, {
      type: 'hotel', title: 'Hotel Roma', startLocal: '2027-05-08', cost: 180, currency: 'EUR', paymentStatus: 'paid', paidAmount: 50,
    });
    assert.equal(f.body.paidAmount, null);
    const back = await ctx.call('PATCH', `/api/items/${f.body.id}`, owner, { paymentStatus: 'deposit', paidAmount: 60 });
    assert.deepEqual([back.body.paymentStatus, back.body.paidAmount], ['deposit', 60]);
    const open = await ctx.call('PATCH', `/api/items/${f.body.id}`, owner, { paymentStatus: 'open' });
    assert.deepEqual([open.body.paymentStatus, open.body.paidAmount], ['open', null]);
  });

  test('changing the cruise keeps price and payment unless they are sent', async () => {
    const list = (await ctx.call('GET', `/api/trips/${tripId}`, owner)).body.cruises;
    const res = await ctx.call('PATCH', `/api/cruises/${list[0].id}`, owner, { cabin: '8142' });
    assert.deepEqual([res.body.cabin, res.body.cost, res.body.paymentStatus, res.body.paidAmount], ['8142', 3480, 'deposit', 500]);
  });

  test('invalid payment input is rejected', async () => {
    const bad = [
      { paymentStatus: 'bald' },
      { paidAmount: -5, paymentStatus: 'deposit' },
      { dueDate: '1.3.2027' },
    ];
    for (const b of bad) {
      const res = await ctx.call('POST', `/api/trips/${tripId}/items`, owner, { type: 'parking', title: 'P', startLocal: '2027-05-09', cost: 10, ...b });
      assert.equal(res.status, 400, JSON.stringify(b));
    }
  });

  test('strangers get no costs', async () => {
    const other = (await ctx.call('POST', '/api/users', owner, { username: 'fremd', displayName: 'F', password: 'fremdpass1' })).body;
    const token = (await ctx.call('POST', '/api/auth/login', undefined, { username: 'fremd', password: 'fremdpass1' })).body.token;
    assert.ok(other.id);
    assert.equal((await ctx.call('GET', `/api/trips/${tripId}/costs`, token)).status, 404);
  });
});
