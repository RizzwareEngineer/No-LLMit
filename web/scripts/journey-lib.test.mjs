// node --test scripts/journey-lib.test.mjs (from web/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './journey-lib.mjs';

const run = (i, ttc, landed) => ({ size: 'phone', run: i, total: {}, steps: [{ name: 'to-trends', ttc, regions: { trends: { found: true, fromEnd: ttc, ...(landed ? { wrongWindow: true, landed } : {}) } } }] });
test('a swipe that lands on the wrong window is a miss and fails the verdict (R6-9)', () => {
  const s = summarize([run(1, 120), run(2, 200, 'profiles'), run(3, 150)], 300).swipe['to-trends'];
  assert.notEqual(s.verdict, 'within target every run');
  assert.match(s.verdict, /2|3/); assert.match(s.verdict, /1 landed on the wrong window/);
  assert.deepEqual(s.landedElsewhere, ['profiles']);
  assert.equal(s.within, 2);
});
test('every swipe on its window within target passes', () => {
  assert.equal(summarize([run(1, 120), run(2, 200)], 300).swipe['to-trends'].verdict, 'within target every run');
});
