// The stream client's reconnect loop and message rules, under plain Node with a fake EventSource.
// Run from web/: node --experimental-strip-types --test src/lib/stream.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GameStream } from './api.ts';
import { applyMessage, applyStats } from './stream.ts';

// Every EventSource the client opens; the test makes each one open or fail.
let opened = [];
globalThis.EventSource = class {
  constructor(url) { this.url = url; this.closed = false; opened.push(this); }
  close() { this.closed = true; }
};
const fail = () => opened.at(-1).onerror(new Event('error'));
const open = () => opened.at(-1).onopen(new Event('open'));

const start = () => {
  opened = [];
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = new GameStream(), statuses = [];
  s.onStatus = st => statuses.push(st);
  s.connect().catch(() => {});
  return { s, statuses };
};
const wait = () => mock.timers.tick(30_000); // longer than any one reconnect delay (2 s x 10 x 1.5)
const message = () => opened.at(-1).onmessage({ data: JSON.stringify({ seq: 1, type: 'snapshot', payload: { tables: {} } }) });

test('two errors, then an open, end at open', () => {
  const { statuses } = start();
  fail(); wait();
  fail(); wait();
  open();
  assert.equal(statuses.at(-1), 'open');
  assert.equal(opened.length, 3);
  assert.ok(opened.slice(0, 2).every(es => es.closed), 'every failed stream is closed by the client');
  mock.timers.reset();
});

test('ten failed reconnects end at gave_up, and Retry starts a fresh round', () => {
  const { s, statuses } = start();
  fail(); // the first connect
  for (let i = 0; i < 10; i++) { assert.equal(statuses.at(-1), 'reconnecting'); wait(); fail(); }
  assert.equal(statuses.at(-1), 'gave_up');
  assert.equal(opened.length, 11);
  wait();
  assert.equal(opened.length, 11, 'nothing more after giving up');
  s.retry(); open();
  assert.equal(statuses.at(-1), 'open');
  mock.timers.reset();
});

test('a stream that opens and ends before any message keeps backing off to gave_up; a message resets the count', () => {
  let { statuses } = start();
  for (let i = 0; i < 10; i++) { open(); fail(); wait(); }
  open(); fail();
  assert.equal(statuses.at(-1), 'gave_up');
  mock.timers.reset();
  ({ statuses } = start());
  for (let i = 0; i < 9; i++) { open(); fail(); wait(); }
  open(); message(); fail(); wait();
  for (let i = 0; i < 9; i++) { fail(); wait(); }
  assert.equal(statuses.at(-1), 'reconnecting', 'after a message the count starts over');
  mock.timers.reset();
});

test('the first reopen waits at most 1 s, later ones 2 s x n x 0.5 to 1.5', () => {
  mock.method(Math, 'random', () => 0.999);
  start();
  fail();
  mock.timers.tick(998); assert.equal(opened.length, 1);
  mock.timers.tick(2); assert.equal(opened.length, 2);
  fail(); // attempt 2: 2 s x 2 x 1.499
  mock.timers.tick(5995); assert.equal(opened.length, 2);
  mock.timers.tick(2); assert.equal(opened.length, 3);
  mock.timers.reset(); mock.restoreAll();
});

const T = 'tbl_0000000000000001';
const state = (handNumber) => ({ handNumber, players: [] });
const snap = (t) => ({ seq: 9, type: 'snapshot', payload: { tables: { [T]: { state: state(4), turn: null, notice: null, buttonCards: [], buttonWinner: null, turnApplied: false, ...t } } } });

test('a snapshot keeps the turn on screen and replaces everything else', () => {
  let t = applyMessage({}, { seq: 1, table: T, type: 'game_state', payload: state(4) }, 0);
  t = applyMessage(t, { seq: 2, table: T, type: 'table_notice', payload: { kind: 'cap', message: 'x' } }, 0);
  t = applyMessage(t, { seq: 3, table: T, type: 'button_card', payload: { playerIdx: 0, playerName: 'A', card: 'Ah' } }, 0);
  const thinking = { type: 'llm_thinking', payload: { turn: 5, playerIdx: 2, playerName: 'B' } };
  t = applyMessage(t, { seq: 4, table: T, ...thinking }, 1000);
  const kept = applyMessage(t, snap({ turn: thinking, buttonCards: [{ playerIdx: 0, playerName: 'A', card: 'Ah' }] }), 5000);
  assert.equal(kept[T].display.turnStartTime, 1000, 'same hand, seat and phase: display and clock kept');
  assert.equal(kept[T].notice, null, 'a null notice clears the one on screen');
  assert.equal(kept[T].buttonDetermination.cards.length, 1, 'button cards replaced, not appended');
  const fresh = applyMessage(t, snap({ turn: { type: 'llm_thinking', payload: { turn: 6, playerIdx: 3, playerName: 'C' } } }), 5000);
  assert.equal(fresh[T].display.turnStartTime, 5000, 'another turn: set as if just arrived');
  assert.equal(applyMessage(t, snap({}), 5000)[T].display, null, 'a null turn clears the display');
  assert.deepEqual(Object.keys(applyMessage(t, { seq: 9, type: 'snapshot', payload: { tables: {} } }, 0)), [], 'tables absent are dropped');
});

test('changed stats rows replace held rows by name, in model_names order', () => {
  const full = { generated_at: 'a', sessions: [], seated: [], partial: true, models: [{ name: 'A', hands: 1 }, { name: 'B', hands: 1 }] };
  assert.equal(applyStats(null, full), full);
  const next = applyStats(full, { generated_at: 'b', sessions: [], seated: [], partial: false, model_names: ['C', 'B', 'A'], changed: [{ name: 'C', hands: 1 }, { name: 'A', hands: 2 }] });
  assert.deepEqual(next.models, [{ name: 'C', hands: 1 }, { name: 'B', hands: 1 }, { name: 'A', hands: 2 }]);
  assert.equal(next.partial, false);
  assert.equal('changed' in next, false);
});

test('with nothing held, a changed form stands in for the full body only when it carries every row', () => {
  const env = { generated_at: 'a', sessions: [], seated: [], partial: false };
  assert.equal(applyStats(null, { ...env, model_names: ['A', 'B'], changed: [{ name: 'A', hands: 1 }] }), null, 'a row missing: wait for a full body');
  const all = applyStats(null, { ...env, model_names: ['B', 'A'], changed: [{ name: 'A', hands: 1 }, { name: 'B', hands: 2 }] });
  assert.deepEqual(all.models, [{ name: 'B', hands: 2 }, { name: 'A', hands: 1 }]);
  assert.equal('changed' in all, false);
});

test('a snapshot shows thinking, reasoning or revealed, and keeps the very display object of the turn on screen', () => {
  const thinking = { type: 'llm_thinking', payload: { turn: 5, playerIdx: 2, playerName: 'B' } };
  const action = { type: 'llm_action', payload: { turn: 5, playerIdx: 2, playerName: 'B', action: 'RAISE', amount: 60, reason: 'strong' } };
  const phase = (t) => t[T].display.phase;
  // A joiner: each phase from the snapshot alone.
  assert.equal(phase(applyMessage({}, snap({ turn: thinking }), 0)), 'thinking');
  assert.equal(phase(applyMessage({}, snap({ turn: action }), 0)), 'reasoning');
  assert.equal(phase(applyMessage({}, snap({ turn: action, turnApplied: true }), 0)), 'revealed');

  let t = applyMessage({}, { seq: 1, table: T, type: 'game_state', payload: state(4) }, 0);
  t = applyMessage(t, { seq: 2, table: T, ...thinking }, 1000);
  const think = t[T];
  // Thinking on screen, the action arrived while the stream was down: the turn's start and clock carry over.
  const acted = applyMessage(t, snap({ turn: action }), 4000)[T];
  assert.equal(acted.display.phase, 'reasoning');
  assert.equal(acted.display.turnStartTime, 1000);
  assert.equal(acted.clock, think.clock, 'the shot clock is kept');

  t = applyMessage(t, { seq: 3, table: T, ...action }, 3000);
  const reasoning = t[T];
  const same = applyMessage(t, snap({ turn: action }), 6000)[T];
  assert.equal(same.display, reasoning.display, 'the same turn keeps the very same display object');
  assert.equal(same.clock, reasoning.clock);
  const applied = applyMessage(t, snap({ turn: action, turnApplied: true }), 6000)[T];
  assert.equal(applied.display.phase, 'revealed', 'applied: reasoning moves to revealed');
  assert.equal(applied.display.turnStartTime, 1000);
  assert.equal(applied.clock.running, false);

  t = applyMessage(t, { seq: 4, table: T, type: 'game_state', payload: state(4) }, 7000);
  const revealed = t[T];
  const again = applyMessage(t, snap({ turn: action, turnApplied: true }), 9000)[T];
  assert.equal(again.display, revealed.display, 'revealed stays the very same object');
  assert.equal(again.clock, revealed.clock);

  // The same seat acting again with the same words is still a new turn: the turn number tells them apart.
  const other = { type: 'llm_action', payload: { ...action.payload, turn: 7 } };
  const replaced = applyMessage(t, snap({ turn: other, turnApplied: true }), 9000)[T];
  assert.notEqual(replaced.display, revealed.display, 'a different turn replaces it');
  assert.equal(replaced.display.turn, 7);
  assert.equal(replaced.display.turnStartTime, 9000);
});
