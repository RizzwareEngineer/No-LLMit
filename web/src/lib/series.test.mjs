// Trends' y fit: robustRange, and where a zoom's fit starts (fitFrom).
// Run from web/: node --experimental-strip-types --test src/lib/series.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitFrom, robustRange } from './series.ts';

test('at rest the lines fit from their recent quarter and the EV lines not at all', () => {
  assert.deepEqual(fitFrom(1), { lines: 0.75, evs: 1 });
});

test('a narrow zoom fits its whole window, EV lines included', () => {
  const { lines, evs } = fitFrom(20 / 1250);
  assert.ok(lines < 0.02 && evs < 0.001 && evs <= lines);
});

test('both cuts move continuously: one pinch notch (3%) moves either by under 6% of the window', () => {
  for (let s = 1; s > 0.05; s *= 0.97) {
    const [a, b] = [fitFrom(s), fitFrom(s * 0.97)];
    assert.ok(Math.abs(a.lines - b.lines) < 0.06 && Math.abs(a.evs - b.evs) < 0.06, `share ${s.toFixed(3)}`);
  }
});

test('below a three-quarter window the EV lines fit at least the lines\' stretch', () => {
  for (let s = 0.01; s <= 0.75; s += 0.01) assert.ok(fitFrom(s).evs <= fitFrom(s).lines + 1e-12, `share ${s.toFixed(2)}`);
});

test('a zoomed stretch\'s values are all inside its range when they are all must', () => {
  const vs = [-2400, -30, 5, 12, 40, 1500];
  const [lo, hi] = robustRange(vs, [], vs);
  assert.ok(vs.every(v => v > lo && v < hi));
});
