// The phone table's geometry: at the tables of 375x667 (351x467) and 390x844 (366x591), and around them, no two seats'
// logos, stacks and labels, hole cards or bets overlap, none overlaps the pot or the board, and all are inside the table;
// a seat's cards keep off its own stack and label even landed askew (they may tuck over the edge of its logo).
// Run from web/: node --experimental-strip-types --test src/lib/phoneTable.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGO, MIDDLE, POT_TOP, TEXT_H, at, seatBox, seatLabel, seatSpots } from './phoneTable.ts';

const layout = (W, H) => {
  const my = at(MIDDLE, H), cx = W / 2, boxes = [];
  seatSpots(9).forEach((s, i) => {
    const x = at(s.x, W), y = at(s.y, H), c = [x + s.cards[0], y + s.cards[1]], b = [x + s.bet[0], y + s.bet[1]];
    boxes.push(
      { k: `${i} logo`, seat: i, r: [x - LOGO / 2, y - LOGO / 2, x + LOGO / 2, y + LOGO / 2] },
      { k: `${i} text`, seat: i, r: [x - 28, y + LOGO / 2 + 4, x + 28, y + LOGO / 2 + 4 + TEXT_H] },
      { k: `${i} cards`, seat: i, r: [c[0] - 30, c[1] - 20, c[0] + 30, c[1] + 20], askew: [c[0] - 32, c[1] - 26, c[0] + 32, c[1] + 26] },
      { k: `${i} bet`, seat: i, r: [b[0] - 24, b[1] - 9, b[0] + 24, b[1] + 9] },
    );
  });
  boxes.push({ k: 'pot', r: [cx - 50, my + POT_TOP, cx + 50, my + POT_TOP + 30] }, { k: 'board', r: [cx - 84, my - 2, cx + 84, my + 42] });
  return boxes;
};
const meet = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0;

for (const [W, H] of [[351, 467], [366, 591], [359, 467], [374, 591], [359, 460], [374, 523], [374, 557], [390, 600]]) {
  test(`nothing overlaps on a ${W}x${H} table`, () => {
    const boxes = layout(W, H), bad = [];
    for (const [i, a] of boxes.entries()) {
      if (a.r[0] < 0 || a.r[1] < 0 || a.r[2] > W || a.r[3] > H) bad.push(`${a.k} outside`);
      for (const b of boxes.slice(i + 1)) {
        const own = a.seat !== undefined && a.seat === b.seat, kinds = [a.k, b.k].map(k => k.split(' ')[1]).sort().join('+');
        if (own && kinds === 'cards+text' ? meet((a.askew ?? b.askew), (a.askew ? b : a).r) : !own || kinds.includes('bet') ? meet(a.r, b.r) : false) bad.push(`${a.k} on ${b.k}`);
      }
    }
    assert.deepEqual(bad, []);
  });
}

test('every seat sits on the rim, clockwise, the left half mirroring the right', () => {
  const s = seatSpots(9), x = s.map(p => at(p.x, 374)), y = s.map(p => at(p.y, 591));
  for (const [l, r] of [[0, 2], [8, 3], [7, 4], [6, 5]]) assert.ok(Math.abs(x[l] + x[r] - 374) < 1e-9 && Math.abs(y[l] - y[r]) < 1e-9, `${l} mirrors ${r}`);
  assert.ok(x[0] < x[1] && x[1] < x[2] && y[2] < y[3] && y[3] < y[4] && y[4] < y[5] && x[6] < x[5]);
  for (const p of seatSpots(9)) { const b = seatBox(p); assert.ok(b.left <= p.cards[0] - 32 && b.top <= p.cards[1] - 26 && b.left + b.width >= p.cards[0] + 32 && b.top + b.height >= p.cards[1] + 26); }
});

test('the seat label tells a family\'s models apart', () => {
  const got = ['GPT-OSS 120B', 'GPT-OSS 20B', 'Gemma 3 27B', 'Gemma 3 12B', 'Qwen3 235B A22B', 'Qwen3 32B', 'DeepSeek V3.2', 'DeepSeek V4 Flash',
    'Claude Haiku 5.5', 'Llama 4 Maverick', 'Mistral Large 3', 'Cohere Command R7B', 'Qwen 3.7 Flash', 'Phi-4', 'Kimi K2'].map(seatLabel);
  assert.deepEqual(got, ['120B', '20B', '27B', '12B', '235B', '32B', 'V3.2', 'V4 Flash', 'Haiku', 'Maverick', 'Large', 'R7B', 'Flash', 'Phi-4', 'K2']);
});
