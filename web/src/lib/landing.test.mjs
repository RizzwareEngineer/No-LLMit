// A hole card's landing pose, under plain Node.
// Run from web/: node --experimental-strip-types --test src/lib/landing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { landing } = await import('./landing.ts');

test('landing: the same hand, seat and card land the same', () => {
  assert.deepEqual(landing(812, 3, 1), landing(812, 3, 1));
});

test('landing: the two cards, the seats and the hands land at different angles', () => {
  for (let hand = 1; hand < 200; hand++) for (let seat = 0; seat < 9; seat++) {
    const [a, b] = [landing(hand, seat, 0), landing(hand, seat, 1)];
    assert.notEqual(a.rotate, b.rotate);
    assert.notEqual(a.rotate, landing(hand, (seat + 1) % 9, 0).rotate);
    assert.notEqual(a.rotate, landing(hand + 1, seat, 0).rotate);
  }
  // Spread over the range, not bunched.
  const angles = Array.from({ length: 900 }, (_, i) => landing(i, i % 9, i % 2).rotate);
  assert.ok(Math.min(...angles) < -30 && Math.max(...angles) > 30);
});

test('landing: within -35 to 35 degrees, its outer side inside the slot (the inner one may lie over the other card), at most 1px up or down', () => {
  for (let hand = 0; hand < 500; hand++) for (let seat = 0; seat < 9; seat++) for (const slot of [0, 1]) {
    const { rotate, x, y } = landing(hand, seat, slot), r = Math.abs(rotate) * Math.PI / 180;
    assert.ok(Math.abs(rotate) <= 35, `${rotate}`);
    const half = (28 * Math.cos(r) + 40 * Math.sin(r)) / 2; // the turned card's half width
    assert.ok(slot ? 14 + x + half <= 28 + 1e-9 : 14 + x - half >= -1e-9, `slot ${slot}: ${x} at ${rotate}`);
    assert.ok(Math.abs(y) <= 1);
  }
});
