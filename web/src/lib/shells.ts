import type { GameState, PlayerState } from '@/lib/api';
import type { TableView } from '@/lib/stream';

// ?tables=1&shells=N (a draft): the overview filled up to N tables with SHELLS: the real table drawn from a fixed,
// made-up state (a plausible spot mid-hand), no stream, no motion, not a way into a live table. For trying out layouts
// of many tables before there are that many. Deterministic: shell i is the same picture on every load.

export type ShellTable = TableView & { key: string; shell: true };

const NAMES = ['Claude Haiku 5.5', 'DeepSeek V4 Flash', 'Llama 4 Maverick', 'Qwen3 235B A22B', 'Mistral Large 3',
  'Nemotron 3.5 Super', 'Cohere Command R7B', 'Qwen 3.7 Flash', 'Llama 3.1 8B'];
const POS = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'];
const STAKES = [[2, 5], [10, 20], [100, 200], [1, 2], [25, 50], [5, 10], [50, 100], [200, 400]] as const;
const DEPTHS = [100, 200, 100, 500, 200, 100, 300, 200] as const;
const STREETS = [['preflop', 0], ['flop', 3], ['turn', 4], ['river', 5]] as const;
const RANKS = '23456789TJQKA', SUITS = 'hdcs';

// A small seeded generator (mulberry32), so each shell is its own picture and the same one every time.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function shellTable(i: number): ShellTable {
  const r = rng(1009 * (i + 1)), [sb, bb] = STAKES[i % STAKES.length], depth = DEPTHS[(i * 3) % DEPTHS.length];
  const [street, nBoard] = STREETS[i % STREETS.length];
  const deck = [...RANKS].flatMap(x => [...SUITS].map(s => x + s));
  for (let k = deck.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [deck[k], deck[j]] = [deck[j], deck[k]]; }
  const btn = Math.floor(r() * 9), start = depth * bb;
  // Later streets: fewer seats still in (preflop most of them, the river two or three).
  const keep = [7, 4, 3, 2][STREETS.findIndex(s => s[0] === street)];
  const inHand = new Set<number>();
  while (inHand.size < keep) inHand.add(Math.floor(r() * 9));
  const onClock = [...inHand][0];
  const bets = street === 'preflop' ? [0, 1, 3] : [0, 0, 4];
  let pot = 0;
  const players: PlayerState[] = Array.from({ length: 9 }, (_, s) => {
    const live = inHand.has(s), seat = (s - btn + 9) % 9;
    // Stacks spread round the starting stack: some short, some deep.
    const stack = Math.max(0, Math.round(start * (0.25 + r() * 1.9) / bb) * bb);
    const bet = live && s !== onClock ? bets[Math.floor(r() * bets.length)] * bb : 0;
    pot += bet + (live ? Math.round(r() * 6) * bb : Math.round(r() * 2) * bb);
    return {
      id: `shell-${i}-${s}`, name: NAMES[(s + i * 2) % NAMES.length], stack, holeCards: [deck[2 * s], deck[2 * s + 1]],
      status: live ? 'active' : 'folded', currentBet: bet, lastAction: live ? (bet ? (bet > bb ? 'RAISE' : 'CALL') : 'CHECK') : 'FOLD',
      lastAmount: bet, acted: s !== onClock, isButton: s === btn, position: POS[seat], winnings: 0,
    };
  });
  const gameState: GameState = {
    handNumber: 40 + i * 7, street, pot: pot + 3 * bb, communityCards: deck.slice(18, 18 + nBoard), currentPlayerIdx: onClock,
    buttonIdx: btn, players, stakes: { smallBlind: sb, bigBlind: bb }, gameStartTime: '2026-01-01T00:00:00Z',
  };
  return { key: `shell-${i}`, shell: true, gameState, notice: null, display: null, clock: null, buttonDetermination: null, dealAt: null, startingStack: start };
}

const cache = new Map<number, ShellTable>();
// Shells numbered from `from` (the live tables' count) up to `to` (exclusive), each made once.
export const shellTables = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => {
  const i = from + k;
  if (!cache.has(i)) cache.set(i, shellTable(i));
  return cache.get(i)!;
});
