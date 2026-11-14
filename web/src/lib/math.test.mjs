// The stats, replay and amount math, under plain Node.
// Run from web/: node --experimental-strip-types --test src/lib/math.test.mjs
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// stats.ts and timeline.ts import '@/lib/...': map that alias to this folder so Node can load them.
const lib = new URL('./', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export const resolve = (s, c, next) => next(s.startsWith('@/lib/') ? '${lib}' + s.slice(6) + '.ts' : s, c);`));
const { bb100Among, bb100Of, diffValues, leaderBy, sameValues } = await import('./stats.ts');
const { handsTogetherAt, lastAtOrBefore, matchupsAt, parse, playedAt, profilesAt } = await import('./timeline.ts');
const { formatAmount } = await import('./amounts.ts');

test('diffValues: changed shared keys only, new minus old', () => {
  const d = diffValues({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, c: 1, d: 9 });
  assert.equal(d.size, 2);
  assert.equal(d.get('b'), 3);
  assert.equal(d.get('c'), -2);
  assert.ok(!d.has('d'));
  assert.equal(diffValues({}, { a: 1 }).size, 0, 'a first snapshot changes nothing');
});

test('sameValues', () => {
  assert.ok(sameValues({ a: 1 }, { a: 1 }));
  assert.ok(!sameValues({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!sameValues({ a: 1 }, { a: 2 }));
});

test('bb100Of, bb100Among and leaderBy', () => {
  assert.equal(bb100Of(500, 10, 200), 25);
  assert.equal(bb100Of(5, 10, 0), null);
  const vs = { B: { pots: 3, net_chips: 300, hands: 100 }, C: { pots: 1, net_chips: -100, hands: 300 }, D: { pots: 1, net_chips: 900, hands: 10 } };
  const among = bb100Among({ name: 'A', vs }, new Set(['A', 'B', 'C']), 10);
  assert.deepEqual([among.hands, among.net, among.bb100], [400, 200, 5], 'the shown opponents only, weighted by hands together');
  assert.equal(leaderBy([{ hands: 600, bb100: 2 }, { hands: 499, bb100: 9 }, { hands: 500, bb100: 5 }])?.bb100, 5, 'MIN_HANDS, then bb/100');
  assert.equal(leaderBy([{ hands: 10, bb100: 1 }]), null);
});

test('the replay timeline: lastAtOrBefore, playedAt, handsTogetherAt, matchupsAt, profilesAt', () => {
  assert.deepEqual([24, 50, 99].map(h => lastAtOrBefore([25, 50, 75], h)), [-1, 1, 2]);
  const tl = parse({
    hands: 50, models: ['A', 'B'],
    profiles: { fields: ['hand', 'model', 'hands', 'bb100', 'vpip', 'pfr', 'af'], rows: [[25, 0, 25, 10, 0.5, 0.2, 1], [50, 0, 50, 20, 0.5, 0.2, 1], [50, 1, 10, -5, 0.3, 0.1, null]] },
    matchups: { fields: ['hand', 'a', 'b', 'chips'], rows: [[3, 0, 1, 40], [40, 0, 1, -15]] },
    lineups: [[1, 0], [3, 0, 1], [10, 0], [41, 0, 1]], // B dealt in over hands 3-9 and from 41
  });
  assert.deepEqual([playedAt(tl, 'A', 25), playedAt(tl, 'B', 25), playedAt(tl, 'B', 45)], [25, 0, 8], 'exact on snapshots, linear between');
  assert.deepEqual([2, 5, 20, 50].map(h => handsTogetherAt(tl, 'A', 'B', h)), [0, 3, 7, 17], 'the runs both were dealt in, cut at the hand');
  const at = h => matchupsAt(tl, [{ name: 'A' }, { name: 'B' }], h);
  assert.ok(!('B' in at(2)[0].vs));
  assert.equal(at(39)[0].vs.B.net_chips, 40);
  assert.equal(at(39)[0].vs.B.hands, 7);
  assert.equal(at(40)[1].vs.A.net_chips, -25, 'running pair sums both ways, with hands together');
  const live = { name: 'A', cumulative_bb: [[50, 9]], three_bet: 0.1, aiev_bb100: 7, bb100_ci: [1, 2] };
  const [row] = profilesAt(tl, [live], 0).shown;
  assert.deepEqual([row.hands, row.bb100, row.three_bet, row.aiev_bb100, row.bb100_ci], [25, 10, null, null, null], "only the snapshot's figures, the rest null");
});

test('formatAmount: chips whole, big blinds one decimal under 100 BB, whole from 100', () => {
  const n = (v, d) => v.toLocaleString(undefined, { maximumFractionDigits: d });
  assert.equal(formatAmount(1234, null), n(1234, 0));
  assert.equal(formatAmount(55, 10), `${n(5.5, 1)} BB`);
  assert.equal(formatAmount(10, 10), `${n(1, 1)} BB`);
  assert.equal(formatAmount(1234, 10), `${n(123, 0)} BB`);
});
