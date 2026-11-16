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

test('a panel remounted mid-reason resumes where the typing stands, not at the first character', async () => {
  const { typedSoFar } = await import('./stream.ts');
  const text = 'x'.repeat(200); // 25 ms a character
  assert.equal(typedSoFar(text, '7:3', null, 1000), 0);
  assert.equal(typedSoFar(text, '7:3', { key: '7:2', at: 0 }, 1000), 0); // another turn
  assert.equal(typedSoFar(text, '7:3', { key: '7:3', at: 0 }, 1000), 40);
  assert.equal(typedSoFar(text, '7:3', { key: '7:3', at: 0 }, 6000), 201); // done: past the end, no cursor
  assert.equal(typedSoFar(text, '', { key: '', at: 0 }, 1000), 0); // no turn on screen: nothing to resume
});

test('a new turn with the same words types afresh, however soon it comes', async () => {
  const { typedSoFar } = await import('./stream.ts');
  const text = "Mock provider: random legal action, no model was called."; // the mock's one reason, 56 characters
  for (const pace of [0.3, 0.6, 1]) {
    // The next turn's reason mounts 15 s x pace after the last one began (5 s reasoning, 5 s after the action, 5 s thinking).
    assert.equal(typedSoFar(text, '12:4', { key: '12:3', at: 0 }, 15000 * pace, pace), 0, `pace ${pace}`);
    // The same words in the next hand's turn of the same number type afresh too.
    assert.equal(typedSoFar(text, '13:3', { key: '12:3', at: 0 }, 15000 * pace, pace), 0, `pace ${pace}`);
  }
});

test('a remount long after the reason finished typing shows it whole, not retyped', async () => {
  const { typedSoFar } = await import('./stream.ts');
  for (const chars of [16, 120, 600]) {
    const text = 'y'.repeat(chars);
    for (const pace of [0.3, 1]) {
      const done = chars * typingMs(chars, pace);
      assert.equal(typedSoFar(text, '5:2', { key: '5:2', at: 0 }, done + 30000, pace), chars + 1, `${chars} chars at pace ${pace}`);
      assert.equal(typedSoFar(text, '5:2', { key: '5:2', at: 0 }, 3 * 3600e3, pace), chars + 1); // the table closed for hours
    }
  }
});
