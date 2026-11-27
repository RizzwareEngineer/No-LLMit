'use client';

import { memo, useEffect, useRef } from 'react';
import { ArrowDown } from '@phosphor-icons/react';
import { NEXT_BUTTON, NEXT_STYLE } from '@/components/Section';
import PokerTable from '@/components/PokerTable';
import Fit from '@/components/Fit';
import FitName from '@/components/FitName';
import LLMLogo from '@/components/LLMLogo';
import { TableBigBlind, formatAmount, useBigBlind } from '@/lib/amounts';
import { MUTED, TEXT } from '@/lib/stats';
import type { TableView } from '@/lib/stream';

// The tables overview (lib/tableSwitches' ?tables=1): every table at once, each a small live copy of the desktop table
// with its profit and loss beside it, and the profit and loss across all tables. A click zooms into one (page.tsx).

type KeyedTable = TableView & { key: string };

// The desktop table's box in layout px: 1000 across, four rows of 128 and its frame (PokerTable). Its corner cells (200 x 128,
// empty at every table size) carry the small table's own text: stakes and depth, the hand, the top winner and the top loser.
const TABLE_W = 1000, TABLE_H = 514, CORNER_W = 200, CORNER_H = 128;
// Below this scale a corner is too small for its text, and the cell takes a label line over the table instead.
const CORNERS_MIN = 0.5;
const GAP = 10, LABEL_H = 20, ALL_W = 196, ROW_H = 17, PNL_HEAD = 20, STRIP_H = 2 * ROW_H + 10;
const CARD = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };
const UP = 'rgb(15, 123, 108)', DOWN = 'rgb(200, 50, 50)';
// The stats tile-to-card glide's curve (Section's glideEase), shorter: a table is one picture, not a card's content.
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const ZOOM_MS = 360;

const stakesOf = (t: TableView) => t.gameState?.stakes ?? { smallBlind: 0, bigBlind: 0 };
// "5/10 · 200 bb": the stakes and the deepest a seat starts (the rebuy), in big blinds.
const tableLabel = (t: TableView) => {
  const { smallBlind, bigBlind } = stakesOf(t);
  return `${smallBlind}/${bigBlind}${t.startingStack && bigBlind ? ` · ${t.startingStack / bigBlind} bb` : ''}`;
};

// The overview's grid for `n` tables in a `w` x `h` box: the columns, the small table's scale, where the all-tables
// Profits & Losses goes (a slim column beside the grid, or a strip under it, whichever leaves the tables larger) and
// whether the cells carry their text in the table's corners or on a label line over it. The stage's edges use the same
// columns for their neighbours above and below.
export function gridFor(n: number, w: number, h: number) {
  let best = { cols: 1, rows: n, s: 0, all: 'side' as 'side' | 'below', corners: true, used: 0 };
  for (const all of ['side', 'below'] as const) for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (w - (all === 'side' ? ALL_W + GAP : 0) - (cols - 1) * GAP) / cols;
    const cellH = (h - (all === 'below' ? STRIP_H + GAP : 0) - (rows - 1) * GAP) / rows;
    // Never over its own size (one table is the desktop table, not a blow-up of it).
    let s = Math.min(1, cellW / TABLE_W, cellH / TABLE_H), corners = true;
    if (s < CORNERS_MIN) { corners = false; s = Math.min(cellW / TABLE_W, (cellH - LABEL_H) / TABLE_H); }
    s = Math.floor(s * 1000) / 1000;
    // The larger tables win; at the same size, the layout that leaves less of the box empty (the strip under the grid
    // takes up room the column beside it would leave as bands).
    const used = (rows * (TABLE_H * s + (corners ? 0 : LABEL_H)) + (rows - 1) * GAP + (all === 'below' ? STRIP_H + GAP : 0)) / h;
    if (s > best.s + 0.002 || (s > best.s - 0.002 && used > best.used)) best = { cols, rows, s, all, corners, used };
  }
  return best;
}

// PokerTable's props for a table drawn small (page.tsx works out the focused table's own).
function smallTable(t: TableView) {
  const g = t.gameState, d = t.display, complete = g?.street === 'complete';
  const winnersByIdx: Record<number, { amount: number; handDesc: string }> = {};
  if (complete) for (const w of g?.winners ?? []) {
    const e = (winnersByIdx[w.playerIdx] ??= { amount: 0, handDesc: w.handDesc || w.handType });
    e.amount += w.amount;
  }
  const onClock = d?.phase === 'thinking' || d?.phase === 'reasoning';
  return {
    players: g?.players ?? [], currentPlayerIdx: d?.playerIdx ?? g?.currentPlayerIdx ?? -1, communityCards: g?.communityCards ?? [],
    pot: g?.pot ?? 0, winnersByIdx, nextDealAt: complete ? t.dealAt : null, thinkingPlayerIdx: onClock ? d.playerIdx : undefined,
    buttonDetermination: t.buttonDetermination, notice: t.notice, street: g?.street ?? 'preflop', handNumber: g?.handNumber ?? 0,
    display: d, clock: onClock ? t.clock : null,
  };
}

// The desktop table drawn `width` px across as one picture (Fit's transform), in its own big blind. Not interactive: the
// cell or edge round it is the control.
// Memoized: every stream message renders the page, and a table unchanged by it keeps its object (useGameState).
const SmallTable = memo(function SmallTable({ t, width }: { t: TableView; width: number }) {
  return (
    <TableBigBlind.Provider value={stakesOf(t).bigBlind || null}>
      <div data-small-table inert aria-hidden style={{ width }}>
        <Fit w={TABLE_W}><PokerTable {...smallTable(t)} still /></Fit>
      </div>
    </TableBigBlind.Provider>
  );
});

const signed = (v: number, bb: number | null) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatAmount(Math.abs(v), bb, false)}`;
const colorOf = (v: number) => (v > 0 ? UP : v < 0 ? DOWN : MUTED);

// A number that flashes its colour when it changes, in place: its box is the text's, so nothing round it moves.
function Amount({ value, bb, className = '' }: { value: number; bb: number | null; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null), was = useRef(value);
  useEffect(() => {
    if (was.current === value) return;
    const up = value > was.current;
    was.current = value;
    ref.current?.animate([{ backgroundColor: up ? 'rgba(15, 123, 108, 0.18)' : 'rgba(200, 50, 50, 0.16)' }, { backgroundColor: 'rgba(0, 0, 0, 0)' }], { duration: 900, easing: 'ease-out' });
  }, [value]);
  return <span ref={ref} className={`rounded-sm font-bold tabular-nums whitespace-nowrap ${className}`} style={{ color: colorOf(value) }}>{signed(value, bb)}</span>;
}

// A corner's model: its name (the shortest form that fits the corner) over its logo and amount.
function PnlPair({ name, value, bb, end = false }: { name: string; value: number; bb: number | null; end?: boolean }) {
  return <>
    <div className="min-w-0" style={{ textAlign: end ? 'right' : undefined }}><FitName name={name} className="text-[12px] leading-4 font-medium" style={{ color: TEXT }} /></div>
    <div className={`flex items-center gap-1.5 ${end ? 'flex-row-reverse' : ''}`}><LLMLogo model={name} size={13} /><Amount value={value} bb={bb} className="text-[13px] leading-4" /></div>
  </>;
}

const leaders = (t: TableView) => {
  const ps = [...(t.gameState?.players ?? [])].map(p => ({ name: p.name, value: p.winnings || 0 })).sort((a, b) => b.value - a.value);
  return { top: ps[0]?.value > 0 ? ps[0] : null, last: ps.length && ps[ps.length - 1].value < 0 ? ps[ps.length - 1] : null };
};

// The small table's corners (its empty corner cells, in the overview's px): top left its stakes and depth (and a closed
// or paused notice); top
// right its hand; the foot its top winner (left) and top loser (right). The pot is the felt's own.
function Corners({ t, s, w, h, bb }: { t: KeyedTable; s: number; w: number; h: number; bb: number | null }) {
  const g = t.gameState, cw = CORNER_W * s, ch = CORNER_H * s, { top, last } = leaders(t);
  const at = (x: 'l' | 'r', y: 't' | 'b') => ({ position: 'absolute' as const, width: cw, height: ch, left: x === 'l' ? 0 : w - cw, top: y === 't' ? 0 : h - ch, padding: '6px 8px' });
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none text-[12px] leading-4 tabular-nums" style={{ color: MUTED }}>
      <div data-corner="label" className="flex flex-col gap-0.5" style={at('l', 't')}>
        <span className="font-bold whitespace-nowrap" style={{ color: TEXT }}>{tableLabel(t)}</span>
        {t.notice && <span className="whitespace-nowrap font-medium" style={{ color: DOWN }}>{t.notice.kind === 'closed' ? 'Closed' : 'Paused'}</span>}
      </div>
      <div data-corner="hand" className="flex flex-col items-end" style={at('r', 't')}>
        <span className="whitespace-nowrap">Hand #{g?.handNumber || '–'}</span>
      </div>
      <div data-corner="top" className="flex flex-col justify-end gap-0.5" style={at('l', 'b')}>
        {top && <PnlPair name={top.name} value={top.value} bb={bb} />}
      </div>
      <div data-corner="last" className="flex flex-col justify-end items-stretch gap-0.5" style={at('r', 'b')}>
        {last && <PnlPair name={last.name} value={last.value} bb={bb} end />}
      </div>
    </div>
  );
}

// One table's cell: the small table with its text in its corners (or, small, a label line over it), as one link into
// the table.
function Cell({ t, s, corners, onOpen }: { t: KeyedTable; s: number; corners: boolean; onOpen: (key: string) => void }) {
  const shown = useBigBlind(), { bigBlind } = stakesOf(t), bb = shown ? bigBlind : null;
  const g = t.gameState, w = Math.floor(TABLE_W * s), h = Math.floor(TABLE_H * s);
  const label = tableLabel(t), { top, last } = leaders(t);
  return (
    <a
      href={`?tables=1&t=${t.key}`}
      data-overview-cell={t.key}
      aria-label={`Table ${label.replace(' · ', ', ')}`}
      onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onOpen(t.key); } }}
      className="group flex flex-col rounded outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[rgb(31,111,196)]"
    >
      {!corners && <div data-cell-label className="flex items-baseline gap-2.5 whitespace-nowrap overflow-hidden text-[12px] tabular-nums" style={{ height: LABEL_H, width: w, color: MUTED }}>
        <span className="font-bold text-[13px]" style={{ color: TEXT }}>{label}</span>
        <span>Hand #{g?.handNumber || '–'}</span>
        <span>Pot {formatAmount(g?.pot ?? 0, bb)}</span>
        {top && <Amount value={top.value} bb={bb} />}
        {last && <Amount value={last.value} bb={bb} />}
        {t.notice && <span>{t.notice.kind === 'closed' ? 'Closed' : 'Paused'}</span>}
      </div>}
      <div className="relative transition-shadow rounded group-hover:shadow-[0_0_0_2px_rgba(31,111,196,0.35)]" style={{ width: w, height: h }}>
        <SmallTable t={t} width={w} />
        {corners && <Corners t={t} s={w / TABLE_W} w={w} h={h} bb={bb} />}
      </div>
    </a>
  );
}

// Across all tables in big blinds (stakes differ: chips do not add up), by model, best first.
function allTables(tables: KeyedTable[]) {
  const sums = new Map<string, number>();
  for (const t of tables) {
    const bb = stakesOf(t).bigBlind;
    for (const p of t.gameState?.players ?? []) if (bb) sums.set(p.name, (sums.get(p.name) ?? 0) + (p.winnings || 0) / bb);
  }
  return [...sums].map(([name, value]) => ({ name, value: Math.round(value * 10) / 10 })).sort((a, b) => b.value - a.value);
}

const Head = () => (
  <div className="flex items-center justify-between gap-2 px-2 whitespace-nowrap text-[11px] font-medium uppercase tracking-wider" style={{ height: PNL_HEAD }}>
    <span style={{ color: TEXT }}>All tables</span><span style={{ color: MUTED }}>BB</span>
  </div>
);
const Row = ({ name, value }: { name: string; value: number }) => (
  <div className="flex items-center gap-1.5 px-2 min-w-0" style={{ height: ROW_H }}>
    <LLMLogo model={name} size={13} />
    <div className="flex-1 min-w-0"><FitName name={name} className="text-[12px] leading-4 font-medium" style={{ color: TEXT }} /></div>
    <Amount value={value} bb={1} className="text-[12px] leading-4 shrink-0" />
  </div>
);

// The grid, centred in its box (`w` x `h`: the first screen under the header, page.tsx), and the all-tables Profits &
// Losses beside it or under it, with the way on to the stats at its end. Laid out from the box's size as given, in the
// render that mounts it: the zoom out measures a cell straight away.
export default function TablesOverview({ tables, w, h, onOpen, onStats }: { tables: KeyedTable[]; w: number; h: number; onOpen: (key: string) => void; onStats: () => void }) {
  const { cols, rows, s, all, corners } = gridFor(tables.length, w, h);
  const cellW = Math.floor(TABLE_W * s), cellH = Math.floor(TABLE_H * s) + (corners ? 0 : LABEL_H);
  const gridW = cols * cellW + (cols - 1) * GAP, gridH = rows * cellH + (rows - 1) * GAP;
  const sums = allTables(tables);
  const stats = (
    <button type="button" onClick={onStats} className={`shrink-0 ${NEXT_BUTTON}`} style={NEXT_STYLE}>
      Stats <ArrowDown size={16} weight="bold" aria-hidden />
    </button>
  );
  return (
    <div data-overview className="absolute inset-0 flex items-center justify-center">
      {s > 0 && (
        <div data-overview-grid className={`flex ${all === 'side' ? 'flex-row' : 'flex-col'}`} style={{ gap: GAP }}>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, ${cellW}px)`, gap: GAP }}>
            {tables.map(t => <Cell key={t.key} t={t} s={s} corners={corners} onOpen={onOpen} />)}
          </div>
          {all === 'side' ? (
            <div className="flex flex-col justify-between items-center" style={{ width: ALL_W, height: gridH }}>
              <div data-all-tables className="bg-white rounded w-full pb-1" style={CARD}>
                <Head />
                {sums.map(r => <Row key={r.name} {...r} />)}
              </div>
              {stats}
            </div>
          ) : (
            <div className="flex items-center gap-4" style={{ width: gridW, height: STRIP_H }}>
              <div data-all-tables className="flex-1 min-w-0 bg-white rounded flex items-center" style={{ ...CARD, height: STRIP_H }}>
                <div className="shrink-0"><Head /></div>
                <div className="flex-1 min-w-0 grid grid-flow-col pr-1" style={{ gridTemplateRows: `repeat(2, ${ROW_H}px)`, gridAutoColumns: 'minmax(0, 1fr)' }}>
                  {sums.map(r => <Row key={r.name} {...r} />)}
                </div>
              </div>
              {stats}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A neighbouring table at the stage's edge (page.tsx measures the room): with room, its live table (or, ?edges=outline,
// only its outline) faded and partly out of the box, its label in the box's free corner next to the stage, never over
// its seats; without room, a slim tab with its label at that edge. A click or the arrow key goes there.
export type EdgeRoom = { box: { left: number; top: number; width?: number; height?: number; transform?: string }; tab: boolean };
const ARROW = { left: '←', right: '→', up: '↑', down: '↓' };
export function Edge({ t, dir, variant, room, width, onGo }: {
  t: KeyedTable; dir: 'left' | 'right' | 'up' | 'down'; variant: 'live' | 'outline'; room: EdgeRoom; width: number; onGo: () => void;
}) {
  const label = tableLabel(t), { box } = room, bw = box.width ?? 0, bh = box.height ?? 0;
  const pill = `rounded bg-white px-1.5 text-[12px] leading-5 font-bold whitespace-nowrap tabular-nums`;
  const name = `Table ${label.replace(' · ', ', ')}`;
  if (room.tab) return (
    <button type="button" data-edge={dir} data-edge-tab aria-label={name} onClick={onGo} style={{ ...box, color: TEXT, ...CARD }}
      className={`absolute z-20 flex items-center justify-center gap-1 ${pill} opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity outline-none focus-visible:outline-2 focus-visible:outline-[rgb(31,111,196)] ${dir === 'left' || dir === 'right' ? '[writing-mode:vertical-rl]' : ''}`}>
      <span aria-hidden className="[writing-mode:horizontal-tb]" style={{ color: MUTED }}>{ARROW[dir]}</span>{label}
    </button>
  );
  const h = TABLE_H * (width / TABLE_W), side = dir === 'left' || dir === 'right';
  // The table runs out of the box on the side away from the stage, so the part showing is the side nearest it.
  const place = dir === 'left' ? { right: 0, top: (bh - h) / 2 } : dir === 'right' ? { left: 0, top: (bh - h) / 2 }
    : dir === 'up' ? { bottom: 0, left: (bw - width) / 2 } : { top: 0, left: (bw - width) / 2 };
  // The label in the free room the table leaves: over it beside the stage (left, right), beside it (up, down).
  const labelAt = side ? { top: Math.max(0, (bh - h) / 2 - 26), ...(dir === 'left' ? { right: 0 } : { left: 0 }) } : { left: 0, top: '50%', transform: 'translateY(-50%)' };
  return (
    <button type="button" data-edge={dir} aria-label={name} onClick={onGo}
      className="group absolute z-20 rounded outline-none focus-visible:outline-2 focus-visible:outline-[rgb(31,111,196)]" style={box}>
      <div className="absolute inset-0 overflow-hidden opacity-35 group-hover:opacity-60 group-focus-visible:opacity-60 transition-opacity">
        <div className="absolute" style={{ ...place, width, height: h }}>
          {variant === 'live' ? <SmallTable t={t} width={width} />
            : <div className="w-full h-full rounded" style={{ boxShadow: 'inset 0 0 0 1.5px rgba(55, 53, 47, 0.45)' }} />}
        </div>
      </div>
      <span data-edge-label className={`absolute ${pill} opacity-80 group-hover:opacity-100`} style={{ ...labelAt, color: TEXT, ...CARD }}>{label}</span>
    </button>
  );
}
