// The reason's typing speed. Run from web/: node --experimental-strip-types --test src/lib/typing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typingMs } from './stream.ts';

test('25 ms per character times the pace, 1 when absent', () => {
  assert.equal(typingMs(100), 25);
  assert.equal(typingMs(100, 0), 25);
  assert.equal(typingMs(100, 0.5), 12.5);
  assert.equal(typingMs(100, 1.5), 37.5);
});

test('a reason ends inside the reasoning pause plus the pause after the action, at any pace', () => {
  for (const pace of [0.1, 0.25, 0.5, 1, 1.5, 2]) {
    for (const chars of [1, 50, 200, 395, 400, 600, 1000, 5000]) {
      // The engine waits clamp(25 ms x chars + 200 ms, 5 s, 10 s) + 5 s, times the pace, before the next turn.
      const engineMs = (Math.min(Math.max(25 * chars + 200, 5000), 10000) + 5000) * pace;
      assert.ok(chars * typingMs(chars, pace) <= engineMs + 1e-9, `${chars} chars at pace ${pace}`);
    }
  }
});
