// The tables overview's machine: whatever the order of inputs and animation ends, the stage ends where the URL says.
// Run from web/: node --experimental-strip-types --test src/lib/overviewMachine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextAnim, stageKeyOf, targetOf } from './overviewMachine.ts';

const KEYS = ['a', 'b', 'c', 'd'];

test('the target is the URL\'s table, none for a key no table has', () => {
  assert.equal(targetOf('b', KEYS), 'b');
  assert.equal(targetOf('zz', KEYS), null);
  assert.equal(targetOf(null, KEYS), null);
  assert.equal(targetOf('zz', []), 'zz', 'before the tables are known, the URL is taken at its word');
});

test('one step toward the target: in, out or a slide the way it lies on the grid', () => {
  assert.equal(nextAnim(1, 'a', 'a', KEYS, 2), null);
  assert.equal(nextAnim(1, null, null, KEYS, 2), null);
  assert.deepEqual(nextAnim(1, null, 'c', KEYS, 2), { id: 1, kind: 'in', from: null, to: 'c', v: [0, 0] });
  assert.deepEqual(nextAnim(1, 'c', null, KEYS, 2), { id: 1, kind: 'out', from: 'c', to: null, v: [0, 0] });
  assert.deepEqual(nextAnim(1, 'a', 'b', KEYS, 2).v, [1, 0]);
  assert.deepEqual(nextAnim(1, 'b', 'c', KEYS, 2).v, [-1, 1]);
  assert.deepEqual(nextAnim(1, 'd', 'b', KEYS, 2).v, [0, -1]);
});

test('the stage draws the table an animation leaves, then the one it goes to', () => {
  assert.equal(stageKeyOf('a', null), 'a');
  assert.equal(stageKeyOf(null, null), null);
  assert.equal(stageKeyOf(null, { kind: 'in', from: null, to: 'b' }), 'b');
  assert.equal(stageKeyOf('b', { kind: 'out', from: 'b', to: null }), 'b');
  assert.equal(stageKeyOf('a', { kind: 'slideOut', from: 'a', to: 'b' }), 'a');
  assert.equal(stageKeyOf('a', { kind: 'slideIn', from: 'a', to: 'b' }), 'b');
});

// The page's loop, as page.tsx runs it: inputs only move the URL; an animation's end (if still the running one) sets
// what is shown, and at rest the next step starts. Random interleavings of inputs and ends always settle on the URL.
test('every interleaving of inputs and animation ends settles where the URL says', () => {
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  for (let run = 0; run < 2000; run++) {
    let url = rnd(2) ? null : KEYS[rnd(4)], shown = undefined, anim = null, id = 0;
    const settle = () => {
      if (shown === undefined) shown = targetOf(url, KEYS);
      if (!anim) anim = nextAnim(++id, shown, targetOf(url, KEYS), KEYS, 2);
    };
    const end = () => {
      if (!anim) return;
      if (anim.kind === 'slideOut') anim = { ...anim, kind: 'slideIn' };
      else { shown = anim.to; anim = null; }
    };
    settle();
    for (let k = 0; k < 12; k++) {
      const r = rnd(5);
      if (r === 0) url = KEYS[rnd(4)]; // a click, an edge, Forward
      else if (r === 1) url = null; // Esc, All tables, Back
      else if (r === 2) url = 'gone'; // a key no table has
      else end();
      settle();
      const drawn = stageKeyOf(shown, anim);
      if (shown === null && !anim) assert.equal(drawn, null);
    }
    for (let k = 0; k < 10 && anim; k++) { end(); settle(); }
    assert.equal(anim, null, `run ${run} still animating`);
    assert.equal(shown, targetOf(url, KEYS), `run ${run} settled on ${shown}, the URL says ${url}`);
  }
});
