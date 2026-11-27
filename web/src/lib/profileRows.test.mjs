// Profiles' dash rows: the seats only (the rows a reload's stand-in reserves), everyone with "All models".
// Run from web/: node --experimental-strip-types --test src/lib/profileRows.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashRows } from './profileRows.ts';

const SEATED = ['a', 'b', 'c'];

test('a model not seated with no hands yet at the replay\'s hand is no row by default', () => {
  assert.deepEqual(dashRows([], ['b', 'x', 'y'], SEATED, false), ['b']);
});

test('the rows stay the seats through a replay: as many at every hand as at rest', () => {
  // Hands joined per model at replay hands 0..3: x and y (not seated) join late, then are hidden others.
  const joined = { a: 0, b: 1, c: 2, x: 1, y: 3 };
  const rowsAt = h => {
    const withHands = Object.keys(joined).filter(m => joined[m] <= h);
    const pending = Object.keys(joined).filter(m => joined[m] > h);
    return withHands.filter(m => SEATED.includes(m)).length + dashRows([], pending, SEATED, false).length;
  };
  const rest = SEATED.length;
  for (const h of [0, 1, 2, 3]) assert.equal(rowsAt(h), rest, `hand ${h}`);
});

test('"All models" keeps everyone waiting for a hand, once each', () => {
  assert.deepEqual(dashRows(['c'], ['c', 'x'], SEATED, true), ['c', 'x']);
});

test('without a lineup every model waiting is a row', () => {
  assert.deepEqual(dashRows([], ['x', 'y'], undefined, false), ['x', 'y']);
});
