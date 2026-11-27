// The phone table's geometry: at the tables of 375x667 (351x467) and 390x844 (366x591), and around them, no two seats'
// logos, stacks and labels, hole cards or bets overlap, none overlaps the pot or the board, and all are inside the table;
// a seat's cards keep off its own stack and label even landed askew (they may tuck over the edge of its logo).
// Run from web/: node --experimental-strip-types --test src/lib/phoneTable.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHIP, CHIP_TOP, DECK, LOGO, MIDDLE, POT_TOP, TEXT_BOX, at, bubbleAt, seatBox, seatLabel, seatSpots } from './phoneTable.ts';

const layout = (W, H) => {
  const my = at(MIDDLE, H), cx = W / 2, boxes = [];
  seatSpots(9).forEach((s, i) => {
    const x = at(s.x, W), y = at(s.y, H), c = [x + s.cards[0], y + s.cards[1]], b = [x + s.bet[0], y + s.bet[1]];
    boxes.push(
      { k: `${i} logo`, seat: i, r: [x - LOGO / 2, y - LOGO / 2, x + LOGO / 2, y + LOGO / 2] },
      { k: `${i} text`, seat: i, r: TEXT_BOX.map((v, j) => v + (j % 2 ? y : x)) },
      { k: `${i} chip`, seat: i, r: [x - CHIP.w / 2, y + CHIP_TOP, x + CHIP.w / 2, y + CHIP_TOP + CHIP.h] },
      { k: `${i} cards`, seat: i, r: [c[0] - 30, c[1] - 20, c[0] + 30, c[1] + 20], askew: [c[0] - 32, c[1] - 26, c[0] + 32, c[1] + 26] },
      { k: `${i} bet`, seat: i, r: [b[0] - 24, b[1] - 9, b[0] + 24, b[1] + 9] },
    );
  });
  boxes.push({ k: 'pot', r: [cx - 50, my + POT_TOP, cx + 50, my + POT_TOP + 30] }, { k: 'board', r: [cx - 84, my - 2, cx + 84, my + 42] },
    { k: 'deck', between: true, r: [cx - DECK.w / 2, my + DECK.top, cx + DECK.w / 2, my + DECK.top + DECK.h] });
  return boxes;
};
const grow = (r, g) => [r[0] - g, r[1] - g, r[2] + g, r[3] + g];
const meet = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0;

// The tables of 375x667 (351x465), 390x844 (366x642) and 430x932 (406x730), and around them.
const TABLES = [[351, 465], [366, 642], [406, 730], [359, 460], [374, 600], [351, 520], [390, 700], [374, 680]];
for (const [W, H] of TABLES) {
  test(`nothing overlaps on a ${W}x${H} table, and no two seats crowd each other`, () => {
    const boxes = layout(W, H), bad = [];
    for (const [i, a] of boxes.entries()) {
      if (a.r[0] < 0 || a.r[1] < 0 || a.r[2] > W || a.r[3] > H) bad.push(`${a.k} outside`);
      for (const b of boxes.slice(i + 1)) {
        if ((a.between || b.between) && [a.k, b.k].some(k => k.endsWith('bet') || k === 'board')) continue; // the deck shows between hands, in the board's place, with no bets out
        const own = a.seat !== undefined && a.seat === b.seat, kinds = [a.k, b.k].map(k => k.split(' ')[1]).sort().join('+');
        if (own && kinds === 'cards+text' ? meet((a.askew ?? b.askew), (a.askew ? b : a).r) : !own || kinds.includes('bet') || kinds === 'cards+chip' ? meet(a.r, b.r) : false) bad.push(`${a.k} on ${b.k}`);
        // Room between players (owner 2026-11-15: "more spacing between each of these players"): two seats' logos and
        // stacks keep 8px apart.
        if (!own && a.seat !== undefined && b.seat !== undefined && /logo|text/.test(a.k) && /logo|text/.test(b.k) && meet(grow(a.r, 4), grow(b.r, 4))) bad.push(`${a.k} within 8px of ${b.k}`);
      }
    }
    assert.deepEqual(bad, []);
  });
}

// Each seat's action bubble (20px tall; 'Fold', 'Call 20' and 'Raise 632' are 44, 58 and 76px at 12px bold) keeps off
// its own cards, logo, chip, stack and bet, off every other seat's logo, stack, label, cards and bet, off the pot and the
// board, and on the screen, at the tables the page draws from 360x640 to 430x932 and around them.
for (const [W, H] of [...TABLES, [326, 460], [341, 465], [356, 642], [396, 730]]) {
  test(`no action bubble covers anything else on a ${W}x${H} table`, () => {
    const spots = seatSpots(9).map(s => ({ s, x: at(s.x, W), y: at(s.y, H) })), bad = [];
    const my = at(MIDDLE, H), cx = W / 2, pot = [cx - 50, my + POT_TOP, cx + 50, my + POT_TOP + 30], board = [cx - 84, my - 2, cx + 84, my + 42];
    const parts = (o, own) => {
      const c = [o.x + o.s.cards[0], o.y + o.s.cards[1]], b = [o.x + o.s.bet[0], o.y + o.s.bet[1]];
      return { logo: [o.x - LOGO / 2, o.y - LOGO / 2, o.x + LOGO / 2, o.y + LOGO / 2], stack: (own ? [-28, LOGO / 2 + 4, 28, LOGO / 2 + 18] : TEXT_BOX).map((v, k) => v + (k % 2 ? o.y : o.x)),
        chip: [o.x - CHIP.w / 2, o.y + CHIP_TOP, o.x + CHIP.w / 2, o.y + CHIP_TOP + CHIP.h], cards: [c[0] - 30, c[1] - 20, c[0] + 30, c[1] + 20], bet: [b[0] - 24, b[1] - 10, b[0] + 24, b[1] + 10] };
    };
    spots.forEach((o, i) => {
      const b = bubbleAt(o.s);
      for (const w of [44, 58, 76]) {
        const l = o.x + b.x - (b.align === 'center' ? w / 2 : 0), box = [l, o.y + b.top, l + w, o.y + b.top + 20];
        if (box[0] < -12 || box[1] < 0 || box[2] > W + 12) bad.push(`seat ${i}'s ${w}px bubble off the screen`); // the page's 12px gutter
        if (meet(box, pot)) bad.push(`seat ${i}'s ${w}px bubble on the pot`);
        if (meet(box, board)) bad.push(`seat ${i}'s ${w}px bubble on the board`);
        // Its own label is the one thing it may cover (under the logo, the stack's line stays clear).
        spots.forEach((q, j) => { for (const [k, r] of Object.entries(parts(q, j === i))) if (meet(box, r)) bad.push(`seat ${i}'s ${w}px bubble on ${j === i ? 'its own' : `seat ${j}'s`} ${k}`); });
      }
    });
    assert.deepEqual([...new Set(bad)], []);
  });
}

test('every seat sits on the edge, clockwise, the left half mirroring the right', () => {
  const s = seatSpots(9), x = s.map(p => at(p.x, 374)), y = s.map(p => at(p.y, 591));
  for (const [l, r] of [[0, 2], [8, 3], [7, 4], [6, 5]]) assert.ok(Math.abs(x[l] + x[r] - 374) < 1e-9 && Math.abs(y[l] - y[r]) < 1e-9, `${l} mirrors ${r}`);
  assert.ok(x[0] < x[1] && x[1] < x[2] && y[2] < y[3] && y[3] < y[4] && y[4] < y[5] && x[6] < x[5]);
  for (const p of s) { const b = seatBox(p); assert.ok(b.left <= p.cards[0] - 32 && b.top <= p.cards[1] - 26 && b.left + b.width >= p.cards[0] + 32 && b.top + b.height >= p.cards[1] + 26); }
});

test('the seat label tells a family\'s models apart', () => {
  const got = ['GPT-OSS 120B', 'GPT-OSS 20B', 'Gemma 3 27B', 'Gemma 3 12B', 'Qwen3 235B A22B', 'Qwen3 32B', 'DeepSeek V3.2', 'DeepSeek V4 Flash',
    'Claude Haiku 5.5', 'Llama 4 Maverick', 'Mistral Large 3', 'Cohere Command R7B', 'Qwen 3.7 Flash', 'Phi-4', 'Kimi K2'].map(seatLabel);
  assert.deepEqual(got, ['120B', '20B', '27B', '12B', '235B', '32B', 'V3.2', 'V4 Flash', 'Haiku', 'Maverick', 'Large', 'R7B', 'Flash', 'Phi-4', 'K2']);
});

test('between hands the deck sits at least 8px under the pot (the audit: over the pot it covered the P of POT)', () => {
  assert.ok(DECK.top - (POT_TOP + 30) >= 8, `${DECK.top - (POT_TOP + 30)}px`);
});
